//! Local execution boundary for approved Jarvis device commands.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;
use wait_timeout::ChildExt;

pub const AGENT_NAME: &str = "jarvis-local-agent";
const MAX_OUTPUT: usize = 90_000;

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentConfig {
    pub backend_url: String,
    pub device_id: String,
    pub allowed_roots: Vec<PathBuf>,
    #[serde(default)]
    pub test_profiles: HashMap<String, TestProfile>,
    #[serde(default)]
    pub command_profiles: HashMap<String, TestProfile>,
    #[serde(default)]
    pub app_profiles: HashMap<String, TestProfile>,
}

#[derive(Default)]
pub struct LocalRuntime {
    launched_apps: HashMap<String, Child>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestProfile {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClaimedCommand {
    pub protocol_version: String,
    pub id: String,
    pub device_id: String,
    pub capability: String,
    pub resource: String,
    pub arguments: serde_json::Value,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct CommandResult {
    pub status: &'static str,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<&'static str>,
}

impl CommandResult {
    pub fn rejected(code: &'static str) -> Self {
        Self::failed(code)
    }
    fn failed(code: &'static str) -> Self {
        Self {
            status: "failed",
            output: String::new(),
            error_code: Some(code),
        }
    }
}

pub fn validate_backend_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "Invalid backend URL")?;
    if url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Backend URL must not contain credentials, query, or fragment".into());
    }
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Backend must use HTTPS, except loopback HTTP".into());
    }
    Ok(raw.trim_end_matches('/').to_owned())
}

fn approved_root(config: &AgentConfig, requested: &str) -> Result<PathBuf, &'static str> {
    let requested = Path::new(requested);
    if !requested.is_absolute() {
        return Err("SCOPE_VIOLATION");
    }
    let canonical = requested.canonicalize().map_err(|_| "SCOPE_VIOLATION")?;
    if !canonical.is_dir() {
        return Err("SCOPE_VIOLATION");
    }
    let allowed = config
        .allowed_roots
        .iter()
        .any(|root| root.canonicalize().is_ok_and(|value| value == canonical));
    if !allowed {
        return Err("SCOPE_VIOLATION");
    }
    Ok(canonical)
}

fn approved_file(config: &AgentConfig, requested: &str) -> Result<PathBuf, &'static str> {
    let path = Path::new(requested);
    if !path.is_absolute() {
        return Err("SCOPE_VIOLATION");
    }
    let canonical = path.canonicalize().map_err(|_| "SCOPE_VIOLATION")?;
    if !canonical.is_file() {
        return Err("SCOPE_VIOLATION");
    }
    let allowed = config.allowed_roots.iter().any(|root| {
        root.canonicalize()
            .is_ok_and(|value| canonical.starts_with(value))
    });
    if !allowed {
        return Err("SCOPE_VIOLATION");
    }
    Ok(canonical)
}

fn read_capped(mut pipe: impl Read) -> Vec<u8> {
    let mut kept = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let available = MAX_OUTPUT.saturating_sub(kept.len());
                kept.extend_from_slice(&chunk[..count.min(available)]);
            }
        }
    }
    kept
}

fn run_process(program: &str, args: &[String], root: &Path) -> CommandResult {
    let mut child = match Command::new(program)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return CommandResult::failed("EXECUTION_FAILED"),
    };
    let out = child.stdout.take().expect("stdout was piped");
    let err = child.stderr.take().expect("stderr was piped");
    let out_reader = thread::spawn(move || read_capped(out));
    let err_reader = thread::spawn(move || read_capped(err));
    let waited = child.wait_timeout(Duration::from_secs(120));
    let timed_out = !matches!(&waited, Ok(Some(_)));
    if timed_out {
        stop_process_tree(child.id());
        let _ = child.kill();
        let _ = child.wait();
    }
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();
    if timed_out {
        return CommandResult::failed("TIMEOUT");
    }
    let success = waited.ok().flatten().is_some_and(|status| status.success());
    let mut output = String::from_utf8_lossy(&stdout).into_owned();
    if !stderr.is_empty() {
        output.push_str("\n");
        output.push_str(&String::from_utf8_lossy(&stderr));
    }
    while output.len() > MAX_OUTPUT {
        output.pop();
    }
    CommandResult {
        status: if success { "succeeded" } else { "failed" },
        output,
        error_code: if success {
            None
        } else {
            Some("EXECUTION_FAILED")
        },
    }
}

