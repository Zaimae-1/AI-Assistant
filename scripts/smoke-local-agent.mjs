import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createApp } from "../services/backend/src/app.ts";
import { Store } from "../services/backend/src/store.ts";

const binary = resolve("core/rust-agent/target/debug/jarvis-core.exe");
if (!existsSync(binary)) throw new Error("Build the Rust agent first with cargo build");
if (process.argv.length > 3 || (process.argv[2] && !["--lock-screen", "--background"].includes(process.argv[2]))) {
  throw new Error("Usage: node scripts/smoke-local-agent.mjs [--lock-screen|--background]");
}
const lockScreen = process.argv[2] === "--lock-screen";
const background = process.argv[2] === "--background";
const capability = lockScreen ? "os.lock" : "system.info";

const temp = mkdtempSync(join(tmpdir(), "jarvis-agent-smoke-"));
const localData = resolve(".data");
if (background) mkdirSync(localData, { recursive: true });
const backgroundDir = background ? mkdtempSync(join(localData, "agent-smoke-")) : null;
const configPath = join(backgroundDir ?? temp, "agent.json");
const logPath = join(backgroundDir ?? temp, "agent.log");
const env = { ...process.env, JARVIS_AGENT_CONFIG: configPath };
const store = new Store();
const server = createApp({ store }).listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;

async function api(path, method = "GET", body, token) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`API ${path} returned ${response.status}: ${value.error}`);
  return value;
}

async function agent(args, input) {
  const child = spawn(binary, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  if (input !== undefined) child.stdin.end(`${input}\n`);
  else child.stdin.end();
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`Rust agent failed (${code}): ${stderr.trim()}`);
  return stdout;
}

async function powershell(args) {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`PowerShell failed (${code}): ${stderr.trim()}`);
  return stdout;
}

let taskName;

try {
  const account = await api("/v1/auth/register", "POST", {
    email: `agent-smoke-${Date.now()}@example.test`,
    password: "local-agent-smoke-password",
    display_name: "Local Agent Smoke",
  });
  const device = await api("/v1/devices", "POST", {
    name: "Smoke device", platform: "windows", capabilities: [capability],
  }, account.token);
  const task = await api("/v1/tasks", "POST", { title: lockScreen ? "Lock Windows session" : "Read device information" }, account.token);
  const permission = await api("/v1/permissions", "POST", {
    task_id: task.id, device_id: device.id, capability,
    resource: `device:${device.id}`, arguments: {},
  }, account.token);
  const grant = await api(`/v1/permissions/${permission.id}/decision`, "POST", {
    decision: "allow_once",
  }, account.token);
  const command = await api("/v1/device-commands", "POST", {
    task_id: task.id, device_id: device.id, capability,
    resource: `device:${device.id}`, arguments: {},
    permission_request_id: permission.id, nonce: grant.nonce,
    idempotency_key: `agent-smoke-${randomUUID()}`,
  }, account.token);
  const enrollment = await agent(["enroll", base, device.id, resolve("."), "--token-stdin"], device.device_token);
  if (!existsSync(configPath)) throw new Error(`Enrollment did not create expected config at ${configPath}: ${enrollment.trim()}`);
  if (background) {
    taskName = `JarvisLocalAgent-${device.id}`;
    await powershell(["-ExecutionPolicy", "Bypass", "-File", resolve("core/rust-agent/scripts/install-autostart.ps1"), "-AgentExe", binary, "-ConfigPath", configPath]);
    await powershell(["-Command", `Start-ScheduledTask -TaskName '${taskName}'`]);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const current = await api(`/v1/device-commands/${command.id}`, "GET", undefined, account.token);
      if (current.status === "succeeded" || current.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } else {
    await agent(["once"]);
  }
  const result = await api(`/v1/device-commands/${command.id}`, "GET", undefined, account.token);
  if (background && result.status !== "succeeded") {
    const taskInfo = await powershell(["-Command", `Get-ScheduledTask -TaskName '${taskName}' | Select-Object TaskName,State | Format-List; Get-ScheduledTaskInfo -TaskName '${taskName}' | Select-Object LastTaskResult,LastRunTime | Format-List`]);
    const agentLog = existsSync(logPath) ? readFileSync(logPath, "utf8") : "(no agent log)";
    throw new Error(`Background command stayed ${result.status}. Task: ${taskInfo.trim()}. Agent log: ${agentLog.trim()}`);
  }
  assert.equal(result.status, "succeeded");
  if (lockScreen) assert.equal(result.output, "Lock initiated");
  else assert.equal(JSON.parse(result.output).os, "windows");
  const log = readFileSync(logPath, "utf8");
  assert.match(log, new RegExp(`Command ${command.id}: succeeded`));
  assert.equal(log.includes(device.device_token), false);
  assert.equal(log.includes(result.output), false);
  console.log(`Local agent end-to-end ${background ? "background" : capability} smoke passed: enrolled, claimed, authorized, executed, and reported.`);
} finally {
  try {
    if (taskName) {
      await powershell(["-Command", `Stop-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue`]);
    }
    if (existsSync(configPath)) await agent(["unenroll"]);
  } finally {
    server.close();
    await once(server, "close");
    store.close();
    const resolvedTemp = resolve(temp);
    if (!resolvedTemp.startsWith(`${resolve(tmpdir())}${sep}`) ||
        !basename(resolvedTemp).startsWith("jarvis-agent-smoke-")) {
      throw new Error("Refusing to remove unexpected smoke directory");
    }
    rmSync(resolvedTemp, { recursive: true, force: true });
    if (backgroundDir) {
      const resolvedBackground = resolve(backgroundDir);
      if (!resolvedBackground.startsWith(`${localData}${sep}`) ||
          !basename(resolvedBackground).startsWith("agent-smoke-")) {
        throw new Error("Refusing to remove unexpected background smoke directory");
      }
      rmSync(resolvedBackground, { recursive: true, force: true });
    }
  }
}
