import type { AIProvider } from "./provider.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";

export function configuredProvider(env = process.env): {
  name: "gemini" | "openai";
  provider?: AIProvider;
} {
  const name = env.JARVIS_AI_PROVIDER ?? "gemini";
  if (name === "gemini") {
    return {
      name,
      provider: env.GEMINI_API_KEY
        ? new GeminiProvider(env.GEMINI_API_KEY)
        : undefined,
    };
  }
  if (name === "openai") {
    return {
      name,
      provider: env.OPENAI_API_KEY
        ? new OpenAIProvider(env.OPENAI_API_KEY)
        : undefined,
    };
  }
  throw new Error("JARVIS_AI_PROVIDER must be gemini or openai");
}
