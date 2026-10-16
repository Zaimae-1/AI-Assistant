import type { TaskState, RiskLevel } from "./model.js";

const transitions: Record<TaskState, readonly TaskState[]> = {
  proposed: ["awaiting_approval", "queued", "cancelled"],
  awaiting_approval: ["queued", "cancelled"],
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return transitions[from].includes(to);
}

export function resolveMention(
  content: string,
  members: ReadonlyArray<{ id: string; name: string }>,
): string | null {
  const match = /^@([^\s]+)(?:\s|$)/u.exec(content.trim());
  if (!match) return null;
  const matches = members.filter(
    (member) =>
      member.name.toLocaleLowerCase() === match[1].toLocaleLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error("Mention must identify exactly one group agent");
  return matches[0].id;
}

export function canAgentHandoff(params: {
  sourceAgentId: string;
  targetAgentId: string;
  memberIds: readonly string[];
  hopCount: number;
  taskId: string | null;
}): boolean {
  return Boolean(
    params.taskId &&
    params.sourceAgentId !== params.targetAgentId &&
    params.memberIds.includes(params.sourceAgentId) &&
    params.memberIds.includes(params.targetAgentId) &&
    params.hopCount >= 0 &&
    params.hopCount < 2,
  );
}

export function requiresFreshApproval(risk: RiskLevel): boolean {
  return risk >= 2;
}
