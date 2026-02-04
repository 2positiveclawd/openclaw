// ---------------------------------------------------------------------------
// Planner – Evaluator Agent (Final Evaluation)
// ---------------------------------------------------------------------------
//
// Runs a final evaluation of the plan against acceptance criteria, similar to
// goal-loop's evaluator but scoped to task-based execution.

import type { CoreCliDeps, CoreConfig, CoreCronJob, CoreDeps } from "./core-bridge.js";
import type { EvaluationResult, PlanState } from "./types.js";
import { appendEvaluationLog } from "./state.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Evaluator prompt
// ---------------------------------------------------------------------------

export function buildEvaluatorPrompt(plan: PlanState): string {
  const criteriaList = plan.criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n");

  const taskSummaries = plan.tasks
    .map((t) => {
      const statusIcon =
        t.status === "completed" ? "done" : t.status === "failed" ? "FAILED" : t.status;
      const detail = t.result?.summary ?? t.result?.error ?? "(no result)";
      return `  - [${t.id}] ${t.title} (${statusIcon}): ${detail}`;
    })
    .join("\n");

  return `You are evaluating the final result of a planned project execution.

## Goal
${plan.goal}

## Acceptance Criteria
${criteriaList}

## Task Results
${taskSummaries}

## Stats
- Total tasks: ${plan.tasks.length}
- Completed: ${plan.tasks.filter((t) => t.status === "completed").length}
- Failed: ${plan.tasks.filter((t) => t.status === "failed").length}
- Skipped: ${plan.tasks.filter((t) => t.status === "skipped").length}
- Agent turns used: ${plan.usage.agentTurns}
- Plan revision: ${plan.planRevision}

## Instructions
Evaluate the overall result. Return ONLY a JSON object (no markdown fences, no extra text):

{
  "score": <number 0-100>,
  "assessment": "<brief assessment of overall result>",
  "criteriaStatus": [
    { "criterion": "<criterion text>", "met": <boolean>, "notes": "<optional notes>" }
  ],
  "suggestions": "<what could be done to improve, or empty string if complete>"
}

Rules:
- score 95+ means the goal is effectively complete.
- criteriaStatus must have one entry per acceptance criterion, in order.
- Be objective and verify based on task results.`;
}

// ---------------------------------------------------------------------------
// Parse evaluator response
// ---------------------------------------------------------------------------

export function parseEvaluatorResponse(text: string, criteria: string[]): EvaluationResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return fallbackEvaluation(criteria, "Could not extract JSON from evaluator response");
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const score =
      typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0;
    const assessment =
      typeof parsed.assessment === "string" ? parsed.assessment : "No assessment provided";
    const suggestions = typeof parsed.suggestions === "string" ? parsed.suggestions : undefined;

    const criteriaStatus: EvaluationResult["criteriaStatus"] = criteria.map((criterion, i) => {
      const status = Array.isArray(parsed.criteriaStatus) ? parsed.criteriaStatus[i] : undefined;
      return {
        criterion,
        met: status?.met === true,
        notes: typeof status?.notes === "string" ? status.notes : undefined,
      };
    });

    return { score, assessment, criteriaStatus, suggestions };
  } catch {
    return fallbackEvaluation(criteria, `Failed to parse evaluator JSON: ${text.slice(0, 200)}`);
  }
}

function fallbackEvaluation(criteria: string[], reason: string): EvaluationResult {
  return {
    score: 0,
    assessment: reason,
    criteriaStatus: criteria.map((c) => ({
      criterion: c,
      met: false,
      notes: "Parse error",
    })),
    suggestions: "Re-evaluate manually.",
  };
}

// ---------------------------------------------------------------------------
// Run final evaluation
// ---------------------------------------------------------------------------

export async function runFinalEvaluation(params: {
  plan: PlanState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  logger: Logger;
}): Promise<EvaluationResult> {
  const { plan, coreDeps, cfg, cliDeps, logger } = params;
  const startMs = Date.now();

  const prompt = buildEvaluatorPrompt(plan);

  const job: CoreCronJob = {
    id: `planner-eval-${plan.id}`,
    name: `planner-eval:${plan.id}`,
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "at", atMs: Date.now() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: prompt },
    state: {},
  };

  const sessionKey = `planner-eval:${plan.id}`;
  let resultText = "";

  try {
    const result = await coreDeps.runCronIsolatedAgentTurn({
      cfg,
      deps: cliDeps,
      job,
      message: prompt,
      sessionKey,
      agentId: "qa",
    });

    if (result.status === "error") {
      logger.warn(`Evaluator returned error for plan ${plan.id}: ${result.error}`);
      resultText = result.error ?? "";
    } else {
      resultText = result.outputText ?? result.summary ?? "";
    }
  } catch (err) {
    logger.error(`Evaluator threw for plan ${plan.id}: ${err}`);
    resultText = "";
  }

  const durationMs = Date.now() - startMs;
  const evalResult = parseEvaluatorResponse(resultText, plan.criteria);

  appendEvaluationLog({
    planId: plan.id,
    timestamp: Date.now(),
    phase: "final",
    result: evalResult,
    durationMs,
  });

  return evalResult;
}
