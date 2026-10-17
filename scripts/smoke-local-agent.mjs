import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createApp } from "../services/backend/src/app.ts";
import { Store } from "../services/backend/src/store.ts";

const binary = resolve("core/rust-agent/target/debug/jarvis-core.exe");
if (!existsSync(binary)) throw new Error("Build the Rust agent first with cargo build");

const temp = mkdtempSync(join(tmpdir(), "jarvis-agent-smoke-"));
const configPath = join(temp, "agent.json");
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

try {
  const account = await api("/v1/auth/register", "POST", {
    email: `agent-smoke-${Date.now()}@example.test`,
    password: "local-agent-smoke-password",
    display_name: "Local Agent Smoke",
  });
  const device = await api("/v1/devices", "POST", {
    name: "Smoke device", platform: "windows", capabilities: ["system.info"],
  }, account.token);
  const task = await api("/v1/tasks", "POST", { title: "Read device information" }, account.token);
  const permission = await api("/v1/permissions", "POST", {
    task_id: task.id, device_id: device.id, capability: "system.info",
    resource: `device:${device.id}`, arguments: {},
  }, account.token);
  const grant = await api(`/v1/permissions/${permission.id}/decision`, "POST", {
    decision: "allow_once",
  }, account.token);
  const command = await api("/v1/device-commands", "POST", {
    task_id: task.id, device_id: device.id, capability: "system.info",
    resource: `device:${device.id}`, arguments: {},
    permission_request_id: permission.id, nonce: grant.nonce,
    idempotency_key: `agent-smoke-${randomUUID()}`,
  }, account.token);
  await agent(["enroll", base, device.id, resolve("."), "--token-stdin"], device.device_token);
  await agent(["once"]);
  const result = await api(`/v1/device-commands/${command.id}`, "GET", undefined, account.token);
  assert.equal(result.status, "succeeded");
  assert.equal(JSON.parse(result.output).os, "windows");
  console.log("Local agent end-to-end smoke passed: enrolled, claimed, authorized, executed, and reported.");
} finally {
  try {
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
  }
}
