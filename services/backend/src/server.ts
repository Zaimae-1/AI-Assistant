import { createApp } from "./app.js";
import { configuredProvider } from "./ai/config.js";
import { Store } from "./store.js";

const rawPort = process.env.JARVIS_BACKEND_PORT ?? "3001";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("JARVIS_BACKEND_PORT must be an integer from 1 to 65535");
}

const store = new Store(process.env.JARVIS_DB_PATH ?? ".data/jarvis.db");
const { provider } = configuredProvider();
createApp({ store, provider }).listen(port, "127.0.0.1", () => {
  console.log(`Jarvis backend ready at http://127.0.0.1:${port}`);
});
