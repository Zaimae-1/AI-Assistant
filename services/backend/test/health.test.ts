import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.js";

test("backend responds to health check and rejects unknown routes", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const healthy = await fetch(`${base}/health`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { status: "ok", service: "jarvis-backend" });
    assert.equal((await fetch(`${base}/missing`)).status, 404);
  } finally {
    server.close();
    await once(server, "close");
  }
});
