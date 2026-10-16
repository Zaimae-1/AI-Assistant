import { createServer } from "node:http";
import type { AIProvider } from "./ai/provider.js";
import { modelCatalogFromEnv, type ModelCatalog } from "./ai/models.js";
import { EventHub, registerEventRoutes } from "./events.js";
import { createAudit, handleError, Router } from "./http.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerAIRoutes } from "./routes/ai.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerDevicePermissionRoutes } from "./routes/devices-permissions.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerMemoryUsageRoutes } from "./routes/memory-usage.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { Store } from "./store.js";

export interface AppOptions {
  store?: Store;
  provider?: AIProvider;
  models?: ModelCatalog;
}

export function createApp(options: AppOptions = {}) {
  const store = options.store ?? new Store();
  const hub = new EventHub();
  const router = new Router();
  router.add(
    "GET",
    "/health",
    () => ({ status: "ok", service: "jarvis-backend" }),
    false,
  );
  registerAuthRoutes(router);
  registerAgentRoutes(router);
  registerGroupRoutes(router);
  registerConversationRoutes(router);
  registerTaskRoutes(router);
  registerDevicePermissionRoutes(router);
  registerEventRoutes(router, hub);
  registerMemoryUsageRoutes(router);
  registerAIRoutes(router);

  const server = createServer((request, response) => {
    const publish = (userId: string, event: Record<string, unknown>) =>
      hub.publish(userId, event);
    const audit = createAudit({ store, publish });
    void router
      .handle({
        request,
        response,
        store,
        provider: options.provider,
        models: options.models ?? modelCatalogFromEnv(),
        publish,
        audit,
      })
      .catch((error: unknown) => handleError(response, error));
  });
  if (!options.store) server.on("close", () => store.close());
  return server;
}
