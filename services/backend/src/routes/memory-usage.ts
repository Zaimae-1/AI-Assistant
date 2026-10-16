import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertFound, HttpError } from "../errors.js";
import { sendJson, type Router } from "../http.js";
import { ownedAgent } from "./agents.js";

export function registerMemoryUsageRoutes(router: Router): void {
  router.add("GET", "/v1/agents/:id/memories", (context) => {
    ownedAgent(context.store, context.user!.id, context.params.id);
    return context.store.all(
      "SELECT id,agent_id,content,source_message_id,expires_at,created_at FROM memories WHERE user_id=? AND agent_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC LIMIT 200",
      context.user!.id,
      context.params.id,
      new Date().toISOString(),
    );
  });

  router.add("POST", "/v1/agents/:id/memories", (context) => {
    const agent = ownedAgent(
      context.store,
      context.user!.id,
      context.params.id,
    );
    if (!agent.memory_enabled)
      throw new HttpError(
        409,
        "memory_disabled",
        "Enable memory for this agent first",
      );
    const input = z
      .object({
        content: z.string().trim().min(1).max(4000),
        source_message_id: z.uuid().optional(),
        retention_days: z.number().int().min(1).max(365).default(90),
      })
      .strict()
      .parse(context.body);
    if (input.source_message_id) {
      assertFound(
        context.store.get(
          "SELECT id FROM messages WHERE id=? AND user_id=?",
          input.source_message_id,
          context.user!.id,
        ),
        "Source message",
      );
    }
    const id = randomUUID();
    context.store.run(
      "INSERT INTO memories (id,user_id,agent_id,content,source_message_id,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
      id,
      context.user!.id,
      agent.id,
      input.content,
      input.source_message_id ?? null,
      new Date(
        Date.now() + input.retention_days * 24 * 60 * 60_000,
      ).toISOString(),
      new Date().toISOString(),
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "memory.create",
      `memory:${id}`,
      "succeeded",
    );
    sendJson(
      context.response,
      201,
      context.store.get(
        "SELECT id,agent_id,content,source_message_id,expires_at,created_at FROM memories WHERE id=?",
        id,
      ),
    );
  });

  router.add("DELETE", "/v1/agents/:id/memories/:memoryId", (context) => {
    ownedAgent(context.store, context.user!.id, context.params.id);
    assertFound(
      context.store.get(
        "SELECT id FROM memories WHERE id=? AND agent_id=? AND user_id=?",
        context.params.memoryId,
        context.params.id,
        context.user!.id,
      ),
      "Memory",
    );
    context.store.run(
      "DELETE FROM memories WHERE id=? AND user_id=?",
      context.params.memoryId,
      context.user!.id,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "memory.delete",
      `memory:${context.params.memoryId}`,
      "succeeded",
    );
    return { ok: true };
  });

  router.add("GET", "/v1/usage", (context) =>
    context.store.all(
      `SELECT model,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens,
              SUM(estimated_cost_micros) AS estimated_cost_micros,COUNT(*) AS requests
       FROM usage_events WHERE user_id=? GROUP BY model ORDER BY model`,
      context.user!.id,
    ),
  );
}
