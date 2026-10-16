import type { ServerResponse } from "node:http";
import type { Router } from "./http.js";

export class EventHub {
  private readonly listeners = new Map<string, Set<ServerResponse>>();

  publish(userId: string, event: Record<string, unknown>): void {
    for (const response of this.listeners.get(userId) ?? []) {
      response.write(
        `event: activity\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    }
  }

  subscribe(userId: string, response: ServerResponse): () => void {
    const set = this.listeners.get(userId) ?? new Set<ServerResponse>();
    set.add(response);
    this.listeners.set(userId, set);
    return () => {
      set.delete(response);
      if (set.size === 0) this.listeners.delete(userId);
    };
  }
}

export function registerEventRoutes(router: Router, hub: EventHub): void {
  router.add("GET", "/v1/audit", (context) =>
    context.store.all(
      `SELECT id,actor_kind,actor_id,action,resource,result,created_at
       FROM audit_events WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 200`,
      context.user!.id,
    ),
  );

  router.add("GET", "/v1/events", (context) => {
    context.response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    context.response.write(": connected\n\n");
    const unsubscribe = hub.subscribe(context.user!.id, context.response);
    const heartbeat = setInterval(
      () => context.response.write(": keepalive\n\n"),
      15_000,
    );
    context.request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
