import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  canAgentHandoff,
  canTransitionTask,
} from "../../../../domains/core/src/rules.js";
import type { TaskState } from "../../../../domains/core/src/model.js";
import { executeSafeTool } from "../ai/tools.js";
import { assertFound, HttpError } from "../errors.js";
import { sendJson, type Router } from "../http.js";
import type { Store } from "../store.js";
import { ownedAgent } from "./agents.js";
import { ownedConversation } from "./conversations.js";
import { groupMembers } from "./groups.js";

interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  conversation_id: string | null;
  agent_id: string | null;
  state: TaskState;
  progress: number;
  result: string | null;
}

export function ownedTask(
  store: Store,
  userId: string,
  taskId: string,
): TaskRow {
  return assertFound(
    store.get<TaskRow>(
      "SELECT * FROM tasks WHERE id=? AND user_id=?",
      taskId,
      userId,
    ),
    "Task",
  );
}

const taskState = z.enum([
  "proposed",
  "awaiting_approval",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
const workflowStep = z
  .object({
    title: z.string().trim().min(1).max(120),
    tool_name: z.enum(["current_time", "calculate"]),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export function registerTaskRoutes(router: Router): void {
  router.add("GET", "/v1/tasks", (context) =>
    context.store.all(
      "SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC",
      context.user!.id,
    ),
  );

  router.add("POST", "/v1/tasks", (context) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(160),
        description: z.string().max(10_000).default(""),
        agent_id: z.uuid().optional(),
        conversation_id: z.uuid().optional(),
      })
      .strict()
      .parse(context.body);
    if (input.agent_id)
      ownedAgent(context.store, context.user!.id, input.agent_id);
    if (input.conversation_id)
      ownedConversation(context.store, context.user!.id, input.conversation_id);
    const id = randomUUID();
    const now = new Date().toISOString();
    context.store.run(
      "INSERT INTO tasks (id,user_id,title,description,agent_id,conversation_id,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      id,
      context.user!.id,
      input.title,
      input.description,
      input.agent_id ?? null,
      input.conversation_id ?? null,
      "proposed",
      now,
      now,
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "task.create",
      `task:${id}`,
      "succeeded",
    );
    sendJson(
      context.response,
      201,
      ownedTask(context.store, context.user!.id, id),
    );
  });

  router.add("GET", "/v1/tasks/:id", (context) =>
    ownedTask(context.store, context.user!.id, context.params.id),
  );

  router.add("POST", "/v1/tasks/:id/handoff", (context) => {
    const userId = context.user!.id;
    const task = ownedTask(context.store, userId, context.params.id);
    const input = z
      .object({
        target_agent_id: z.uuid(),
        reason: z.string().trim().min(1).max(1000),
      })
      .strict()
      .parse(context.body);
    if (
      !task.conversation_id ||
      !task.agent_id ||
      task.state === "succeeded" ||
      task.state === "failed" ||
      task.state === "cancelled"
    ) {
      throw new HttpError(
        409,
        "handoff_unavailable",
        "Task is not eligible for a group handoff",
      );
    }
    const conversation = ownedConversation(
      context.store,
      userId,
      task.conversation_id,
    );
    if (!conversation.group_id)
      throw new HttpError(
        409,
        "handoff_unavailable",
        "Task needs a group conversation",
      );
    const members = groupMembers(context.store, userId, conversation.group_id);
    const count = context.store.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM task_handoffs WHERE task_id=? AND user_id=?",
      task.id,
      userId,
    )!.count;
    if (
      !canAgentHandoff({
        sourceAgentId: task.agent_id,
        targetAgentId: input.target_agent_id,
        memberIds: members.map((member) => member.id),
        hopCount: count,
        taskId: task.id,
      })
    ) {
      throw new HttpError(
        409,
        "handoff_denied",
        "Handoff requires two distinct group agents and at most two hops",
      );
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    context.store.transaction(() => {
      context.store.run(
        "INSERT INTO task_handoffs (id,user_id,task_id,source_agent_id,target_agent_id,hop_number,reason,created_at) VALUES (?,?,?,?,?,?,?,?)",
        id,
        userId,
        task.id,
        task.agent_id,
        input.target_agent_id,
        count + 1,
        input.reason,
        now,
      );
      context.store.run(
        "UPDATE tasks SET agent_id=?,updated_at=? WHERE id=? AND user_id=?",
        input.target_agent_id,
        now,
        task.id,
        userId,
      );
    });
    context.audit(
      userId,
      userId,
      "task.handoff",
      `task:${task.id}`,
      "succeeded",
    );
    return {
      id,
      task_id: task.id,
      source_agent_id: task.agent_id,
      target_agent_id: input.target_agent_id,
      hop_number: count + 1,
    };
  });

  router.add("PATCH", "/v1/tasks/:id", (context) => {
    const task = ownedTask(context.store, context.user!.id, context.params.id);
    const input = z
      .object({
        state: taskState.optional(),
        progress: z.number().int().min(0).max(100).optional(),
        result: z.string().max(20_000).optional(),
        agent_id: z.uuid().optional(),
      })
      .strict()
      .parse(context.body);
    if (input.agent_id)
      ownedAgent(context.store, context.user!.id, input.agent_id);
    const nextState = input.state ?? task.state;
    if (nextState !== task.state && !canTransitionTask(task.state, nextState)) {
      throw new HttpError(
        409,
        "invalid_transition",
        `Task cannot move from ${task.state} to ${nextState}`,
      );
    }
    if (
      input.progress !== undefined &&
      nextState !== "running" &&
      nextState !== "succeeded"
    ) {
      throw new HttpError(
        400,
        "invalid_progress",
        "Progress can be set only while running or succeeding",
      );
    }
    context.store.run(
      "UPDATE tasks SET state=?,progress=?,result=?,agent_id=?,updated_at=? WHERE id=? AND user_id=?",
      nextState,
      input.progress ?? (nextState === "succeeded" ? 100 : task.progress),
      input.result ?? task.result,
      input.agent_id ?? task.agent_id,
      new Date().toISOString(),
      task.id,
      context.user!.id,
    );
    if (task.agent_id && input.state) {
      const status =
        nextState === "running"
          ? "running"
          : nextState === "succeeded"
            ? "completed"
            : nextState === "failed"
              ? "failed"
              : "waiting";
      context.store.run(
        "UPDATE agents SET status=?,updated_at=? WHERE id=? AND user_id=?",
        status,
        new Date().toISOString(),
        task.agent_id,
        context.user!.id,
      );
    }
    context.audit(
      context.user!.id,
      context.user!.id,
      "task.update",
      `task:${task.id}`,
      nextState,
    );
    return ownedTask(context.store, context.user!.id, task.id);
  });

  router.add("POST", "/v1/tasks/:id/workflow", (context) => {
    const task = ownedTask(context.store, context.user!.id, context.params.id);
    if (task.state !== "proposed")
      throw new HttpError(
        409,
        "task_not_proposed",
        "Workflow can only be planned for proposed tasks",
      );
    const input = z
      .object({ steps: z.array(workflowStep).min(1).max(8) })
      .strict()
      .parse(context.body);
    const existing = context.store.get(
      "SELECT id FROM workflows WHERE task_id=? AND user_id=?",
      task.id,
      context.user!.id,
    );
    if (existing)
      throw new HttpError(
        409,
        "workflow_exists",
        "Task already has a workflow",
      );
    const id = randomUUID();
    context.store.run(
      "INSERT INTO workflows (id,user_id,task_id,steps_json,created_at) VALUES (?,?,?,?,?)",
      id,
      context.user!.id,
      task.id,
      JSON.stringify(input.steps),
      new Date().toISOString(),
    );
    context.audit(
      context.user!.id,
      context.user!.id,
      "workflow.plan",
      `task:${task.id}`,
      "succeeded",
    );
    sendJson(context.response, 201, {
      id,
      task_id: task.id,
      steps: input.steps,
    });
  });

  router.add("GET", "/v1/tasks/:id/workflow", (context) => {
    const task = ownedTask(context.store, context.user!.id, context.params.id);
    const workflow = assertFound(
      context.store.get<{ id: string; steps_json: string }>(
        "SELECT id,steps_json FROM workflows WHERE task_id=? AND user_id=?",
        task.id,
        context.user!.id,
      ),
      "Workflow",
    );
    return {
      id: workflow.id,
      task_id: task.id,
      steps: JSON.parse(workflow.steps_json),
    };
  });

  router.add("POST", "/v1/tasks/:id/run", (context) => {
    const task = ownedTask(context.store, context.user!.id, context.params.id);
    const key = context.request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 16 || key.length > 128) {
      throw new HttpError(
        400,
        "idempotency_required",
        "Idempotency-Key of 16–128 characters required",
      );
    }
    const previous = context.store.get<{ result_json: string }>(
      "SELECT result_json FROM workflow_runs WHERE task_id=? AND idempotency_key=?",
      task.id,
      key,
    );
    if (previous) return JSON.parse(previous.result_json);
    if (task.state !== "proposed" && task.state !== "queued") {
      throw new HttpError(409, "task_not_runnable", "Task is not runnable");
    }
    const workflow = assertFound(
      context.store.get<{ steps_json: string }>(
        "SELECT steps_json FROM workflows WHERE task_id=? AND user_id=?",
        task.id,
        context.user!.id,
      ),
      "Workflow",
    );
    const steps = z.array(workflowStep).parse(JSON.parse(workflow.steps_json));
    const outputs: Array<{ title: string; tool_name: string; output: string }> =
      [];
    context.store.transaction(() => {
      context.store.run(
        "UPDATE tasks SET state='running',progress=0,updated_at=? WHERE id=?",
        new Date().toISOString(),
        task.id,
      );
      if (task.agent_id)
        context.store.run(
          "UPDATE agents SET status='running' WHERE id=? AND user_id=?",
          task.agent_id,
          context.user!.id,
        );
      for (const [index, step] of steps.entries()) {
        outputs.push({
          title: step.title,
          tool_name: step.tool_name,
          output: executeSafeTool(
            step.tool_name,
            JSON.stringify(step.arguments),
          ),
        });
        context.store.run(
          "UPDATE tasks SET progress=?,updated_at=? WHERE id=?",
          Math.round(((index + 1) / steps.length) * 100),
          new Date().toISOString(),
          task.id,
        );
      }
      const result = JSON.stringify({
        task_id: task.id,
        state: "succeeded",
        outputs,
      });
      context.store.run(
        "UPDATE tasks SET state='succeeded',result=?,updated_at=? WHERE id=?",
        result,
        new Date().toISOString(),
        task.id,
      );
      if (task.agent_id)
        context.store.run(
          "UPDATE agents SET status='completed' WHERE id=? AND user_id=?",
          task.agent_id,
          context.user!.id,
        );
      context.store.run(
        "INSERT INTO workflow_runs (id,user_id,task_id,idempotency_key,result_json,created_at) VALUES (?,?,?,?,?,?)",
        randomUUID(),
        context.user!.id,
        task.id,
        key,
        result,
        new Date().toISOString(),
      );
    });
    context.audit(
      context.user!.id,
      context.user!.id,
      "workflow.run",
      `task:${task.id}`,
      "succeeded",
    );
    return { task_id: task.id, state: "succeeded", outputs };
  });
}
