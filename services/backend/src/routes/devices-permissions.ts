import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  capabilityRisk,
  decidePermission,
  requestPermission,
} from "../permissions.js";
import { assertFound, HttpError } from "../errors.js";
import { sendJson, type Router } from "../http.js";
import type { Store } from "../store.js";
import { ownedAgent } from "./agents.js";
import { ownedTask } from "./tasks.js";
import { issueDeviceToken } from "../device-auth.js";
import {
  isDeviceCapability,
  parseDeviceArguments,
  validateDeviceResource,
} from "../device-capabilities.js";

function ownedDevice(store: Store, userId: string, deviceId: string) {
  return assertFound(
    store.get<{ id: string; revoked_at: string | null }>(
      "SELECT id,user_id,name,platform,capabilities_json,last_seen,revoked_at,created_at FROM devices WHERE id=? AND user_id=?",
      deviceId,
      userId,
    ),
    "Device",
  );
}

export function registerDevicePermissionRoutes(router: Router): void {
  router.add("GET", "/v1/devices", (context) =>
    context.store.all(
      "SELECT id,user_id,name,platform,capabilities_json,last_seen,revoked_at,created_at FROM devices WHERE user_id=? ORDER BY created_at",
      context.user!.id,
    ),
  );

  router.add("POST", "/v1/devices", (context) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        platform: z.enum([
          "windows",
          "macos",
          "linux",
          "android",
          "ios",
          "other",
        ]),
        capabilities: z.array(z.string().min(1).max(80)).max(40).default([]),
      })
      .strict()
      .parse(context.body);
    for (const capability of input.capabilities) capabilityRisk(capability);
    const id = randomUUID();
    const now = new Date().toISOString();
    context.store.run(
      "INSERT INTO devices (id,user_id,name,platform,capabilities_json,last_seen,created_at) VALUES (?,?,?,?,?,?,?)",
      id,
      context.user!.id,
      input.name,
      input.platform,
      JSON.stringify(input.capabilities),
      now,
      now,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "device.register",
      `device:${id}`,
      "succeeded",
    );
    const deviceToken = issueDeviceToken(context.store, id);
    sendJson(context.response, 201, {
      ...ownedDevice(context.store, context.user!.id, id),
      device_token: deviceToken,
    });
  });

  router.add("POST", "/v1/devices/:id/rotate-token", (context) => {
    const device = ownedDevice(
      context.store,
      context.user!.id,
      context.params.id,
    );
    if (device.revoked_at)
      throw new HttpError(409, "device_revoked", "Device is revoked");
    const deviceToken = issueDeviceToken(context.store, device.id);
    context.audit(
      context.user!.id,
      context.user!.id,
      "device.rotate_token",
      `device:${device.id}`,
      "succeeded",
    );
    return { device_id: device.id, device_token: deviceToken };
  });

  router.add("POST", "/v1/devices/:id/heartbeat", (context) => {
    const device = ownedDevice(
      context.store,
      context.user!.id,
      context.params.id,
    );
    if (device.revoked_at)
      throw new HttpError(409, "device_revoked", "Device is revoked");
    context.store.run(
      "UPDATE devices SET last_seen=? WHERE id=? AND user_id=?",
      new Date().toISOString(),
      device.id,
      context.user!.id,
    );
    return ownedDevice(context.store, context.user!.id, device.id);
  });

  router.add("DELETE", "/v1/devices/:id", (context) => {
    const device = ownedDevice(
      context.store,
      context.user!.id,
      context.params.id,
    );
    context.store.run(
      "UPDATE devices SET revoked_at=? WHERE id=? AND user_id=?",
      new Date().toISOString(),
      device.id,
      context.user!.id,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "device.revoke",
      `device:${device.id}`,
      "succeeded",
    );
    return { ok: true };
  });

  router.add("GET", "/v1/permission-policies", (context) =>
    context.store.all(
      "SELECT * FROM permission_policies WHERE user_id=? ORDER BY created_at DESC",
      context.user!.id,
    ),
  );

  router.add("POST", "/v1/permission-policies", (context) => {
    const input = z
      .object({
        capability: z.string().min(1).max(80),
        resource: z.string().min(1).max(2048),
        device_id: z.uuid().optional(),
        agent_id: z.uuid().optional(),
        decision: z.enum([
          "ask_every_time",
          "allow_session",
          "always_allow",
          "never_allow",
        ]),
      })
      .strict()
      .parse(context.body);
    const risk = capabilityRisk(input.capability);
    if (input.device_id)
      ownedDevice(context.store, context.user!.id, input.device_id);
    if (input.agent_id)
      ownedAgent(context.store, context.user!.id, input.agent_id);
    if (
      risk >= 2 &&
      ["allow_session", "always_allow"].includes(input.decision)
    ) {
      throw new HttpError(
        400,
        "fresh_approval_required",
        "This capability always requires approval for each action",
      );
    }
    context.store.run(
      `DELETE FROM permission_policies WHERE user_id=? AND capability=? AND resource=?
       AND (device_id IS ? OR device_id=?) AND (agent_id IS ? OR agent_id=?)`,
      context.user!.id,
      input.capability,
      input.resource,
      input.device_id ?? null,
      input.device_id ?? null,
      input.agent_id ?? null,
      input.agent_id ?? null,
    );
    if (input.decision === "ask_every_time")
      return { decision: input.decision };
    const id = randomUUID();
    const expiresAt =
      input.decision === "allow_session"
        ? new Date(Date.now() + 12 * 60 * 60_000).toISOString()
        : null;
    context.store.run(
      "INSERT INTO permission_policies (id,user_id,agent_id,device_id,capability,resource,decision,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      id,
      context.user!.id,
      input.agent_id ?? null,
      input.device_id ?? null,
      input.capability,
      input.resource,
      input.decision === "never_allow" ? "never" : "allow",
      expiresAt,
      new Date().toISOString(),
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "permission.policy",
      `policy:${id}`,
      input.decision,
    );
    return { id, ...input, expires_at: expiresAt };
  });

  router.add("GET", "/v1/permissions", (context) =>
    context.store.all(
      `SELECT id,task_id,device_id,agent_id,capability,resource,arguments_json,risk,status,expires_at,consumed_at,created_at
       FROM permission_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 200`,
      context.user!.id,
    ),
  );

  router.add("POST", "/v1/permissions", (context) => {
    const input = z
      .object({
        task_id: z.uuid(),
        device_id: z.uuid(),
        agent_id: z.uuid().optional(),
        capability: z.string().min(1).max(80),
        resource: z.string().min(1).max(2048),
        arguments: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .parse(context.body);
    const task = ownedTask(context.store, context.user!.id, input.task_id);
    if (isDeviceCapability(input.capability)) {
      input.arguments = parseDeviceArguments(input.capability, input.arguments);
      validateDeviceResource(
        input.capability,
        input.device_id,
        input.resource,
        input.arguments,
      );
    }
    const device = ownedDevice(
      context.store,
      context.user!.id,
      input.device_id,
    );
    if (device.revoked_at)
      throw new HttpError(409, "device_revoked", "Device is revoked");
    if (input.agent_id)
      ownedAgent(context.store, context.user!.id, input.agent_id);
    if (task.agent_id && task.agent_id !== input.agent_id) {
      throw new HttpError(
        400,
        "agent_scope_mismatch",
        "Permission agent must match assigned task agent",
      );
    }
    const capabilities = JSON.parse(
      context.store.get<{ capabilities_json: string }>(
        "SELECT capabilities_json FROM devices WHERE id=?",
        device.id,
      )!.capabilities_json,
    ) as string[];
    if (!capabilities.includes(input.capability))
      throw new HttpError(
        400,
        "device_capability_missing",
        "Device lacks this capability",
      );
    const request = requestPermission(context.store, {
      userId: context.user!.id,
      taskId: task.id,
      deviceId: device.id,
      agentId: input.agent_id ?? null,
      capability: input.capability,
      resource: input.resource,
      argumentsJson: JSON.stringify(input.arguments),
    });
    context.audit(
      context.user!.id,
      context.user!.id,
      "permission.request",
      `permission:${request.id}`,
      request.status,
    );
    sendJson(context.response, 201, request);
  });

  router.add("POST", "/v1/permissions/:id/decision", (context) => {
    const input = z
      .object({ decision: z.enum(["allow_once", "deny"]) })
      .strict()
      .parse(context.body);
    const result = decidePermission(
      context.store,
      context.user!.id,
      context.params.id,
      input.decision,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "permission.decision",
      `permission:${result.id}`,
      input.decision,
    );
    return result;
  });
}
