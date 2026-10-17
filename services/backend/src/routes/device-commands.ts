import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  deviceCapability,
  parseDeviceArguments,
  validateDeviceResource,
} from "../device-capabilities.js";
import { authenticateDevice } from "../device-auth.js";
import { assertFound, HttpError } from "../errors.js";
import { sendJson, type Router } from "../http.js";
import { consumePermission } from "../permissions.js";
import type { Store } from "../store.js";
import { ownedTask } from "./tasks.js";

interface CommandRow {
  id: string;
  user_id: string;
  task_id: string;
  device_id: string;
  agent_id: string | null;
  capability: string;
  resource: string;
  arguments_json: string;
  permission_request_id: string;
  expires_at: string;
  idempotency_key: string;
  status: string;
  output: string | null;
  error_code: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

const dispatchInput = z
  .object({
    task_id: z.uuid(),
    device_id: z.uuid(),
    capability: deviceCapability,
    resource: z.string().min(1).max(2048),
    arguments: z.record(z.string(), z.unknown()),
    permission_request_id: z.uuid(),
    nonce: z.string().min(16).max(128),
    idempotency_key: z.string().min(16).max(128),
  })
  .strict();

function publicCommand(row: CommandRow) {
  return {
    protocol_version: "1.0",
    id: row.id,
    task_id: row.task_id,
    device_id: row.device_id,
    capability: row.capability,
    resource: row.resource,
    arguments: JSON.parse(row.arguments_json),
    status: row.status,
    output: row.output,
    error_code: row.error_code,
    expires_at: row.expires_at,
    created_at: row.created_at,
    claimed_at: row.claimed_at,
    completed_at: row.completed_at,
  };
}

function command(store: Store, id: string, userId: string) {
  return assertFound(
    store.get<CommandRow>(
      "SELECT * FROM device_commands WHERE id=? AND user_id=?",
      id,
      userId,
    ),
    "Device command",
  );
}

export function registerDeviceCommandRoutes(router: Router): void {
  router.add(
    "GET",
    "/v1/devices/:id/identity",
    (context) => {
      const device = authenticateDevice(
        context.store,
        context.request,
        context.params.id,
      );
      return { device_id: device.id };
    },
    false,
  );

  router.add("POST", "/v1/device-commands", (context) => {
    const input = dispatchInput.parse(context.body);
    input.arguments = parseDeviceArguments(input.capability, input.arguments);
    validateDeviceResource(
      input.capability,
      input.device_id,
      input.resource,
      input.arguments,
    );
    const userId = context.user!.id;
    const previous = context.store.get<CommandRow>(
      "SELECT * FROM device_commands WHERE user_id=? AND device_id=? AND idempotency_key=?",
      userId,
      input.device_id,
      input.idempotency_key,
    );
    if (previous) {
      if (
        previous.task_id !== input.task_id ||
        previous.capability !== input.capability ||
        previous.resource !== input.resource ||
        previous.arguments_json !== JSON.stringify(input.arguments)
      )
        throw new HttpError(
          409,
          "idempotency_conflict",
          "Key belongs to another command",
        );
      return publicCommand(previous);
    }
    const task = ownedTask(context.store, userId, input.task_id);
    if (!["proposed", "queued", "running"].includes(task.state))
      throw new HttpError(409, "task_not_runnable", "Task is not runnable");
    const device = assertFound(
      context.store.get<{
        id: string;
        revoked_at: string | null;
        capabilities_json: string;
      }>(
        "SELECT id,revoked_at,capabilities_json FROM devices WHERE id=? AND user_id=?",
        input.device_id,
        userId,
      ),
      "Device",
    );
    if (device.revoked_at)
      throw new HttpError(409, "device_revoked", "Device is revoked");
    if (
      !(JSON.parse(device.capabilities_json) as string[]).includes(
        input.capability,
      )
    )
      throw new HttpError(
        400,
        "device_capability_missing",
        "Device lacks capability",
      );
    if (input.capability === "app.close") {
      const launch = context.store.get<{ id: string }>(
        `SELECT id FROM device_commands
         WHERE id=? AND user_id=? AND device_id=? AND capability='app.open' AND status='succeeded'`,
        input.arguments.launch_id as string,
        userId,
        device.id,
      );
      if (!launch)
        throw new HttpError(
          400,
          "unknown_launch",
          "App launch not found on this device",
        );
    }
    const id = randomUUID();
    const now = new Date();
    let expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const scope = {
      userId,
      taskId: task.id,
      deviceId: device.id,
      agentId: task.agent_id,
      capability: input.capability,
      resource: input.resource,
      argumentsJson: JSON.stringify(input.arguments),
    };
    context.store.transaction(() => {
      if (
        !consumePermission(
          context.store,
          scope,
          input.permission_request_id,
          input.nonce,
        )
      )
        throw new HttpError(
          403,
          "permission_denied",
          "Valid one-use approval required",
        );
      const grant = context.store.get<{ expires_at: string }>(
        "SELECT expires_at FROM permission_requests WHERE id=?",
        input.permission_request_id,
      )!;
      if (grant.expires_at < expiresAt) expiresAt = grant.expires_at;
      context.store.run(
        `INSERT INTO device_commands
         (id,user_id,task_id,device_id,agent_id,capability,resource,arguments_json,
          permission_request_id,expires_at,idempotency_key,status,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        userId,
        task.id,
        device.id,
        task.agent_id,
        input.capability,
        input.resource,
        JSON.stringify(input.arguments),
        input.permission_request_id,
        expiresAt,
        input.idempotency_key,
        "queued",
        now.toISOString(),
      );
    });
    context.audit(
      userId,
      userId,
      "device.command.queue",
      `command:${id}`,
      "queued",
    );
    sendJson(
      context.response,
      201,
      publicCommand(command(context.store, id, userId)),
    );
  });

  router.add("GET", "/v1/device-commands/:id", (context) =>
    publicCommand(command(context.store, context.params.id, context.user!.id)),
  );

  router.add(
    "POST",
    "/v1/devices/:id/commands/claim",
    (context) => {
      const device = authenticateDevice(
        context.store,
        context.request,
        context.params.id,
      );
      const now = new Date().toISOString();
      const claimed = context.store.transaction(() => {
        context.store.run(
          "UPDATE devices SET last_seen=? WHERE id=?",
          now,
          device.id,
        );
        context.store.run(
          "UPDATE device_commands SET status='expired',completed_at=? WHERE device_id=? AND status='queued' AND expires_at<=?",
          now,
          device.id,
          now,
        );
        const next = context.store.get<CommandRow>(
          `SELECT c.* FROM device_commands c JOIN tasks t ON t.id=c.task_id
         WHERE c.device_id=? AND c.user_id=? AND c.status='queued' AND c.expires_at>?
           AND t.state IN ('proposed','queued','running')
         ORDER BY c.created_at LIMIT 1`,
          device.id,
          device.user_id,
          now,
        );
        if (!next) return null;
        context.store.run(
          "UPDATE device_commands SET status='running',claimed_at=? WHERE id=? AND status='queued'",
          now,
          next.id,
        );
        return publicCommand(command(context.store, next.id, device.user_id));
      });
      if (claimed)
        context.audit(
          device.user_id,
          device.id,
          "device.command.claim",
          `command:${claimed.id}`,
          "running",
          "device",
        );
      return { command: claimed };
    },
    false,
  );

  router.add(
    "POST",
    "/v1/devices/:id/commands/:commandId/result",
    (context) => {
      const device = authenticateDevice(
        context.store,
        context.request,
        context.params.id,
      );
      const input = z
        .object({
          status: z.enum(["succeeded", "failed"]),
          output: z.string().max(100_000).default(""),
          error_code: z.string().max(80).optional(),
        })
        .strict()
        .parse(context.body);
      const row = command(
        context.store,
        context.params.commandId,
        device.user_id,
      );
      if (row.device_id !== device.id)
        throw new HttpError(404, "not_found", "Device command not found");
      if (["succeeded", "failed"].includes(row.status)) {
        if (
          row.status === input.status &&
          row.output === input.output &&
          row.error_code === (input.error_code ?? null)
        )
          return publicCommand(row);
        throw new HttpError(
          409,
          "result_conflict",
          "Command already completed",
        );
      }
      if (row.status !== "running")
        throw new HttpError(
          409,
          "command_not_running",
          "Command has not been claimed",
        );
      context.store.run(
        "UPDATE device_commands SET status=?,output=?,error_code=?,completed_at=? WHERE id=? AND status='running'",
        input.status,
        input.output,
        input.error_code ?? null,
        new Date().toISOString(),
        row.id,
      );
      context.audit(
        device.user_id,
        device.id,
        "device.command.result",
        `command:${row.id}`,
        input.status,
        "device",
      );
      return publicCommand(command(context.store, row.id, device.user_id));
    },
    false,
  );

  router.add(
    "POST",
    "/v1/devices/:id/commands/:commandId/authorize",
    (context) => {
      const device = authenticateDevice(
        context.store,
        context.request,
        context.params.id,
      );
      const row = command(
        context.store,
        context.params.commandId,
        device.user_id,
      );
      if (row.device_id !== device.id)
        throw new HttpError(404, "not_found", "Device command not found");
      const task = ownedTask(context.store, device.user_id, row.task_id);
      if (
        row.status !== "running" ||
        row.expires_at <= new Date().toISOString() ||
        !["proposed", "queued", "running"].includes(task.state)
      ) {
        throw new HttpError(
          403,
          "command_not_authorized",
          "Command is no longer authorized",
        );
      }
      return { authorized: true, command_id: row.id };
    },
    false,
  );
}
