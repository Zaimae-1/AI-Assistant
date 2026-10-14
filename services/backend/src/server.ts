import { createApp } from "./app.js";

const rawPort = process.env.JARVIS_BACKEND_PORT ?? "3001";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("JARVIS_BACKEND_PORT must be an integer from 1 to 65535");
}

createApp().listen(port, "127.0.0.1", () => {
  console.log(`Jarvis backend ready at http://127.0.0.1:${port}`);
});
