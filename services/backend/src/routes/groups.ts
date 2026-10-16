import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertFound, HttpError } from "../errors.js";
import { sendJson, type Router } from "../http.js";
import { ownedAgent } from "./agents.js";
import type { Store } from "../store.js";

export function ownedGroup(store: Store, userId: string, groupId: string) {
  return assertFound(
    store.get<{
      id: string;
      user_id: string;
      name: string;
      project_context: string;
    }>("SELECT * FROM agent_groups WHERE id=? AND user_id=?", groupId, userId),
    "Group",
  );
}

export function groupMembers(store: Store, userId: string, groupId: string) {
  ownedGroup(store, userId, groupId);
  return store.all<{ id: string; name: string; role: string; status: string }>(
    "SELECT a.id,a.name,a.role,a.status FROM group_members gm JOIN agents a ON a.id=gm.agent_id WHERE gm.group_id=? AND a.user_id=? AND a.deleted_at IS NULL ORDER BY a.name",
    groupId,
    userId,
  );
}

export function registerGroupRoutes(router: Router): void {
  router.add("GET", "/v1/groups", (context) =>
    context.store.all(
      "SELECT * FROM agent_groups WHERE user_id=? ORDER BY created_at",
      context.user!.id,
    ),
  );

  router.add("POST", "/v1/groups", (context) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        project_context: z.string().max(20_000).default(""),
      })
      .strict()
      .parse(context.body);
    const id = randomUUID();
    context.store.run(
      "INSERT INTO agent_groups (id,user_id,name,project_context,created_at) VALUES (?,?,?,?,?)",
      id,
      context.user!.id,
      input.name,
      input.project_context,
      new Date().toISOString(),
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "group.create",
      `group:${id}`,
      "succeeded",
    );
    sendJson(context.response, 201, {
      ...ownedGroup(context.store, context.user!.id, id),
      members: [],
    });
  });

  router.add("GET", "/v1/groups/:id", (context) => ({
    ...ownedGroup(context.store, context.user!.id, context.params.id),
    members: groupMembers(context.store, context.user!.id, context.params.id),
  }));

  router.add("PATCH", "/v1/groups/:id", (context) => {
    ownedGroup(context.store, context.user!.id, context.params.id);
    const input = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        project_context: z.string().max(20_000).optional(),
      })
      .strict()
      .parse(context.body);
    if (!input.name && input.project_context === undefined)
      throw new HttpError(400, "invalid_input", "No fields to update");
    const old = ownedGroup(context.store, context.user!.id, context.params.id);
    context.store.run(
      "UPDATE agent_groups SET name=?,project_context=? WHERE id=? AND user_id=?",
      input.name ?? old.name,
      input.project_context ?? old.project_context,
      old.id,
      context.user!.id,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "group.update",
      `group:${old.id}`,
      "succeeded",
    );
    return {
      ...ownedGroup(context.store, context.user!.id, old.id),
      members: groupMembers(context.store, context.user!.id, old.id),
    };
  });

  router.add("POST", "/v1/groups/:id/members", (context) => {
    const input = z.object({ agent_id: z.uuid() }).strict().parse(context.body);
    ownedGroup(context.store, context.user!.id, context.params.id);
    ownedAgent(context.store, context.user!.id, input.agent_id);
    context.store.run(
      "INSERT OR IGNORE INTO group_members (group_id,agent_id) VALUES (?,?)",
      context.params.id,
      input.agent_id,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "group.member.add",
      `group:${context.params.id}`,
      "succeeded",
    );
    return {
      members: groupMembers(context.store, context.user!.id, context.params.id),
    };
  });

  router.add("DELETE", "/v1/groups/:id/members/:agentId", (context) => {
    ownedGroup(context.store, context.user!.id, context.params.id);
    ownedAgent(context.store, context.user!.id, context.params.agentId);
    context.store.run(
      "DELETE FROM group_members WHERE group_id=? AND agent_id=?",
      context.params.id,
      context.params.agentId,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "group.member.remove",
      `group:${context.params.id}`,
      "succeeded",
    );
    return {
      members: groupMembers(context.store, context.user!.id, context.params.id),
    };
  });
}
