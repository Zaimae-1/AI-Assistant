import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
import { consumePermission } from "../src/permissions.js";
import type { AIProvider, ProviderRequest } from "../src/ai/provider.js";

class FakeProvider implements AIProvider {
  readonly name = "fake";
  requests: ProviderRequest[] = [];

  async generate(request: ProviderRequest) {
    this.requests.push(request);
    if (!request.items.some((item) => item.type === "function_call_output")) {
      return {
        text: "",
        calls: [
          { callId: "clock", name: "current_time", arguments: "{}" },
          {
            callId: "math",
            name: "calculate",
            arguments: '{"operation":"multiply","left":7,"right":6}',
          },
        ],
        usage: { inputTokens: 20, outputTokens: 5 },
      };
    }
    return {
      text: "Hasilnya 42.",
      calls: [],
      usage: { inputTokens: 10, outputTokens: 7 },
    };
  }

  async stream(request: ProviderRequest, onText: (delta: string) => void) {
    const result = await this.generate(request);
    if (result.text) onText(result.text);
    return result;
  }
}

async function harness(provider?: AIProvider) {
  const store = new Store();
  const server = createApp({
    store,
    provider,
    models: { fast: "test-fast", deep: "test-deep" },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  async function api(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  async function register(email: string) {
    const result = await api("/v1/auth/register", "POST", {
      email,
      password: "a-secure-test-password",
      display_name: email,
    });
    assert.equal(result.status, 201);
    return result.body as { token: string; user: { id: string } };
  }
  return {
    store,
    base,
    api,
    register,
    close: async () => {
      server.close();
      await once(server, "close");
      store.close();
    },
  };
}

test("sessions and owned records isolate two users", async () => {
  const h = await harness();
  try {
    const a = await h.register("alice@example.test");
    const b = await h.register("bob@example.test");
    const agent = await h.api(
      "/v1/agents",
      "POST",
      { name: "Tutor", role: "study" },
      a.token,
    );
    assert.equal(agent.status, 201);
    assert.equal(
      (await h.api(`/v1/agents/${agent.body.id}`, "GET", undefined, b.token))
        .status,
      404,
    );
    assert.equal(
      (await h.api("/v1/agents", "GET", undefined, b.token)).body.length,
      0,
    );
    assert.equal(
      (await h.api("/v1/auth/logout", "POST", {}, a.token)).status,
      200,
    );
    assert.equal(
      (await h.api("/v1/me", "GET", undefined, a.token)).status,
      401,
    );
  } finally {
    await h.close();
  }
});

test("profile, device registry, audit, and realtime activity work for one account", async () => {
  const h = await harness();
  const abort = new AbortController();
  try {
    const user = await h.register("events@example.test");
    const profile = await h.api(
      "/v1/me",
      "PATCH",
      { display_name: "New Name" },
      user.token,
    );
    assert.equal(profile.body.display_name, "New Name");
    const stream = await fetch(`${h.base}/v1/events`, {
      headers: { authorization: `Bearer ${user.token}` },
      signal: abort.signal,
    });
    assert.equal(stream.status, 200);
    assert.equal(
      stream.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );
    const device = await h.api(
      "/v1/devices",
      "POST",
      { name: "Laptop", platform: "windows", capabilities: ["file.read"] },
      user.token,
    );
    assert.equal(device.status, 201);
    assert.equal(
      (await h.api("/v1/devices", "GET", undefined, user.token)).body.length,
      1,
    );
    const chunk = await stream.body!.getReader().read();
    assert.match(new TextDecoder().decode(chunk.value), /connected|activity/);
    assert.ok(
      (await h.api("/v1/audit", "GET", undefined, user.token)).body.some(
        (event: { action: string }) => event.action === "device.register",
      ),
    );
  } finally {
    abort.abort();
    await h.close();
  }
});

test("group mentions route to one member and workflow runs once", async () => {
  const h = await harness();
  try {
    const user = await h.register("flow@example.test");
    const agent = (
      await h.api(
        "/v1/agents",
        "POST",
        { name: "Tutor", role: "learning" },
        user.token,
      )
    ).body;
    const other = (
      await h.api(
        "/v1/agents",
        "POST",
        { name: "Planner", role: "planning" },
        user.token,
      )
    ).body;
    const group = (
      await h.api(
        "/v1/groups",
        "POST",
        { name: "Study", project_context: "Biology exam" },
        user.token,
      )
    ).body;
    await h.api(
      `/v1/groups/${group.id}/members`,
      "POST",
      { agent_id: agent.id },
      user.token,
    );
    await h.api(
      `/v1/groups/${group.id}/members`,
      "POST",
      { agent_id: other.id },
      user.token,
    );
    const conversation = (
      await h.api(
        "/v1/conversations",
        "POST",
        { title: "Study", group_id: group.id },
        user.token,
      )
    ).body;
    const message = await h.api(
      `/v1/conversations/${conversation.id}/messages`,
      "POST",
      { content: "@Tutor explain this" },
      user.token,
    );
    assert.equal(message.status, 201);
    assert.equal(message.body.target_agent_id, agent.id);
    assert.equal(
      (
        await h.api(
          `/v1/conversations/${conversation.id}/messages`,
          "POST",
          { content: "@Stranger hello" },
          user.token,
        )
      ).status,
      400,
    );
    const handoffTask = (
      await h.api(
        "/v1/tasks",
        "POST",
        {
          title: "Group research",
          agent_id: agent.id,
          conversation_id: conversation.id,
        },
        user.token,
      )
    ).body;
    assert.equal(
      (
        await h.api(
          `/v1/tasks/${handoffTask.id}/handoff`,
          "POST",
          { target_agent_id: agent.id, reason: "Same agent" },
          user.token,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await h.api(
          `/v1/tasks/${handoffTask.id}/handoff`,
          "POST",
          { target_agent_id: other.id, reason: "Plan next step" },
          user.token,
        )
      ).body.hop_number,
      1,
    );
    assert.equal(
      (
        await h.api(
          `/v1/tasks/${handoffTask.id}/handoff`,
          "POST",
          { target_agent_id: agent.id, reason: "Review result" },
          user.token,
        )
      ).body.hop_number,
      2,
    );
    assert.equal(
      (
        await h.api(
          `/v1/tasks/${handoffTask.id}/handoff`,
          "POST",
          { target_agent_id: other.id, reason: "Third hop" },
          user.token,
        )
      ).status,
      409,
    );
    const task = (
      await h.api(
        "/v1/tasks",
        "POST",
        { title: "Study calculation", agent_id: agent.id },
        user.token,
      )
    ).body;
    const workflow = await h.api(
      `/v1/tasks/${task.id}/workflow`,
      "POST",
      {
        steps: [
          { title: "Time", tool_name: "current_time", arguments: {} },
          {
            title: "Answer",
            tool_name: "calculate",
            arguments: { operation: "multiply", left: 7, right: 6 },
          },
        ],
      },
      user.token,
    );
    assert.equal(workflow.status, 201);
    const headers = { "idempotency-key": "same-workflow-run-001" };
    const first = await h.api(
      `/v1/tasks/${task.id}/run`,
      "POST",
      {},
      user.token,
      headers,
    );
    const replay = await h.api(
      `/v1/tasks/${task.id}/run`,
      "POST",
      {},
      user.token,
      headers,
    );
    assert.equal(first.status, 200);
    assert.deepEqual(replay.body, first.body);
    assert.equal(JSON.parse(first.body.outputs[1].output).result, 42);
    assert.equal(
      (await h.api(`/v1/tasks/${task.id}`, "GET", undefined, user.token)).body
        .state,
      "succeeded",
    );
    assert.equal(
      (
        await h.api(
          `/v1/tasks/${task.id}`,
          "PATCH",
          { state: "running" },
          user.token,
        )
      ).status,
      409,
    );
  } finally {
    await h.close();
  }
});

test("risk two permission requires fresh approval and nonce is one use", async () => {
  const h = await harness();
  try {
    const user = await h.register("permission@example.test");
    const task = (
      await h.api("/v1/tasks", "POST", { title: "Run tests" }, user.token)
    ).body;
    const device = (
      await h.api(
        "/v1/devices",
        "POST",
        { name: "Laptop", platform: "windows", capabilities: ["test.run"] },
        user.token,
      )
    ).body;
    assert.equal(
      (
        await h.api(
          "/v1/permission-policies",
          "POST",
          {
            capability: "test.run",
            resource: "project:one",
            decision: "always_allow",
          },
          user.token,
        )
      ).status,
      400,
    );
    const requested = await h.api(
      "/v1/permissions",
      "POST",
      {
        task_id: task.id,
        device_id: device.id,
        capability: "test.run",
        resource: "project:one",
        arguments: { test_profile_id: "unit" },
      },
      user.token,
    );
    assert.equal(requested.status, 201);
    assert.equal(requested.body.status, "pending");
    const decision = await h.api(
      `/v1/permissions/${requested.body.id}/decision`,
      "POST",
      { decision: "allow_once" },
      user.token,
    );
    assert.equal(decision.status, 200);
    const scope = {
      userId: user.user.id,
      taskId: task.id,
      deviceId: device.id,
      agentId: null,
      capability: "test.run",
      resource: "project:one",
      argumentsJson: '{"test_profile_id":"unit"}',
    };
    assert.equal(
      consumePermission(
        h.store,
        { ...scope, argumentsJson: '{"test_profile_id":"other"}' },
        requested.body.id,
        decision.body.nonce,
      ),
      false,
    );
    assert.equal(
      consumePermission(h.store, scope, requested.body.id, decision.body.nonce),
      true,
    );
    assert.equal(
      consumePermission(h.store, scope, requested.body.id, decision.body.nonce),
      false,
    );
  } finally {
    await h.close();
  }
});

test("device command is scoped, claimed once, and revoked with device", async () => {
  const h = await harness();
  try {
    const user = await h.register("local-agent@example.test");
    const task = (
      await h.api("/v1/tasks", "POST", { title: "Review changes" }, user.token)
    ).body;
    const created = await h.api(
      "/v1/devices",
      "POST",
      {
        name: "Laptop",
        platform: "windows",
        capabilities: ["git.status"],
      },
      user.token,
    );
    assert.equal(created.status, 201);
    const device = created.body;
    assert.ok(device.device_token);
    assert.equal(device.token_hash, undefined);
    assert.equal(
      (await h.api("/v1/devices", "GET", undefined, user.token)).body[0]
        .device_token,
      undefined,
    );
    const request = await h.api(
      "/v1/permissions",
      "POST",
      {
        task_id: task.id,
        device_id: device.id,
        capability: "git.status",
        resource: "C:\\selected-project",
      },
      user.token,
    );
    assert.equal(request.body.status, "pending");
    const decision = await h.api(
      `/v1/permissions/${request.body.id}/decision`,
      "POST",
      {
        decision: "allow_once",
      },
      user.token,
    );
    const body = {
      task_id: task.id,
      device_id: device.id,
      capability: "git.status",
      resource: "C:\\selected-project",
      arguments: {},
      permission_request_id: request.body.id,
      nonce: decision.body.nonce,
      idempotency_key: "review-git-status-0001",
    };
    assert.equal(
      (
        await h.api(
          "/v1/device-commands",
          "POST",
          {
            ...body,
            resource: "C:\\other-project",
          },
          user.token,
        )
      ).status,
      403,
    );
    const queued = await h.api("/v1/device-commands", "POST", body, user.token);
    assert.equal(queued.status, 201);
    assert.ok(queued.body.expires_at <= request.body.expires_at);
    assert.equal(
      (await h.api("/v1/device-commands", "POST", body, user.token)).body.id,
      queued.body.id,
    );
    assert.equal(
      (
        await h.api(
          "/v1/device-commands",
          "POST",
          {
            ...body,
            idempotency_key: "review-git-status-0002",
          },
          user.token,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.api(
          `/v1/devices/${device.id}/commands/claim`,
          "POST",
          {},
          user.token,
        )
      ).status,
      401,
    );
    const claimed = await h.api(
      `/v1/devices/${device.id}/commands/claim`,
      "POST",
      {},
      device.device_token,
    );
    assert.equal(claimed.body.command.id, queued.body.id);
    assert.equal(
      (
        await h.api(
          `/v1/devices/${device.id}/commands/claim`,
          "POST",
          {},
          device.device_token,
        )
      ).body.command,
      null,
    );
    h.store.run(
      "UPDATE devices SET last_seen=? WHERE id=?",
      "2020-01-01T00:00:00.000Z",
      device.id,
    );
    await h.api(
      `/v1/devices/${device.id}/commands/claim`,
      "POST",
      {},
      device.device_token,
    );
    assert.ok(
      (await h.api("/v1/devices", "GET", undefined, user.token)).body[0]
        .last_seen > "2020-01-01T00:00:00.000Z",
    );
    assert.equal(
      (
        await h.api(
          `/v1/devices/${device.id}/commands/${queued.body.id}/authorize`,
          "POST",
          {},
          device.device_token,
        )
      ).body.authorized,
      true,
    );
    const path = `/v1/devices/${device.id}/commands/${queued.body.id}/result`;
    assert.equal(
      (
        await h.api(
          path,
          "POST",
          { status: "succeeded", output: "clean" },
          device.device_token,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await h.api(
          `/v1/devices/${device.id}/commands/${queued.body.id}/authorize`,
          "POST",
          {},
          device.device_token,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.api(
          path,
          "POST",
          { status: "succeeded", output: "clean" },
          device.device_token,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await h.api(
          `/v1/device-commands/${queued.body.id}`,
          "GET",
          undefined,
          user.token,
        )
      ).body.output,
      "clean",
    );
    const audit = (await h.api("/v1/audit", "GET", undefined, user.token)).body;
    for (const action of [
      "device.command.queue",
      "device.command.claim",
      "device.command.result",
    ]) {
      assert.ok(
        audit.some((event: { action: string }) => event.action === action),
      );
    }
    const rotated = await h.api(
      `/v1/devices/${device.id}/rotate-token`,
      "POST",
      {},
      user.token,
    );
    assert.equal(rotated.status, 200);
    assert.equal(
      (
        await h.api(
          `/v1/devices/${device.id}/identity`,
          "GET",
          undefined,
          device.device_token,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await h.api(
          `/v1/devices/${device.id}/identity`,
          "GET",
          undefined,
          rotated.body.device_token,
        )
      ).status,
      200,
    );
    await h.api(`/v1/devices/${device.id}`, "DELETE", undefined, user.token);
    assert.equal(
      (
        await h.api(
          `/v1/devices/${device.id}/identity`,
          "GET",
          undefined,
          rotated.body.device_token,
        )
      ).status,
      401,
    );
  } finally {
    await h.close();
  }
});

test("application control requires a named profile and closes only a recorded launch", async () => {
  const h = await harness();
  try {
    const user = await h.register("apps@example.test");
    const task = (
      await h.api("/v1/tasks", "POST", { title: "Open study app" }, user.token)
    ).body;
    const device = (
      await h.api(
        "/v1/devices",
        "POST",
        {
          name: "Laptop",
          platform: "windows",
          capabilities: ["app.open", "app.close"],
        },
        user.token,
      )
    ).body;
    const permission = await h.api(
      "/v1/permissions",
      "POST",
      {
        task_id: task.id,
        device_id: device.id,
        capability: "app.open",
        resource: "app:browser",
        arguments: { app_profile_id: "browser" },
      },
      user.token,
    );
    assert.equal(permission.body.status, "pending");
    const decision = await h.api(
      `/v1/permissions/${permission.body.id}/decision`,
      "POST",
      {
        decision: "allow_once",
      },
      user.token,
    );
    const base = {
      task_id: task.id,
      device_id: device.id,
      capability: "app.open",
      resource: "app:browser",
      arguments: { app_profile_id: "browser" },
      permission_request_id: permission.body.id,
      nonce: decision.body.nonce,
      idempotency_key: "launch-browser-0001",
    };
    assert.equal(
      (
        await h.api(
          "/v1/device-commands",
          "POST",
          {
            ...base,
            arguments: { app_profile_id: "editor" },
            resource: "app:editor",
          },
          user.token,
        )
      ).status,
      403,
    );
    const opened = await h.api("/v1/device-commands", "POST", base, user.token);
    assert.equal(opened.status, 201);
    const closeArgs = { launch_id: opened.body.id };
    assert.equal(
      (
        await h.api(
          "/v1/permissions",
          "POST",
          {
            task_id: task.id,
            device_id: device.id,
            capability: "app.close",
            resource: "app:wrong",
            arguments: closeArgs,
          },
          user.token,
        )
      ).status,
      400,
    );
    const closePermission = await h.api(
      "/v1/permissions",
      "POST",
      {
        task_id: task.id,
        device_id: device.id,
        capability: "app.close",
        resource: `app:${opened.body.id}`,
        arguments: closeArgs,
      },
      user.token,
    );
    const closeDecision = await h.api(
      `/v1/permissions/${closePermission.body.id}/decision`,
      "POST",
      {
        decision: "allow_once",
      },
      user.token,
    );
    const closeBase = {
      task_id: task.id,
      device_id: device.id,
      capability: "app.close",
      resource: `app:${opened.body.id}`,
      arguments: closeArgs,
      permission_request_id: closePermission.body.id,
      nonce: closeDecision.body.nonce,
      idempotency_key: "close-browser-0001",
    };
    assert.equal(
      (await h.api("/v1/device-commands", "POST", closeBase, user.token))
        .status,
      400,
    );
    await h.api(
      `/v1/devices/${device.id}/commands/claim`,
      "POST",
      {},
      device.device_token,
    );
    await h.api(
      `/v1/devices/${device.id}/commands/${opened.body.id}/result`,
      "POST",
      {
        status: "succeeded",
        output: JSON.stringify({ launch_id: opened.body.id }),
      },
      device.device_token,
    );
    assert.equal(
      (await h.api("/v1/device-commands", "POST", closeBase, user.token))
        .status,
      201,
    );
  } finally {
    await h.close();
  }
});

test("AI provider tool loop stores response and usage without automatic memory", async () => {
  const provider = new FakeProvider();
  const h = await harness(provider);
  try {
    const user = await h.register("ai@example.test");
    const agent = (
      await h.api(
        "/v1/agents",
        "POST",
        { name: "Jarvis", role: "general", memory_enabled: true },
        user.token,
      )
    ).body;
    const conversation = (
      await h.api(
        "/v1/conversations",
        "POST",
        { title: "Math", agent_id: agent.id },
        user.token,
      )
    ).body;
    await h.api(
      `/v1/conversations/${conversation.id}/messages`,
      "POST",
      { content: "What is 7 times 6?" },
      user.token,
    );
    const response = await h.api(
      `/v1/conversations/${conversation.id}/respond`,
      "POST",
      { stream: false },
      user.token,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.text, "Hasilnya 42.");
    assert.equal(response.body.tool_calls, 2);
    assert.equal(response.body.usage.inputTokens, 30);
    assert.equal(provider.requests.length, 2);
    assert.equal(
      (
        await h.api(
          `/v1/agents/${agent.id}/memories`,
          "GET",
          undefined,
          user.token,
        )
      ).body.length,
      0,
    );
    assert.equal(
      (await h.api("/v1/usage", "GET", undefined, user.token)).body[0]
        .input_tokens,
      30,
    );
    assert.equal(
      (
        await h.api(
          `/v1/conversations/${conversation.id}/messages`,
          "GET",
          undefined,
          user.token,
        )
      ).body.length,
      2,
    );
  } finally {
    await h.close();
  }
});

test("provider credit failure is clear and never saves an assistant reply", async () => {
  const unavailable: AIProvider = {
    name: "fake",
    async generate() {
      throw Object.assign(new Error("private provider details"), {
        status: 429,
        code: "credit_balance_exhausted",
      });
    },
    async stream() {
      throw Object.assign(new Error("private provider details"), {
        status: 429,
        code: "credit_balance_exhausted",
      });
    },
  };
  const h = await harness(unavailable);
  try {
    const user = await h.register("quota@example.test");
    const agent = (
      await h.api(
        "/v1/agents",
        "POST",
        { name: "Tutor", role: "learning" },
        user.token,
      )
    ).body;
    const conversation = (
      await h.api(
        "/v1/conversations",
        "POST",
        { title: "Study", agent_id: agent.id },
        user.token,
      )
    ).body;
    await h.api(
      `/v1/conversations/${conversation.id}/messages`,
      "POST",
      { content: "Hello" },
      user.token,
    );
    const ordinary = await h.api(
      `/v1/conversations/${conversation.id}/respond`,
      "POST",
      { stream: false },
      user.token,
    );
    assert.equal(ordinary.status, 429);
    assert.equal(ordinary.body.error, "provider_quota_exhausted");
    assert.ok(
      !JSON.stringify(ordinary.body).includes("private provider details"),
    );
    const streamed = await fetch(
      `${h.base}/v1/conversations/${conversation.id}/respond`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${user.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ stream: true }),
      },
    );
    assert.equal(streamed.status, 200);
    assert.match(await streamed.text(), /provider_quota_exhausted/);
    assert.equal(
      (
        await h.api(
          `/v1/conversations/${conversation.id}/messages`,
          "GET",
          undefined,
          user.token,
        )
      ).body.length,
      1,
    );
  } finally {
    await h.close();
  }
});

test("streamed response includes deltas and opted-in memory, while expired memory is hidden", async () => {
  const provider = new FakeProvider();
  const h = await harness(provider);
  try {
    const user = await h.register("stream@example.test");
    const agent = (
      await h.api(
        "/v1/agents",
        "POST",
        { name: "Tutor", role: "learning", memory_enabled: true },
        user.token,
      )
    ).body;
    const memory = await h.api(
      `/v1/agents/${agent.id}/memories`,
      "POST",
      { content: "Biology study plan", retention_days: 30 },
      user.token,
    );
    assert.equal(memory.status, 201);
    h.store.run(
      "UPDATE memories SET expires_at=? WHERE id=?",
      "2020-01-01T00:00:00.000Z",
      memory.body.id,
    );
    assert.equal(
      (
        await h.api(
          `/v1/agents/${agent.id}/memories`,
          "GET",
          undefined,
          user.token,
        )
      ).body.length,
      0,
    );
    await h.api(
      `/v1/agents/${agent.id}/memories`,
      "POST",
      { content: "Biology uses spaced repetition" },
      user.token,
    );
    const conversation = (
      await h.api(
        "/v1/conversations",
        "POST",
        { title: "Biology", agent_id: agent.id },
        user.token,
      )
    ).body;
    await h.api(
      `/v1/conversations/${conversation.id}/messages`,
      "POST",
      { content: "Help me learn biology" },
      user.token,
    );
    const streaming = await fetch(
      `${h.base}/v1/conversations/${conversation.id}/respond`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${user.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ stream: true }),
      },
    );
    assert.equal(streaming.status, 200);
    const body = await streaming.text();
    assert.match(body, /event: delta/);
    assert.match(body, /event: done/);
    assert.ok(
      provider.requests[0].instructions.includes(
        "Biology uses spaced repetition",
      ),
    );
    assert.ok(
      !provider.requests[0].instructions.includes("Biology study plan"),
    );
  } finally {
    await h.close();
  }
});

test("file-backed store survives restart and upgrades older agent schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-store-"));
  const path = join(dir, "jarvis.db");
  try {
    const first = new Store(path);
    first.run(
      "INSERT INTO users (id,email,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      "owner",
      "owner@example.test",
      "hash",
      "Owner",
      "2026-01-01",
      "2026-01-01",
    );
    first.close();
    const second = new Store(path);
    assert.equal(
      second.get<{ email: string }>(
        "SELECT email FROM users WHERE id=?",
        "owner",
      )?.email,
      "owner@example.test",
    );
    second.close();
    const legacyPath = join(dir, "legacy.db");
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(
      "CREATE TABLE agents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', model TEXT, status TEXT NOT NULL DEFAULT 'idle', memory_enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    legacy.exec(
      "CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL, capabilities_json TEXT NOT NULL, last_seen TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL)",
    );
    legacy.exec(
      "CREATE TABLE permission_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL, device_id TEXT NOT NULL, agent_id TEXT, capability TEXT NOT NULL, resource TEXT NOT NULL, risk INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL, nonce_hash TEXT, consumed_at TEXT, created_at TEXT NOT NULL)",
    );
    legacy.close();
    const migrated = new Store(legacyPath);
    assert.ok(
      migrated
        .all<{ name: string }>("PRAGMA table_info(agents)")
        .some((column) => column.name === "deleted_at"),
    );
    assert.ok(
      migrated
        .all<{ name: string }>("PRAGMA table_info(devices)")
        .some((column) => column.name === "token_hash"),
    );
    assert.ok(
      migrated
        .all<{ name: string }>("PRAGMA table_info(permission_requests)")
        .some((column) => column.name === "arguments_json"),
    );
    migrated.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