fn stop_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    let _ = pid;
}

pub fn execute(config: &AgentConfig, command: &ClaimedCommand) -> CommandResult {
    execute_with_runtime(config, command, &mut LocalRuntime::default())
}

pub fn execute_with_runtime(
    config: &AgentConfig,
    command: &ClaimedCommand,
    runtime: &mut LocalRuntime,
) -> CommandResult {
    if command.protocol_version != "1.0" {
        return CommandResult::failed("UNSUPPORTED_VERSION");
    }
    if command.device_id != config.device_id {
        return CommandResult::failed("DEVICE_MISMATCH");
    }
    let expires = match DateTime::parse_from_rfc3339(&command.expires_at) {
        Ok(value) => value.with_timezone(&Utc),
        Err(_) => return CommandResult::failed("EXPIRED"),
    };
    if expires <= Utc::now() {
        return CommandResult::failed("EXPIRED");
    }
    if command.capability == "system.info" || command.capability == "process.list" {
        if command.resource != format!("device:{}", config.device_id)
            || command.arguments != serde_json::json!({})
        {
            return CommandResult::failed("SCOPE_VIOLATION");
        }
        if command.capability == "process.list" {
            let root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            #[cfg(windows)]
            return run_process(
                "tasklist",
                &["/FO".into(), "CSV".into(), "/NH".into()],
                &root,
            );
            #[cfg(not(windows))]
            return run_process("ps", &["-e".into(), "-o".into(), "pid,comm".into()], &root);
        }
        let info = serde_json::json!({
            "os": std::env::consts::OS,
            "architecture": std::env::consts::ARCH,
            "cpu_count": std::thread::available_parallelism().map(|v| v.get()).unwrap_or(1),
        });
        return CommandResult {
            status: "succeeded",
            output: info.to_string(),
            error_code: None,
        };
    }
    if command.capability == "os.lock" {
        if command.resource != format!("device:{}", config.device_id)
            || command.arguments != serde_json::json!({})
        {
            return CommandResult::failed("SCOPE_VIOLATION");
        }
        #[cfg(windows)]
        {
            // Windows reports that the lock was initiated; completion is asynchronous.
            let started = unsafe { windows_sys::Win32::System::Shutdown::LockWorkStation() };
            return if started != 0 {
                CommandResult {
                    status: "succeeded",
                    output: "Lock initiated".into(),
                    error_code: None,
                }
            } else {
                CommandResult::failed("EXECUTION_FAILED")
            };
        }
        #[cfg(not(windows))]
        return CommandResult::failed("UNSUPPORTED_PLATFORM");
    }
    if command.capability == "file.read" {
        if command.arguments != serde_json::json!({}) {
            return CommandResult::failed("INVALID_PAYLOAD");
        }
        let path = match approved_file(config, &command.resource) {
            Ok(value) => value,
            Err(code) => return CommandResult::failed(code),
        };
        let Ok(metadata) = fs::metadata(&path) else {
            return CommandResult::failed("EXECUTION_FAILED");
        };
        if metadata.len() > MAX_OUTPUT as u64 {
            return CommandResult::failed("FILE_TOO_LARGE");
        }
        let Ok(output) = fs::read_to_string(path) else {
            return CommandResult::failed("NOT_TEXT_FILE");
        };
        return CommandResult {
            status: "succeeded",
            output,
            error_code: None,
        };
    }
    if command.capability == "app.open" {
        let Some(id) = command
            .arguments
            .get("app_profile_id")
            .and_then(|v| v.as_str())
        else {
            return CommandResult::failed("INVALID_PAYLOAD");
        };
        if command.arguments.as_object().is_none_or(|v| v.len() != 1)
            || command.resource != format!("app:{id}")
        {
            return CommandResult::failed("SCOPE_VIOLATION");
        }
        let Some(profile) = config.app_profiles.get(id) else {
            return CommandResult::failed("UNKNOWN_APP_PROFILE");
        };
        if !Path::new(&profile.program).is_absolute() || !Path::new(&profile.program).is_file() {
            return CommandResult::failed("INVALID_APP_PROFILE");
        }
        let child = match Command::new(&profile.program)
            .args(&profile.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return CommandResult::failed("EXECUTION_FAILED"),
        };
        let pid = child.id();
        runtime.launched_apps.insert(command.id.clone(), child);
        return CommandResult {
            status: "succeeded",
            output: serde_json::json!({"launch_id":command.id,"pid":pid}).to_string(),
            error_code: None,
        };
    }
    if command.capability == "app.close" {
        let Some(id) = command.arguments.get("launch_id").and_then(|v| v.as_str()) else {
            return CommandResult::failed("INVALID_PAYLOAD");
        };
        if command.arguments.as_object().is_none_or(|v| v.len() != 1)
            || command.resource != format!("app:{id}")
        {
            return CommandResult::failed("SCOPE_VIOLATION");
        }
        let Some(mut child) = runtime.launched_apps.remove(id) else {
            return CommandResult::failed("UNKNOWN_LAUNCH");
        };
        let stopped = if child.try_wait().is_ok_and(|status| status.is_some()) {
            true
        } else {
            stop_process_tree(child.id());
            child.kill().is_ok() || child.try_wait().is_ok_and(|status| status.is_some())
        };
        let _ = child.wait();
        return if stopped {
            CommandResult {
                status: "succeeded",
                output: String::new(),
                error_code: None,
            }
        } else {
            CommandResult::failed("EXECUTION_FAILED")
        };
    }
    let root = match approved_root(config, &command.resource) {
        Ok(value) => value,
        Err(code) => return CommandResult::failed(code),
    };
    match command.capability.as_str() {
        "git.status" if command.arguments == serde_json::json!({}) => {
            run_process("git", &["status".into(), "--short".into()], &root)
        }
        "git.diff" if command.arguments == serde_json::json!({}) => run_process(
            "git",
            &[
                "diff".into(),
                "--no-ext-diff".into(),
                "--no-color".into(),
                "--stat".into(),
            ],
            &root,
        ),
        "test.run" => {
            let Some(id) = command
                .arguments
                .get("test_profile_id")
                .and_then(|v| v.as_str())
            else {
                return CommandResult::failed("INVALID_PAYLOAD");
            };
            if command.arguments.as_object().is_none_or(|v| v.len() != 1) {
                return CommandResult::failed("INVALID_PAYLOAD");
            }
            let Some(profile) = config.test_profiles.get(id) else {
                return CommandResult::failed("UNKNOWN_TEST_PROFILE");
            };
            if !Path::new(&profile.program).is_absolute() || !Path::new(&profile.program).is_file()
            {
                return CommandResult::failed("INVALID_TEST_PROFILE");
            }
            run_process(&profile.program, &profile.args, &root)
        }
        "terminal.run" => {
            let Some(id) = command
                .arguments
                .get("command_profile_id")
                .and_then(|v| v.as_str())
            else {
                return CommandResult::failed("INVALID_PAYLOAD");
            };
            if command.arguments.as_object().is_none_or(|v| v.len() != 1) {
                return CommandResult::failed("INVALID_PAYLOAD");
            }
            let Some(profile) = config.command_profiles.get(id) else {
                return CommandResult::failed("UNKNOWN_COMMAND_PROFILE");
            };
            if !Path::new(&profile.program).is_absolute() || !Path::new(&profile.program).is_file()
            {
                return CommandResult::failed("INVALID_COMMAND_PROFILE");
            }
            run_process(&profile.program, &profile.args, &root)
        }
        _ => CommandResult::failed("UNKNOWN_CAPABILITY"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> AgentConfig {
        AgentConfig {
            backend_url: "http://127.0.0.1:3001".into(),
            device_id: "dev".into(),
            allowed_roots: vec![std::env::current_dir().unwrap()],
            test_profiles: HashMap::new(),
            command_profiles: HashMap::new(),
            app_profiles: HashMap::new(),
        }
    }

    #[test]
    fn refuses_remote_plain_http() {
        assert!(validate_backend_url("http://example.com:3001").is_err());
        assert!(validate_backend_url("http://127.0.0.1:3001").is_ok());
    }

    #[test]
    fn rejects_wrong_device_and_unapproved_root() {
        let mut command = ClaimedCommand {
            protocol_version: "1.0".into(),
            id: "cmd".into(),
            device_id: "wrong".into(),
            capability: "git.status".into(),
            resource: std::env::current_dir().unwrap().display().to_string(),
            arguments: serde_json::json!({}),
            expires_at: (Utc::now() + chrono::Duration::minutes(1)).to_rfc3339(),
        };
        assert_eq!(
            execute(&config(), &command).error_code,
            Some("DEVICE_MISMATCH")
        );
        command.device_id = "dev".into();
        command.resource = std::env::temp_dir().display().to_string();
        assert_eq!(
            execute(&config(), &command).error_code,
            Some("SCOPE_VIOLATION")
        );
    }

    #[test]
    fn reads_only_one_allowed_file_and_rejects_expired_commands() {
        let root = std::env::current_dir().unwrap();
        let mut command = ClaimedCommand {
            protocol_version: "1.0".into(),
            id: "cmd".into(),
            device_id: "dev".into(),
            capability: "file.read".into(),
            resource: root.join("Cargo.toml").display().to_string(),
            arguments: serde_json::json!({}),
            expires_at: (Utc::now() + chrono::Duration::minutes(1)).to_rfc3339(),
        };
        let result = execute(&config(), &command);
        assert_eq!(result.status, "succeeded");
        assert!(result.output.contains("jarvis-core"));
        command.expires_at = (Utc::now() - chrono::Duration::minutes(1)).to_rfc3339();
        assert_eq!(execute(&config(), &command).error_code, Some("EXPIRED"));
    }

    #[test]
    fn git_status_and_diff_use_the_selected_repository() {
        let root = std::env::current_dir().unwrap();
        let mut command = ClaimedCommand {
            protocol_version: "1.0".into(),
            id: "git-read".into(),
            device_id: "dev".into(),
            capability: "git.status".into(),
            resource: root.display().to_string(),
            arguments: serde_json::json!({}),
            expires_at: (Utc::now() + chrono::Duration::minutes(1)).to_rfc3339(),
        };
        assert_eq!(execute(&config(), &command).status, "succeeded");
        command.capability = "git.diff".into();
        assert_eq!(execute(&config(), &command).status, "succeeded");
    }

    #[cfg(windows)]
    #[test]
    fn terminal_profile_runs_only_a_locally_configured_program() {
        let program = PathBuf::from(std::env::var("SystemRoot").unwrap())
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        let mut config = config();
        config.command_profiles.insert(
            "echo".into(),
            TestProfile {
                program: program.display().to_string(),
                args: vec![
                    "-NoProfile".into(),
                    "-Command".into(),
                    "Write-Output JarvisProfile".into(),
                ],
            },
        );
        let command = ClaimedCommand {
            protocol_version: "1.0".into(),
            id: "terminal".into(),
            device_id: "dev".into(),
            capability: "terminal.run".into(),
            resource: std::env::current_dir().unwrap().display().to_string(),
            arguments: serde_json::json!({"command_profile_id":"echo"}),
            expires_at: (Utc::now() + chrono::Duration::minutes(1)).to_rfc3339(),
        };
        let result = execute(&config, &command);
        assert_eq!(result.status, "succeeded");
        assert!(result.output.contains("JarvisProfile"));
    }

    #[cfg(windows)]
    #[test]
    fn closes_only_a_process_launched_by_this_runtime() {
        let program = PathBuf::from(std::env::var("SystemRoot").unwrap())
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        let mut config = config();
        config.app_profiles.insert(
            "sleeper".into(),
            TestProfile {
                program: program.display().to_string(),
                args: vec![
                    "-NoProfile".into(),
                    "-Command".into(),
                    "Start-Sleep -Seconds 30".into(),
                ],
            },
        );
        let mut runtime = LocalRuntime::default();
        let launch = ClaimedCommand {
            protocol_version: "1.0".into(),
            id: "launch-1".into(),
            device_id: "dev".into(),
            capability: "app.open".into(),
            resource: "app:sleeper".into(),
            arguments: serde_json::json!({"app_profile_id":"sleeper"}),
            expires_at: (Utc::now() + chrono::Duration::minutes(1)).to_rfc3339(),
        };
        assert_eq!(
            execute_with_runtime(&config, &launch, &mut runtime).status,
            "succeeded"
        );
        let close = ClaimedCommand {
            protocol_version: "1.0".into(),
            id: "close-1".into(),
            device_id: "dev".into(),
            capability: "app.close".into(),
            resource: "app:launch-1".into(),
            arguments: serde_json::json!({"launch_id":"launch-1"}),
            expires_at: (Utc::now() + chrono::Duration::minutes(1)).to_rfc3339(),
        };
        assert_eq!(
            execute_with_runtime(&config, &close, &mut runtime).status,
            "succeeded"
        );
        assert_eq!(
            execute_with_runtime(&config, &close, &mut runtime).error_code,
            Some("UNKNOWN_LAUNCH")
        );
    }
}
