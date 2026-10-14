import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";

const require = createRequire(
  new URL("../../core/protocol/package.json", import.meta.url),
);
const Ajv2020 = require("ajv/dist/2020.js");
const addFormats = require("ajv-formats");

const schema = JSON.parse(
  readFileSync(
    new URL(
      "../../core/protocol/schemas/envelope.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
});
addFormats(ajv);
const validate = ajv.compile(schema);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = (type, payload) => ({
  protocol_version: "1.0",
  message_id: id(1),
  correlation_id: id(2),
  sent_at: "2026-10-14T00:00:00Z",
  source: { kind: "backend", id: id(3) },
  type,
  payload,
});
const taskId = id(4);
const requestId = id(5);
const commandId = id(6);
const deviceId = id(7);
const expiry = "2026-10-14T00:05:00Z";

const validCases = [
  base("message.created", {
    conversation_id: id(8),
    sender: { kind: "user", id: id(9) },
    content: "Cek repo",
  }),
  {
    ...base("task.updated", {
      task_id: taskId,
      state: "running",
      attempt: 1,
      progress: 20,
    }),
    task_id: taskId,
  },
  {
    ...base("permission.requested", {
      request_id: requestId,
      device_id: deviceId,
      capability: "test.run",
      resource: "project:repo",
      risk: 1,
      expires_at: expiry,
    }),
    task_id: taskId,
  },
  {
    ...base("permission.decided", {
      request_id: requestId,
      decision: "allow_once",
      approver_user_id: id(9),
      nonce: "once-unique-value-123",
      expires_at: expiry,
    }),
    task_id: taskId,
  },
  {
    ...base("device.command.requested", {
      command_id: commandId,
      device_id: deviceId,
      project_id: id(10),
      project_root: "C:/repo",
      capability: "git.status",
      arguments: {},
      expires_at: expiry,
    }),
    task_id: taskId,
    idempotency_key: "task4-command6-first",
  },
  {
    ...base("device.command.requested", {
      command_id: commandId,
      device_id: deviceId,
      project_id: id(10),
      project_root: "C:/repo",
      capability: "test.run",
      arguments: { test_profile_id: "unit" },
      permission_request_id: requestId,
      expires_at: expiry,
    }),
    task_id: taskId,
    idempotency_key: "task4-command6-tests",
  },
  {
    ...base("device.command.result", {
      command_id: commandId,
      status: "succeeded",
      output: "Tests passed",
    }),
    task_id: taskId,
  },
];

test("all v1 event and command fixtures validate", () => {
  for (const item of validCases) {
    assert.equal(validate(item), true, JSON.stringify(validate.errors));
  }
});

test("unsupported version and unknown type fail closed", () => {
  for (const item of [
    { ...validCases[0], protocol_version: "2.0" },
    { ...validCases[0], type: "device.shutdown" },
  ]) {
    assert.equal(validate(item), false);
  }
});

test("commands require scope, idempotency and registered capability", () => {
  const command = validCases[4];
  for (const item of [
    { ...command, idempotency_key: undefined },
    { ...command, payload: { ...command.payload, project_root: undefined } },
    {
      ...command,
      payload: { ...command.payload, capability: "shell.execute" },
    },
    {
      ...command,
      payload: { ...command.payload, arguments: { arbitrary_command: "rm" } },
    },
    {
      ...validCases[5],
      payload: { ...validCases[5].payload, permission_request_id: undefined },
    },
    { ...validCases[5], payload: { ...validCases[5].payload, arguments: {} } },
  ]) {
    assert.equal(validate(item), false, JSON.stringify(item));
  }
});

test("permissions and task states are constrained", () => {
  assert.equal(
    validate({
      ...validCases[2],
      payload: { ...validCases[2].payload, risk: 5 },
    }),
    false,
  );
  assert.equal(
    validate({
      ...validCases[3],
      payload: { ...validCases[3].payload, decision: "allow_forever" },
    }),
    false,
  );
  assert.equal(
    validate({
      ...validCases[1],
      payload: { ...validCases[1].payload, state: "done" },
    }),
    false,
  );
});
