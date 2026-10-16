import { HttpError } from "../errors.js";

export interface ModelCatalog {
  fast: string;
  deep: string;
}

export function modelCatalogFromEnv(env = process.env): ModelCatalog {
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
): number | null {
  const suffix =
    model === catalog.fast ? "FAST" : model === catalog.deep ? "DEEP" : null;
  if (!suffix) return null;
  const inputRate = Number(env[`OPENAI_${suffix}_INPUT_USD_PER_MILLION`]);
  const outputRate = Number(env[`OPENAI_${suffix}_OUTPUT_USD_PER_MILLION`]);
  if (
    !Number.isFinite(inputRate) ||
    !Number.isFinite(outputRate) ||
    inputRate < 0 ||
    outputRate < 0
  ) {
    return null;
  }
  if (
    !env[`OPENAI_${suffix}_INPUT_USD_PER_MILLION`] ||
    !env[`OPENAI_${suffix}_OUTPUT_USD_PER_MILLION`]
  ) {
    return null;
  }
  return Math.round(
    usage.inputTokens * inputRate + usage.outputTokens * outputRate,
  );
}
