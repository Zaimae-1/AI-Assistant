export type TaskState =
  | "proposed"
  | "awaiting_approval"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentStatus =
  "idle" | "planning" | "waiting" | "running" | "failed" | "completed";

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
