use jarvis_core::{
    execute_with_runtime, validate_backend_url, AgentConfig, ClaimedCommand, LocalRuntime,
};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::env;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::io::{self, BufRead};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

fn config_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("JARVIS_AGENT_CONFIG") {
        return Ok(PathBuf::from(path));
    }
    let appdata = env::var("APPDATA").map_err(|_| "APPDATA is missing")?;
    Ok(Path::new(&appdata).join("Jarvis").join("agent.json"))
}

fn log_event(message: &str) {
    let Ok(path) = config_path() else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let log = parent.join("agent.log");
    if fs::metadata(&log).is_ok_and(|info| info.len() > 1_000_000) {
        let _ = OpenOptions::new().write(true).truncate(true).open(&log);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log) {
        let _ = writeln!(file, "{} {message}", chrono::Utc::now().to_rfc3339());
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not create HTTP client".into())
}

fn entry(device_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("jarvis-local-agent", device_id)
        .map_err(|_| "OS credential store unavailable".into())
}

fn load_config() -> Result<AgentConfig, String> {
    let bytes = fs::read(config_path()?).map_err(|_| "Agent config missing; run enroll first")?;
    let config: AgentConfig = serde_json::from_slice(&bytes).map_err(|_| "Invalid agent config")?;
    validate_backend_url(&config.backend_url)?;
    Ok(config)
}

fn enroll(args: &[String]) -> Result<(), String> {
    if args.len() != 5 && (args.len() != 6 || args[5] != "--token-stdin") {
        return Err(
            "Usage: jarvis-core enroll <backend-url> <device-id> <allowed-root> [--token-stdin]"
                .into(),
        );
    }
    let backend_url = validate_backend_url(&args[2])?;
    let root = Path::new(&args[4])
        .canonicalize()
        .map_err(|_| "Allowed root does not exist")?;
    if !root.is_dir() {
        return Err("Allowed root must be a directory".into());
    }
    let token = if args.len() == 6 {
        let mut line = String::new();
        io::stdin()
            .lock()
            .read_line(&mut line)
            .map_err(|_| "Could not read token")?;
        line.trim_end_matches(['\r', '\n']).to_owned()
    } else {
        rpassword::prompt_password("Device token (hidden): ").map_err(|_| "Could not read token")?
    };
    if token.len() < 40 {
        return Err("Device token is too short".into());
    }
    let url = format!("{backend_url}/v1/devices/{}/identity", args[3]);
    let response = client()?
        .get(url)
        .bearer_auth(&token)
        .send()
        .map_err(|_| "Backend connection failed")?;
    if !response.status().is_success() {
        return Err("Device token was rejected by backend".into());
    }
    let identity: serde_json::Value = response.json().map_err(|_| "Invalid identity response")?;
    if identity["device_id"] != args[3] {
        return Err("Device identity mismatch".into());
    }
    let config = AgentConfig {
        backend_url,
        device_id: args[3].clone(),
        allowed_roots: vec![root],
        test_profiles: Default::default(),
        command_profiles: Default::default(),
        app_profiles: Default::default(),
    };
    let path = config_path()?;
    if path.exists() {
        let old: AgentConfig = serde_json::from_slice(
            &fs::read(&path).map_err(|_| "Could not read existing agent config")?,
        )
        .map_err(|_| "Existing agent config is invalid")?;
        if old.device_id != config.device_id {
            return Err("Another device is enrolled in this config; unenroll it first".into());
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "Could not create agent config directory")?;
    }
    let vault = entry(&config.device_id)?;
    let previous_token = vault.get_password().ok();
    vault
        .set_password(&token)
        .map_err(|_| "Could not store token in OS credential store")?;
    if fs::write(
        &path,
        serde_json::to_vec_pretty(&config).map_err(|_| "Could not serialize config")?,
    )
    .is_err()
    {
        if let Some(previous) = previous_token {
            let _ = vault.set_password(&previous);
        } else {
            let _ = vault.delete_credential();
        }
        return Err("Could not save agent config".into());
    }
    println!("Jarvis agent enrolled. Config: {}", path.display());
    Ok(())
}

fn unenroll() -> Result<(), String> {
    let config = load_config()?;
    entry(&config.device_id)?
        .delete_credential()
        .map_err(|_| "Could not remove device token from OS credential store")?;
    fs::remove_file(config_path()?).map_err(|_| "Could not remove agent config")?;
    println!(
        "Local agent enrollment removed for device {}",
        config.device_id
    );
    Ok(())
}

#[derive(Deserialize)]
struct ClaimResponse {
    command: Option<ClaimedCommand>,
}

fn run_once(
    config: &AgentConfig,
    client: &Client,
    token: &str,
    runtime: &mut LocalRuntime,
    allow_apps: bool,
) -> Result<bool, String> {
    let base = format!(
        "{}/v1/devices/{}/commands",
        config.backend_url, config.device_id
    );
    let response = client
        .post(format!("{base}/claim"))
        .bearer_auth(token)
        .json(&serde_json::json!({}))
        .send()
        .map_err(|_| "Could not reach backend")?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Device token invalid or revoked; agent stopped".into());
    }
    if !response.status().is_success() {
        return Err(format!("Backend rejected claim ({})", response.status()));
    }
    let claimed: ClaimResponse = response.json().map_err(|_| "Invalid command response")?;
    let Some(command) = claimed.command else {
        return Ok(false);
    };
    let authorization = client
        .post(format!("{base}/{}/authorize", command.id))
        .bearer_auth(token)
        .json(&serde_json::json!({}))
        .send()
        .map_err(|_| "Could not verify command authorization")?;
    if !authorization.status().is_success() {
        return Err(format!(
            "Command authorization rejected ({})",
            authorization.status()
        ));
    }
    let result =
        if !allow_apps && (command.capability == "app.open" || command.capability == "app.close") {
            jarvis_core::CommandResult::rejected("REQUIRES_CONTINUOUS_AGENT")
        } else {
            execute_with_runtime(config, &command, runtime)
        };
    let response = client
        .post(format!("{base}/{}/result", command.id))
        .bearer_auth(token)
        .json(&result)
        .send()
        .map_err(|_| "Could not report result; command needs reconciliation")?;
    if !response.status().is_success() {
        return Err(format!("Backend rejected result ({})", response.status()));
    }
    let summary = format!("Command {}: {}", command.id, result.status);
    println!("{summary}");
    log_event(&summary);
    Ok(true)
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("enroll") => enroll(&args),
        Some("unenroll") => unenroll(),
        Some("once" | "run") => {
            let config = load_config();
            config.and_then(|config| {
                let token = entry(&config.device_id)?
                    .get_password()
                    .map_err(|_| "Device token missing from OS credential store")?;
                let client = client()?;
                let mut runtime = LocalRuntime::default();
                if args[1] == "once" {
                    run_once(&config, &client, &token, &mut runtime, false).map(|_| ())
                } else {
                    loop {
                        if let Err(error) = run_once(&config, &client, &token, &mut runtime, true) {
                            eprintln!("{error}");
                            log_event(&error);
                            if error.starts_with("Device token invalid or revoked") {
                                return Err(error);
                            }
                        }
                        thread::sleep(Duration::from_secs(3));
                    }
                }
            })
        }
        _ => Err("Usage: jarvis-core <enroll|unenroll|once|run>".into()),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
