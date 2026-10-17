import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { RiskLevel } from "../../../domains/core/src/model.js";
import { requiresFreshApproval } from "../../../domains/core/src/rules.js";
import { HttpError } from "./errors.js";
import type { Store } from "./store.js";

const baseline: Record<string, RiskLevel> = {
  "git.status": 0,
  "git.diff": 0,
  "test.run": 2,
  "file.read": 0,
  "system.info": 0,
  "process.list": 0,
  "os.lock": 2,
  "terminal.run": 2,
  "app.open": 2,
  "app.close": 2,
  "file.write": 2,
  "external.send": 3,
};

export function capabilityRisk(capability: string): RiskLevel {
  const risk = baseline[capability];
  if (risk === undefined)
    throw new HttpError(
      400,
      "unknown_capability",
      "Capability is not registered",
    );
  return risk;
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export interface PermissionScope {
  userId: string;
  taskId: string;
  deviceId: string;
  agentId: string | null;
  capability: string;
  resource: string;
  argumentsJson?: string;
}

export function requestPermission(store: Store, scope: PermissionScope) {
  const risk = capabilityRisk(scope.capability);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const policy = store.get<{ decision: string }>(
    `SELECT decision FROM permission_policies WHERE user_id=? AND capability=? AND resource=?
     AND (device_id IS NULL OR device_id=?) AND (agent_id IS NULL OR agent_id=?)
     AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 1`,
    scope.userId,
    scope.capability,
    scope.resource,
    scope.deviceId,
    scope.agentId,
    now.toISOString(),
  );
  const status =
    policy?.decision === "never"
      ? "denied"
      : !requiresFreshApproval(risk) && policy?.decision === "allow"
        ? "allowed"
        : "pending";
  const id = randomUUID();
  const nonce =
    status === "allowed" ? randomBytes(32).toString("base64url") : null;
  store.run(
    `INSERT INTO permission_requests
     (id,user_id,task_id,device_id,agent_id,capability,resource,risk,status,expires_at,nonce_hash,created_at,arguments_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    scope.userId,
    scope.taskId,
    scope.deviceId,
    scope.agentId,
    scope.capability,
    scope.resource,
    risk,
    status,
    expiresAt,
    nonce ? digest(nonce) : null,
    now.toISOString(),
    scope.argumentsJson ?? "{}",
  );
  const { argumentsJson, ...publicScope } = scope;
  return {
    id,
    ...publicScope,
    arguments: JSON.parse(argumentsJson ?? "{}"),
    risk,
    status,
    expires_at: expiresAt,
    nonce,
  };
}

export function decidePermission(
  store: Store,
  userId: string,
  requestId: string,
  decision: "allow_once" | "deny",
) {
  const request = store.get<{ id: string; status: string; expires_at: string }>(
    "SELECT id,status,expires_at FROM permission_requests WHERE id=? AND user_id=?",
    requestId,
    userId,
  );
  if (!request)
    throw new HttpError(404, "not_found", "Permission request not found");
  if (
    request.status !== "pending" ||
    request.expires_at <= new Date().toISOString()
  ) {
    throw new HttpError(
      409,
      "request_not_pending",
      "Permission request is no longer pending",
    );
  }
  const nonce =
    decision === "allow_once" ? randomBytes(32).toString("base64url") : null;
  store.run(
    "UPDATE permission_requests SET status=?,nonce_hash=? WHERE id=? AND user_id=? AND status='pending'",
    decision === "allow_once" ? "allowed" : "denied",
    nonce ? digest(nonce) : null,
    requestId,
    userId,
  );
  return { id: requestId, decision, expires_at: request.expires_at, nonce };
}

export function consumePermission(
  store: Store,
  scope: PermissionScope,
  requestId: string,
  nonce: string,
): boolean {
  const permission = store.get<{
    id: string;
    nonce_hash: string;
    status: string;
    expires_at: string;
    consumed_at: string | null;
  }>(
    `SELECT id,nonce_hash,status,expires_at,consumed_at FROM permission_requests
     WHERE id=? AND user_id=? AND task_id=? AND device_id=? AND capability=? AND resource=? AND arguments_json=?
       AND (agent_id IS ? OR agent_id=?)`,
    requestId,
    scope.userId,
    scope.taskId,
    scope.deviceId,
    scope.capability,
    scope.resource,
    scope.argumentsJson ?? "{}",
    scope.agentId,
    scope.agentId,
  );
  if (
    !permission ||
    permission.status !== "allowed" ||
    permission.consumed_at ||
    permission.expires_at <= new Date().toISOString()
  )
    return false;
  if (permission.nonce_hash !== digest(nonce)) return false;
  const updated = store.db
    .prepare(
      "UPDATE permission_requests SET consumed_at=? WHERE id=? AND nonce_hash=? AND consumed_at IS NULL AND expires_at>?",
    )
    .run(
      new Date().toISOString(),
      requestId,
      digest(nonce),
      new Date().toISOString(),
    );
  return updated.changes === 1;
}
