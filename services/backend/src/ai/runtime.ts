import type { AIProvider, ProviderItem } from "./provider.js";
import { executeSafeTool, safeTools } from "./tools.js";

export interface RunOptions {
  provider: AIProvider;
  model: string;
  instructions: string;
  context: ProviderItem[];
  stream: boolean;
  onText?: (delta: string) => void;
  onTool?: (name: string, output: string) => void;
}

export async function runAgent(options: RunOptions) {
  const items = [...options.context];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let toolCount = 0;
  for (let round = 0; round < 4; round++) {
    const request = {
      model: options.model,
      instructions: options.instructions,
      items,
      tools: safeTools,
    };
    const result = options.stream
      ? await options.provider.stream(
          request,
          options.onText ?? (() => undefined),
        )
      : await options.provider.generate(request);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    if (result.calls.length === 0)
      return { text: result.text, usage, toolCount };
    if (round === 3 || toolCount + result.calls.length > 8) {
      throw new Error("Tool round or call limit reached");
    }
    if (result.text)
      items.push({ type: "message", role: "assistant", content: result.text });
    for (const call of result.calls) {
      const output = executeSafeTool(call.name, call.arguments);
      items.push({
        type: "function_call",
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
      });
      items.push({ type: "function_call_output", callId: call.callId, output });
      options.onTool?.(call.name, output);
      toolCount++;
    }
  }
  throw new Error("Tool execution ended without a final response");
}
