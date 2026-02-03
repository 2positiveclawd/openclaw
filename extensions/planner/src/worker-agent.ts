// ---------------------------------------------------------------------------
// Planner – Worker Agent (Task Execution)
// ---------------------------------------------------------------------------
//
// Builds a prompt for a worker agent that executes a single focused task.
// Includes context from completed dependency tasks.

import type { CoreCliDeps, CoreConfig, CoreCronJob, CoreDeps } from "./core-bridge.js";
import type { PlanState, PlanTask, TaskResult } from "./types.js";
import { appendWorkerRunLog } from "./state.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Worker prompt
// ---------------------------------------------------------------------------

export function buildWorkerPrompt(task: PlanTask, plan: PlanState): string {
  // Gather context from completed dependency tasks.
  const depContext = task.dependencies
    .map((depId) => {
      const dep = plan.tasks.find((t) => t.id === depId);
      if (!dep || dep.status !== "completed") return null;
      return `### ${dep.id}: ${dep.title}\n${dep.result?.summary ?? "(completed, no summary)"}`;
    })
    .filter(Boolean)
    .join("\n\n");

  let prompt = `You are executing a single focused task. Complete it fully.

## Your Task
${task.title}

## Instructions
${task.description}`;

  if (depContext) {
    prompt += `\n\n## Context from Previous Tasks\n${depContext}`;
  }

  prompt += `\n\n## Rules
- Complete this specific task only — do not work on other tasks
- If you encounter an error, describe it clearly in your response
- Verify your work (e.g., run the build, check the file exists)
- End your response with a brief summary of what you did`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Run worker agent turn
// ---------------------------------------------------------------------------

export async function runWorkerAgent(params: {
  task: PlanTask;
  plan: PlanState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  logger: Logger;
}): Promise<TaskResult> {
  const { task, plan, coreDeps, cfg, cliDeps, logger } = params;
  const startMs = Date.now();

  const prompt = buildWorkerPrompt(task, plan);

  const job: CoreCronJob = {
    id: `planner-worker-${plan.id}-${task.id}`,
    name: `planner-worker:${plan.id}:${task.id}`,
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "at", atMs: Date.now() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: prompt },
    state: {},
  };

  const sessionKey = `planner-worker:${plan.id}:${task.id}`;

  try {
    const result = await coreDeps.runCronIsolatedAgentTurn({
      cfg,
      deps: cliDeps,
      job,
      message: prompt,
      sessionKey,
    });

    const durationMs = Date.now() - startMs;

    if (result.status === "error") {
      appendWorkerRunLog({
        planId: plan.id,
        taskId: task.id,
        timestamp: Date.now(),
        status: "error",
        error: result.error,
        durationMs,
      });
      return { status: "error", error: result.error };
    }

    const summary = result.summary ?? result.outputText?.slice(0, 500) ?? "Task completed";
    appendWorkerRunLog({
      planId: plan.id,
      taskId: task.id,
      timestamp: Date.now(),
      status: "ok",
      summary,
      outputText: result.outputText,
      durationMs,
    });

    return {
      status: "ok",
      summary,
      outputText: result.outputText,
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    const errorMsg = err instanceof Error ? err.message : String(err);

    appendWorkerRunLog({
      planId: plan.id,
      taskId: task.id,
      timestamp: Date.now(),
      status: "error",
      error: errorMsg,
      durationMs,
    });

    logger.error(`Worker agent threw for plan ${plan.id} task ${task.id}: ${err}`);
    return { status: "error", error: errorMsg };
  }
}
