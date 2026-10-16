import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveMention } from "../../../../domains/core/src/rules.js";
import { assertFound, HttpError } from "../errors.js";
import { sendJson, type Router } from "../http.js";
import type { Store } from "../store.js";
import { ownedAgent } from "./agents.js";
import { groupMembers, ownedGroup } from "./groups.js";

export interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  agent_id: string | null;
  group_id: string | null;
  created_at: string;
}

export function ownedConversation(
  store: Store,
  userId: string,
  conversationId: string,
): ConversationRow {
  return assertFound(
    store.get<ConversationRow>(
      "SELECT * FROM conversations WHERE id=? AND user_id=?",
      conversationId,
      userId,
    ),
    "Conversation",
  );
}

export function registerConversationRoutes(router: Router): void {
  router.add("GET", "/v1/conversations", (context) =>
    context.store.all(
      "SELECT * FROM conversations WHERE user_id=? ORDER BY created_at DESC",
      context.user!.id,
    ),
  );

  router.add("POST", "/v1/conversations", (context) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(160),
        agent_id: z.uuid().optional(),
        group_id: z.uuid().optional(),
      })
      .strict()
      .parse(context.body);
    if (input.agent_id && input.group_id)
      throw new HttpError(400, "invalid_input", "Choose an agent or a group");
    if (input.agent_id)
      ownedAgent(context.store, context.user!.id, input.agent_id);
    if (input.group_id)
      ownedGroup(context.store, context.user!.id, input.group_id);
    const id = randomUUID();
    context.store.run(
      "INSERT INTO conversations (id,user_id,title,agent_id,group_id,created_at) VALUES (?,?,?,?,?,?)",
      id,
      context.user!.id,
      input.title,
      input.agent_id ?? null,
      input.group_id ?? null,
      new Date().toISOString(),
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "conversation.create",
      `conversation:${id}`,
      "succeeded",
    );
    sendJson(
      context.response,
      201,
      ownedConversation(context.store, context.user!.id, id),
    );
  });

  router.add("GET", "/v1/conversations/:id", (context) =>
    ownedConversation(context.store, context.user!.id, context.params.id),
  );

  router.add("GET", "/v1/conversations/:id/messages", (context) => {
    ownedConversation(context.store, context.user!.id, context.params.id);
    return context.store.all(
      "SELECT * FROM messages WHERE conversation_id=? AND user_id=? ORDER BY created_at,id LIMIT 200",
      context.params.id,
      context.user!.id,
    );
  });

  router.add("POST", "/v1/conversations/:id/messages", (context) => {
    const conversation = ownedConversation(
      context.store,
      context.user!.id,
      context.params.id,
    );
    const input = z
      .object({
        content: z.string().trim().min(1).max(100_000),
        reply_to_message_id: z.uuid().optional(),
      })
      .strict()
      .parse(context.body);
    if (input.reply_to_message_id) {
      assertFound(
        context.store.get(
          "SELECT id FROM messages WHERE id=? AND conversation_id=? AND user_id=?",
          input.reply_to_message_id,
          conversation.id,
          context.user!.id,
        ),
        "Reply target",
      );
    }
    let targetAgentId = conversation.agent_id;
    if (conversation.group_id) {
      try {
        targetAgentId = resolveMention(
          input.content,
          groupMembers(context.store, context.user!.id, conversation.group_id),
        );
      } catch {
        throw new HttpError(
          400,
          "invalid_mention",
          "Mention must name one agent in this group",
        );
      }
    } else if (/^@\S+/u.test(input.content)) {
      throw new HttpError(
        400,
        "invalid_mention",
        "Mentions require a group conversation",
      );
    }
    const id = randomUUID();
    context.store.run(
      "INSERT INTO messages (id,user_id,conversation_id,sender_kind,sender_id,target_agent_id,reply_to_id,content,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      id,
      context.user!.id,
      conversation.id,
      "user",
      context.user!.id,
      targetAgentId,
      input.reply_to_message_id ?? null,
      input.content,
      new Date().toISOString(),
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "message.create",
      `conversation:${conversation.id}`,
      "succeeded",
    );
    const message = context.store.get("SELECT * FROM messages WHERE id=?", id);
    sendJson(context.response, 201, message);
  });

  router.add("GET", "/v1/messages/search", (context) => {
    const query = z
      .string()
      .trim()
      .min(2)
      .max(100)
      .parse(context.query.get("q"));
    return context.store.all(
      "SELECT id,conversation_id,content,created_at FROM messages WHERE user_id=? AND content LIKE ? ORDER BY created_at DESC LIMIT 100",
      context.user!.id,
      `%${query}%`,
    );
  });
}
