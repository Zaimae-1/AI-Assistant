import { z } from "zod";
import { HttpError } from "../errors.js";
import type { ProviderTool } from "./provider.js";

const arithmetic = z.object({
  operation: z.enum(["add", "subtract", "multiply", "divide"]),
  left: z.number().finite(),
  right: z.number().finite(),
});

export const safeTools: ProviderTool[] = [
  {
    name: "current_time",
    description: "Get the current UTC date and time.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "calculate",
    description: "Calculate one basic arithmetic operation with two numbers.",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["add", "subtract", "multiply", "divide"],
        },
        left: { type: "number" },
        right: { type: "number" },
      },
      required: ["operation", "left", "right"],
      additionalProperties: false,
    },
  },
];

export function executeSafeTool(name: string, rawArguments: string): string {
  let value: unknown;
  try {
    value = JSON.parse(rawArguments);
  } catch {
    throw new HttpError(
      400,
      "invalid_tool_arguments",
      "Tool arguments must be JSON",
    );
  }
  if (name === "current_time") {
    z.object({}).strict().parse(value);
    return JSON.stringify({ utc: new Date().toISOString() });
  }
  if (name === "calculate") {
    const input = arithmetic.strict().parse(value);
    if (input.operation === "divide" && input.right === 0) {
      return JSON.stringify({ error: "division_by_zero" });
    }
    const result =
      input.operation === "add"
        ? input.left + input.right
        : input.operation === "subtract"
          ? input.left - input.right
          : input.operation === "multiply"
            ? input.left * input.right
            : input.left / input.right;
    if (!Number.isFinite(result))
      return JSON.stringify({ error: "non_finite_result" });
    return JSON.stringify({ result });
  }
  throw new HttpError(
    403,
    "tool_not_registered",
    "Tool is not registered for backend execution",
  );
}
