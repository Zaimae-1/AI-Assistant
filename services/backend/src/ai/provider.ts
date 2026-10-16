import type { Usage } from "../../../../domains/core/src/model.js";

export type ProviderItem =
  | { type: "message"; role: "user" | "assistant"; content: string }
  | { type: "function_call"; callId: string; name: string; arguments: string }
  | { type: "function_call_output"; callId: string; output: string };

export interface ProviderTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  instructions: string;
  items: ProviderItem[];
  tools: ProviderTool[];
}

export interface ProviderResult {
  text: string;
  calls: Array<{ callId: string; name: string; arguments: string }>;
  usage: Usage;
}

export interface AIProvider {
  readonly name: string;
  generate(request: ProviderRequest): Promise<ProviderResult>;
  stream(
    request: ProviderRequest,
    onText: (delta: string) => void,
  ): Promise<ProviderResult>;
}
