import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import type { AIProvider } from "./ai/provider.js";
import type { ModelCatalog } from "./ai/models.js";
import type { SessionUser } from "./auth.js";
import { authenticate } from "./auth.js";
import { HttpError } from "./errors.js";
import type { Store } from "./store.js";

export interface Context {
  request: IncomingMessage;
  response: ServerResponse;
  store: Store;
  provider?: AIProvider;
  models: ModelCatalog;
  user?: SessionUser;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  publish: (userId: string, event: Record<string, unknown>) => void;
  audit: (
    userId: string,
    actorId: string,
    action: string,
    resource: string,
    result: string,
    actorKind?: "user" | "agent",
  ) => void;
}

type Handler = (context: Context) => Promise<unknown> | unknown;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  authenticated: boolean;
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(
    method: string,
    path: string,
    handler: Handler,
    authenticated = true,
  ): void {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:[a-zA-Z]+/g, (token) => {
        keys.push(token.slice(1));
        return "([^/]+)";
      })}$`,
    );
    this.routes.push({ method, pattern, keys, authenticated, handler });
  }

  async handle(
    context: Omit<Context, "params" | "query" | "body" | "user">,
  ): Promise<void> {
    const url = new URL(context.request.url ?? "/", "http://localhost");
    const route = this.routes.find(
      (item) =>
        item.method === context.request.method &&
        item.pattern.test(url.pathname),
    );
    if (!route) throw new HttpError(404, "not_found", "Route not found");
    const match = route.pattern.exec(url.pathname)!;
    const params = Object.fromEntries(
      route.keys.map((key, index) => [
        key,
        decodeURIComponent(match[index + 1]),
      ]),
    );
    const user = route.authenticated
      ? authenticate(context.store, context.request.headers.authorization)
      : undefined;
    const body = ["POST", "PUT", "PATCH"].includes(route.method)
      ? await readJson(context.request)
      : undefined;
    const result = await route.handler({
      ...context,
      user,
      params,
      query: url.searchParams,
      body,
    });
    if (!context.response.writableEnded && !context.response.headersSent) {
      sendJson(context.response, 200, result ?? {});
    }
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "JSON content type required",
    );
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.byteLength;
    if (bytes > 64 * 1024)
      throw new HttpError(413, "body_too_large", "Request body exceeds 64 KiB");
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Invalid JSON body");
  }
}

export function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

export function handleError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof HttpError) {
    sendJson(response, error.status, {
      error: error.code,
      message: error.message,
    });
  } else if (error instanceof ZodError) {
    sendJson(response, 400, {
      error: "invalid_input",
      message: "Request validation failed",
    });
  } else {
    console.error("Backend request failed", error);
    sendJson(response, 500, {
      error: "internal_error",
      message: "Request failed",
    });
  }
}

export function createAudit(context: Pick<Context, "store" | "publish">) {
  return (
    userId: string,
    actorId: string,
    action: string,
    resource: string,
    result: string,
    actorKind: "user" | "agent" = "user",
  ) => {
    const event = {
      id: randomUUID(),
      actor_kind: actorKind,
      actor_id: actorId,
      action,
      resource,
      result,
      created_at: new Date().toISOString(),
    };
    context.store.run(
      "INSERT INTO audit_events (id,user_id,actor_kind,actor_id,action,resource,result,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      event.id,
      userId,
      event.actor_kind,
      event.actor_id,
      event.action,
      event.resource,
      event.result,
      "{}",
      event.created_at,
    );
    context.publish(userId, event);
  };
}
