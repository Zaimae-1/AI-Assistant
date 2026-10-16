import OpenAI from "openai";
import type {
  Response,
  ResponseInputItem,
  FunctionTool,
} from "openai/resources/responses/responses";
import type {
  AIProvider,
  ProviderItem,
  ProviderRequest,
  ProviderResult,
} from "./provider.js";

function inputItem(item: ProviderItem): ResponseInputItem {
  if (item.type === "message")
    return { role: item.role, content: item.content };
  if (item.type === "function_call") {
    return {
      type: "function_call",
      call_id: item.callId,
      name: item.name,
      arguments: item.arguments,
    };
  }
  return {
    type: "function_call_output",
    call_id: item.callId,
    output: item.output,
  };
}

function resultFrom(response: Response): ProviderResult {
  if (response.status !== "completed")
    throw new Error(`OpenAI response status: ${response.status}`);
  return {
    text: response.output_text ?? "",
    calls: response.output
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        callId: item.call_id,
        name: item.name,
        arguments: item.arguments,
      })),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: 1,
      timeout: 60_000,
    });
  }

  private params(request: ProviderRequest) {
    const tools: FunctionTool[] = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    }));
    return {
      model: request.model,
      instructions: request.instructions,
      input: request.items.map(inputItem),
      tools,
      store: false,
    };
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    const response = await this.client.responses.create({
      ...this.params(request),
      stream: false,
    });
    return resultFrom(response);
  }

  async stream(
    request: ProviderRequest,
    onText: (delta: string) => void,
  ): Promise<ProviderResult> {
    const stream = await this.client.responses.create({
      ...this.params(request),
      stream: true,
    });
    let completed: Response | undefined;
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") onText(event.delta);
      if (event.type === "response.completed") completed = event.response;
      if (event.type === "response.failed")
        throw new Error("OpenAI response failed");
    }
    if (!completed)
      throw new Error("OpenAI stream ended without a completed response");
    return resultFrom(completed);
  }
}
