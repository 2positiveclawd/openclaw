// ---------------------------------------------------------------------------
// Planner – Planner Agent (Goal Decomposition)
// ---------------------------------------------------------------------------
//
// Builds a prompt for the planner LLM that decomposes a goal into a DAG of
// focused, independently executable tasks. Parses the JSON response.

import type { CoreCliDeps, CoreConfig, CoreCronJob, CoreDeps } from "./core-bridge.js";
import type { PlanState, PlanTask } from "./types.js";
import { appendEvaluationLog } from "./state.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Planner prompt
// ---------------------------------------------------------------------------

export function buildPlannerPrompt(goal: string, criteria: string[]): string {
  const criteriaList = criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n");

  return `You are a project planner. Decompose this goal into a DAG of focused,
independently executable tasks.

## Goal
${goal}

## Acceptance Criteria
${criteriaList}

## Rules
- Each task should be completable in a SINGLE agent turn (one focused action)
- Tasks should be as independent as possible
- Use dependencies only when order truly matters
- Group related tasks (e.g., "setup", "frontend", "backend", "deploy")
- Task descriptions must be specific enough for an agent to execute without
  additional context — include exact file paths, commands, code snippets
- 5-20 tasks is typical. Don't over-decompose.

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "tasks": [
    {
      "id": "t1",
      "title": "Initialize project",
      "description": "Run: cd /path && npx create-next-app@latest ...",
      "dependencies": [],
      "group": "setup"
    },
    {
      "id": "t2",
      "title": "Create data layer",
      "description": "Create file src/lib/data.ts with these exact contents: ...",
      "dependencies": ["t1"],
      "group": "backend"
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Replanner prompt
// ---------------------------------------------------------------------------

export function buildReplannerPrompt(plan: PlanState): string {
  const completed = plan.tasks
    .filter((t) => t.status === "completed")
    .map((t) => `  - [${t.id}] ${t.title}: ${t.result?.summary ?? "completed"}`)
    .join("\n");

  const failed = plan.tasks
    .filter((t) => t.status === "failed")
    .map((t) => `  - [${t.id}] ${t.title}: ${t.result?.error ?? "failed"}`)
    .join("\n");

  const remaining = plan.tasks
    .filter((t) => t.status === "pending" || t.status === "ready")
    .map((t) => `  - [${t.id}] ${t.title} (deps: ${t.dependencies.join(", ") || "none"})`)
    .join("\n");

  return `You are replanning a project. Some tasks failed and need alternative approaches.

## Original Goal
${plan.goal}

## Acceptance Criteria
${plan.criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}

## Completed Tasks
${completed || "  (none)"}

## Failed Tasks
${failed || "  (none)"}

## Remaining Tasks
${remaining || "  (none)"}

Return an updated task list as JSON (same format as the planner).
You may: add new tasks, modify task descriptions, remove blocked tasks.
Keep completed task IDs — don't re-do finished work.
Only include tasks that still need to be done. Do NOT include completed tasks.
Dependencies may reference completed task IDs (they are satisfied).

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "tasks": [
    {
      "id": "t5",
      "title": "New task description",
      "description": "Detailed instructions...",
      "dependencies": ["t1"],
      "group": "fix"
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Parse planner response into tasks
// ---------------------------------------------------------------------------

export type ParsedPlannerResponse = {
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    dependencies: string[];
    group?: string;
  }>;
};

export function parsePlannerResponse(text: string): ParsedPlannerResponse | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.tasks)) return null;

    const tasks = parsed.tasks
      .filter(
        (t: unknown): t is Record<string, unknown> =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as Record<string, unknown>).id === "string",
      )
      .map((t: Record<string, unknown>) => ({
        id: String(t.id),
        title: typeof t.title === "string" ? t.title : `Task ${t.id}`,
        description: typeof t.description === "string" ? t.description : "",
        dependencies: Array.isArray(t.dependencies)
          ? (t.dependencies as unknown[]).filter((d): d is string => typeof d === "string")
          : [],
        group: typeof t.group === "string" ? t.group : undefined,
      }));

    if (tasks.length === 0) return null;
    return { tasks };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run planner agent turn
// ---------------------------------------------------------------------------

export type PlannerAgentResult = {
  parsed: ParsedPlannerResponse | null;
  tokenUsage?: { input: number; output: number; total: number };
};

export async function runPlannerAgent(params: {
  plan: PlanState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  logger: Logger;
  replan?: boolean;
}): Promise<PlannerAgentResult> {
  const { plan, coreDeps, cfg, cliDeps, logger, replan } = params;
  const startMs = Date.now();

  const prompt = replan ? buildReplannerPrompt(plan) : buildPlannerPrompt(plan.goal, plan.criteria);

  const job: CoreCronJob = {
    id: `planner-${replan ? "replan" : "plan"}-${plan.id}`,
    name: `planner:${plan.id}`,
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "at", atMs: Date.now() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: prompt },
    state: {},
  };

  const sessionKey = `planner:${plan.id}`;
  let resultText = "";
  let tokenUsage: { input: number; output: number; total: number } | undefined;

  try {
    const result = await coreDeps.runCronIsolatedAgentTurn({
      cfg,
      deps: cliDeps,
      job,
      message: prompt,
      sessionKey,
      agentId: "planner",
    });

    tokenUsage = result.tokenUsage;
    if (result.status === "error") {
      logger.warn(`Planner agent returned error for plan ${plan.id}: ${result.error}`);
      resultText = result.error ?? "";
    } else {
      resultText = result.outputText ?? result.summary ?? "";
    }
  } catch (err) {
    logger.error(`Planner agent threw for plan ${plan.id}: ${err}`);
    resultText = "";
  }

  const durationMs = Date.now() - startMs;
  const parsed = parsePlannerResponse(resultText);

  appendEvaluationLog({
    planId: plan.id,
    timestamp: Date.now(),
    phase: replan ? "replanning" : "planning",
    taskCount: parsed?.tasks.length ?? 0,
    durationMs,
  });

  if (!parsed) {
    logger.error(
      `Planner agent returned unparseable response for plan ${plan.id}: ${resultText.slice(0, 200)}`,
    );
  }

  return { parsed, tokenUsage };
}
