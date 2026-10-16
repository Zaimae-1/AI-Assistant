import { HttpError } from "../errors.js";

export interface ModelCatalog {
  fast: string;
  deep: string;
}

export function modelCatalogFromEnv(
  env = process.env,
  provider = "openai",
): ModelCatalog {
  if (provider === "gemini") {
    return {
      fast: env.GEMINI_MODEL_FAST ?? "gemini-3.5-flash-lite",
      deep: env.GEMINI_MODEL_DEEP ?? "gemini-3.8-flash",
    };
  }
  return {
    fast: env.OPENAI_MODEL_FAST ?? "gpt-5.6-terra",
    deep: env.OPENAI_MODEL_DEEP ?? "gpt-5.6-sol",
  };
}

export function selectModel(
  catalog: ModelCatalog,
  selection: "automatic" | "fast" | "deep" | string,
  task: { text: string; hasWorkflow: boolean },
): string {
  if (selection === "fast") return catalog.fast;
  if (selection === "deep") return catalog.deep;
  if (selection === "automatic") {
    const complex = task.hasWorkflow || task.text.length > 1200;
    return complex ? catalog.deep : catalog.fast;
  }
  if (selection === catalog.fast || selection === catalog.deep)
    return selection;
  throw new HttpError(
    400,
    "unsupported_model",
    "Model must be one of the configured models",
  );
}

export function estimateCostMicros(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
  catalog: ModelCatalog,
  env = process.env,
  provider = "openai",
): number | null {
  const suffix =
    model === catalog.fast ? "FAST" : model === catalog.deep ? "DEEP" : null;
  if (!suffix) return null;
  const prefix = provider.toUpperCase();
  const inputRate = Number(env[`${prefix}_${suffix}_INPUT_USD_PER_MILLION`]);
  const outputRate = Number(env[`${prefix}_${suffix}_OUTPUT_USD_PER_MILLION`]);
  if (
    !Number.isFinite(inputRate) ||
    !Number.isFinite(outputRate) ||
    inputRate < 0 ||
    outputRate < 0
  ) {
    return null;
  }
  if (
    !env[`${prefix}_${suffix}_INPUT_USD_PER_MILLION`] ||
    !env[`${prefix}_${suffix}_OUTPUT_USD_PER_MILLION`]
  ) {
    return null;
  }
  return Math.round(
    usage.inputTokens * inputRate + usage.outputTokens * outputRate,
  );
}
