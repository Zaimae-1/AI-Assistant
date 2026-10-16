import assert from "node:assert/strict";
import test from "node:test";
import type { GoogleGenAI } from "@google/genai";
import { configuredProvider } from "../src/ai/config.js";
import { GeminiProvider } from "../src/ai/gemini.js";
import { modelCatalogFromEnv } from "../src/ai/models.js";
import { runAgent } from "../src/ai/runtime.js";

test("Gemini tool continuation preserves the model turn and tool result", async () => {
  const requests: Array<{
    contents: Array<{ role?: string; parts?: Array<Record<string, unknown>> }>;
    config: Record<string, unknown>;
  }> = [];
  const fake = {
    models: {
      async generateContent(request: (typeof requests)[number]) {
        requests.push(request);
        return requests.length === 1
          ? {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [
                      {
                        functionCall: {
                          name: "calculate",
                          id: "provider-call-1",
                          args: { operation: "multiply", left: 7, right: 6 },
                        },
                        thoughtSignature: "opaque-signature",
                      },
                    ],
                  },
                },
              ],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 3,
                thoughtsTokenCount: 2,
              },
            }
          : {
              candidates: [
                { content: { role: "model", parts: [{ text: "42" }] } },
              ],
              usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 2 },
            };
      },
    },
  } as unknown as GoogleGenAI;
  const result = await runAgent({
    provider: new GeminiProvider("test-key", fake),
    model: "gemini-test",
    instructions: "Be concise",
    context: [{ type: "message", role: "user", content: "7 times 6?" }],
    stream: false,
  });
  assert.equal(result.text, "42");
  assert.equal(result.toolCount, 1);
  assert.deepEqual(result.usage, { inputTokens: 25, outputTokens: 7 });
  assert.equal(requests[0].config.systemInstruction, "Be concise");
  assert.equal(
    requests[1].contents[1].parts?.[0].thoughtSignature,
    "opaque-signature",
  );
  assert.deepEqual(requests[1].contents[2].parts?.[0].functionResponse, {
    name: "calculate",
    id: "provider-call-1",
    response: { result: { result: 42 } },
  });
});

test("Gemini streaming emits text and records final usage", async () => {
  const fake = {
    models: {
      async generateContentStream() {
        return (async function* () {
          yield {
            candidates: [
              { content: { role: "model", parts: [{ text: "Se" }] } },
            ],
          };
          yield {
            candidates: [
              { content: { role: "model", parts: [{ text: "lamat" }] } },
            ],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
          };
        })();
      },
    },
  } as unknown as GoogleGenAI;
  const chunks: string[] = [];
  const result = await new GeminiProvider("test-key", fake).stream(
    {
      model: "gemini-test",
      instructions: "Hello",
      items: [{ type: "message", role: "user", content: "Hi" }],
      tools: [],
    },
    (chunk) => chunks.push(chunk),
  );
  assert.deepEqual(chunks, ["Se", "lamat"]);
  assert.equal(result.text, "Selamat");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 2 });
});

test("provider selection is explicit and never spends OpenAI credit as fallback", () => {
  const env = { JARVIS_AI_PROVIDER: "gemini", OPENAI_API_KEY: "old-key" };
  assert.deepEqual(configuredProvider(env), {
    name: "gemini",
    provider: undefined,
  });
  assert.deepEqual(modelCatalogFromEnv(env, "gemini"), {
    fast: "gemini-3.5-flash-lite",
    deep: "gemini-3.8-flash",
  });
  assert.equal(
    configuredProvider({ ...env, GEMINI_API_KEY: "gemini-key" }).provider?.name,
    "gemini",
  );
  assert.equal(
    configuredProvider({
      JARVIS_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "old-key",
    }).provider?.name,
    "openai",
  );
});

test("empty Gemini response is rejected instead of being saved as an answer", async () => {
  const fake = {
    models: {
      async generateContent() {
        return { candidates: [{ content: { role: "model", parts: [] } }] };
      },
    },
  } as unknown as GoogleGenAI;
  await assert.rejects(
    runAgent({
      provider: new GeminiProvider("test-key", fake),
      model: "gemini-test",
      instructions: "Answer",
      context: [{ type: "message", role: "user", content: "Hello" }],
      stream: false,
    }),
    { code: "empty_model_response" },
  );
});
