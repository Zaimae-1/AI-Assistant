import { randomUUID } from "node:crypto";
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
} from "@google/genai";
import type {
  AIProvider,
  ProviderRequest,
  ProviderResult,
} from "./provider.js";

interface GeminiContinuation {
  kind: "gemini";
  contents: Content[];
  calls: Array<{ callId: string; name: string; providerId?: string }>;
}

function continuation(value: unknown): GeminiContinuation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<GeminiContinuation>;
  return candidate.kind === "gemini" &&
    Array.isArray(candidate.contents) &&
    Array.isArray(candidate.calls)
    ? (candidate as GeminiContinuation)
    : undefined;
}

function contentsFor(request: ProviderRequest): Content[] {
  const previous = continuation(request.continuation);
  if (!previous) {
    return request.items
      .filter((item) => item.type === "message")
      .map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      }));
  }
  const responses = previous.calls.map((call) => {
    const item = [...request.items]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === "function_call_output" &&
          candidate.callId === call.callId,
      );
    if (!item || item.type !== "function_call_output")
      throw new Error("Missing Gemini tool result");
    let result: unknown;
    try {
      result = JSON.parse(item.output);
    } catch {
      result = item.output;
    }
    return {
      functionResponse: {
        name: call.name,
        id: call.providerId,
        response: { result },
      },
    };
  });
  return [...previous.contents, { role: "user", parts: responses }];
}

function resultFrom(
  response: GenerateContentResponse,
  sent: Content[],
  streamedText?: string,
): ProviderResult {
  const modelContent = response.candidates?.[0]?.content;
  const parts = modelContent?.parts ?? [];
  const text =
    streamedText ??
    parts
      .filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("");
  const calls = parts.flatMap((part) =>
    part.functionCall?.name
      ? [
          {
            callId: randomUUID(),
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
            providerId: part.functionCall.id,
          },
        ]
      : [],
  );
  const usage = response.usageMetadata;
  return {
    text,
    calls: calls.map(({ callId, name, arguments: args }) => ({
      callId,
      name,
      arguments: args,
    })),
    usage: {
      inputTokens:
        (usage?.promptTokenCount ?? 0) + (usage?.toolUsePromptTokenCount ?? 0),
      outputTokens:
        (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    },
    continuation: calls.length
      ? ({
          kind: "gemini",
          contents: [...sent, modelContent ?? { role: "model", parts }],
          calls: calls.map(({ callId, name, providerId }) => ({
            callId,
            name,
            providerId,
          })),
        } satisfies GeminiContinuation)
      : undefined,
  };
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, client?: GoogleGenAI) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  private params(request: ProviderRequest) {
    const contents = contentsFor(request);
    return {
      contents,
      params: {
        model: request.model,
        contents,
        config: {
          systemInstruction: request.instructions,
          ...(request.tools.length
            ? {
                tools: [
                  {
                    functionDeclarations: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parametersJsonSchema: tool.parameters,
                    })),
                  },
                ],
                toolConfig: {
                  functionCallingConfig: {
                    mode: FunctionCallingConfigMode.AUTO,
                  },
                },
              }
            : {}),
        },
      },
    };
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    const { contents, params } = this.params(request);
    const response = await this.client.models.generateContent(params);
    return resultFrom(response, contents);
  }

  async stream(
    request: ProviderRequest,
    onText: (delta: string) => void,
  ): Promise<ProviderResult> {
    const { contents, params } = this.params(request);
    const stream = await this.client.models.generateContentStream(params);
    const parts: NonNullable<Content["parts"]> = [];
    let text = "";
    let usageMetadata: GenerateContentResponse["usageMetadata"];
    for await (const chunk of stream) {
      const next = chunk.candidates?.[0]?.content?.parts ?? [];
      parts.push(...next);
      for (const part of next) {
        if (part.text && !part.thought) {
          text += part.text;
          onText(part.text);
        }
      }
      if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
    }
    return resultFrom(
      {
        candidates: [{ content: { role: "model", parts } }],
        usageMetadata,
      } as GenerateContentResponse,
      contents,
      text,
    );
  }
}
