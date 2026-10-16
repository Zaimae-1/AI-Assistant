import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertFound, HttpError } from "../errors.js";
import { sendJson, type Router } from "../http.js";

const agentInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    role: z.string().trim().min(1).max(120),
    instructions: z.string().max(8000).default(""),
    model: z.enum(["automatic", "fast", "deep"]).default("automatic"),
    memory_enabled: z.boolean().default(false),
  })
  .strict();

export function ownedAgent(
  store: import("../store.js").Store,
  userId: string,
  agentId: string,
) {
  return assertFound(
    store.get<{
      id: string;
      user_id: string;
      name: string;
      role: string;
      instructions: string;
      model: string;
      status: string;
      memory_enabled: number;
    }>(
      "SELECT * FROM agents WHERE id=? AND user_id=? AND deleted_at IS NULL",
      agentId,
      userId,
    ),
    "Agent",
  );
}

export function registerAgentRoutes(router: Router): void {
  router.add("GET", "/v1/agents", (context) =>
    context.store.all(
      "SELECT * FROM agents WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at",
      context.user!.id,
    ),
  );

  router.add("POST", "/v1/agents", (context) => {
    const input = agentInput.parse(context.body);
    const id = randomUUID();
    const now = new Date().toISOString();
    context.store.run(
      "INSERT INTO agents (id,user_id,name,role,instructions,model,memory_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      id,
      context.user!.id,
      input.name,
      input.role,
      input.instructions,
      input.model,
      Number(input.memory_enabled),
      now,
      now,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "agent.create",
      `agent:${id}`,
      "succeeded",
    );
    sendJson(
      context.response,
      201,
      ownedAgent(context.store, context.user!.id, id),
    );
  });

  router.add("GET", "/v1/agents/:id", (context) =>
    ownedAgent(context.store, context.user!.id, context.params.id),
  );

  router.add("PATCH", "/v1/agents/:id", (context) => {
    ownedAgent(context.store, context.user!.id, context.params.id);
    const input = agentInput.partial().parse(context.body);
    if (Object.keys(input).length === 0)
      throw new HttpError(400, "invalid_input", "No fields to update");
    const current = ownedAgent(
      context.store,
      context.user!.id,
      context.params.id,
    );
    context.store.run(
      "UPDATE agents SET name=?,role=?,instructions=?,model=?,memory_enabled=?,updated_at=? WHERE id=? AND user_id=?",
      input.name ?? current.name,
      input.role ?? current.role,
      input.instructions ?? current.instructions,
      input.model ?? current.model,
      Number(input.memory_enabled ?? Boolean(current.memory_enabled)),
      new Date().toISOString(),
      current.id,
      context.user!.id,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "agent.update",
      `agent:${current.id}`,
      "succeeded",
    );
    return ownedAgent(context.store, context.user!.id, current.id);
  });

  router.add("DELETE", "/v1/agents/:id", (context) => {
    const agent = ownedAgent(
      context.store,
      context.user!.id,
      context.params.id,
    );
    context.store.transaction(() => {
      context.store.run(
        "DELETE FROM memories WHERE agent_id=? AND user_id=?",
        agent.id,
        context.user!.id,
      );
      context.store.run("DELETE FROM group_members WHERE agent_id=?", agent.id);
      context.store.run(
        "UPDATE agents SET deleted_at=?,status='idle',updated_at=? WHERE id=? AND user_id=?",
        new Date().toISOString(),
        new Date().toISOString(),
        agent.id,
        context.user!.id,
      );
    });
    context.audit(
      context.user!.id,
      context.user!.id,
      "agent.delete",
      `agent:${agent.id}`,
      "succeeded",
    );
    return { ok: true };
  });
}
