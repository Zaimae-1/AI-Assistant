import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { OpenAIProvider } from "../src/ai/openai.js";

test("OpenAI adapter sends a private Responses request and maps usage", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/responses");
    assert.equal(request.headers.authorization, "Bearer test-key");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "Hello from the adapter",
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
      }),
    );
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const provider = new OpenAIProvider(
      "test-key",
      `http://127.0.0.1:${address.port}`,
    );
    const result = await provider.generate({
      model: "test-model",
      instructions: "You are helpful",
      items: [{ type: "message", role: "user", content: "Hello" }],
      tools: [],
    });
    assert.equal(result.text, "Hello from the adapter");
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
    assert.equal(requestBody?.store, false);
    assert.equal(requestBody?.model, "test-model");
  } finally {
    server.close();
    await once(server, "close");
  }
});
