// ---------------------------------------------------------------------------
// Goal Loop – Progress Evaluator
// ---------------------------------------------------------------------------
//
// Runs a separate LLM call (through runCronIsolatedAgentTurn with a dedicated
// session key) to evaluate goal progress. The evaluator scores progress 0-100,
// checks acceptance criteria, and recommends whether to continue.

import type {
  GoalEvaluationRecord,
  GoalEvaluationResult,
  GoalIterationRecord,
  GoalState,
} from "./types.js";
import { appendEvaluationLog, readIterationLog } from "./state.js";
import type { CoreDeps, CoreCliDeps, CoreConfig, CoreCronJob } from "./core-bridge.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Evaluator prompt
// ---------------------------------------------------------------------------

export function buildEvaluatorPrompt(
  goal: GoalState,
  recentIterations: GoalIterationRecord[],
  previousEvaluations: GoalEvaluationResult[],
): string {
  const criteriaList = goal.criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n");
  const iterSummaries = recentIterations
    .slice(-10)
    .map(
      (r) =>
        `  - Iteration ${r.iteration} (${r.status}): ${r.summary ?? r.error ?? "(no summary)"}`,
    )
    .join("\n");

  const prevEvalSummaries =
    previousEvaluations.length > 0
      ? previousEvaluations
          .slice(-3)
          .map(
            (e) =>
              `  - Score: ${e.progressScore}/100 — ${e.assessment}${e.shouldContinue ? "" : " [recommended stop]"}`,
          )
          .join("\n")
      : "  (no previous evaluations)";

  return `You are a progress evaluator for an autonomous agent working toward a goal.

## Goal
${goal.goal}

## Acceptance Criteria
${criteriaList}

## Recent Iteration Summaries
${iterSummaries}

## Previous Evaluations
${prevEvalSummaries}

## Current Stats
- Iterations completed: ${goal.usage.iterations}
- Total tokens used: ${goal.usage.totalTokens}
- Consecutive errors: ${goal.usage.consecutiveErrors}

## Instructions
Evaluate the agent's progress toward the goal. Return ONLY a JSON object (no markdown fences, no extra text) with this exact schema:

{
  "progressScore": <number 0-100>,
  "assessment": "<brief assessment of current progress>",
  "criteriaStatus": [
    { "criterion": "<criterion text>", "met": <boolean>, "notes": "<optional notes>" }
  ],
  "shouldContinue": <boolean>,
  "suggestedNextAction": "<what the agent should focus on next>"
}

Rules:
- progressScore 95+ means the goal is effectively complete.
- Set shouldContinue to false if the goal is complete, fundamentally blocked, or the agent is going in circles.
- criteriaStatus must have one entry per acceptance criterion, in order.
- suggestedNextAction should be specific and actionable.`;
}

// ---------------------------------------------------------------------------
// Parse evaluator response
// ---------------------------------------------------------------------------

export function parseEvaluatorResponse(
  text: string,
  criteria: string[],
): GoalEvaluationResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return fallbackEvaluation(criteria, `Could not extract JSON from evaluator response`);
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const progressScore =
      typeof parsed.progressScore === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.progressScore)))
        : 0;
    const assessment =
      typeof parsed.assessment === "string" ? parsed.assessment : "No assessment provided";
    const shouldContinue =
      typeof parsed.shouldContinue === "boolean" ? parsed.shouldContinue : true;
    const suggestedNextAction =
      typeof parsed.suggestedNextAction === "string" ? parsed.suggestedNextAction : undefined;

    const criteriaStatus: GoalEvaluationResult["criteriaStatus"] = criteria.map((criterion, i) => {
      const status = Array.isArray(parsed.criteriaStatus) ? parsed.criteriaStatus[i] : undefined;
      return {
        criterion,
        met: status?.met === true,
        notes: typeof status?.notes === "string" ? status.notes : undefined,
      };
    });

    return { progressScore, assessment, criteriaStatus, shouldContinue, suggestedNextAction };
  } catch {
    return fallbackEvaluation(criteria, `Failed to parse evaluator JSON: ${text.slice(0, 200)}`);
  }
}

function fallbackEvaluation(criteria: string[], reason: string): GoalEvaluationResult {
  return {
    progressScore: 0,
    assessment: reason,
    criteriaStatus: criteria.map((c) => ({ criterion: c, met: false, notes: "Parse error" })),
    shouldContinue: true,
    suggestedNextAction: "Continue working on the goal.",
  };
}

// ---------------------------------------------------------------------------
// Run progress evaluation
// ---------------------------------------------------------------------------

export async function runProgressEvaluation(params: {
  goal: GoalState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  logger: Logger;
}): Promise<GoalEvaluationResult> {
  const { goal, coreDeps, cfg, cliDeps, logger } = params;
  const startMs = Date.now();

  const iterations = readIterationLog(goal.id);
  const previousEvaluations =
    goal.evaluationScores.length > 0
      ? [goal.lastEvaluation].filter((e): e is GoalEvaluationResult => e !== null)
      : [];
  const prompt = buildEvaluatorPrompt(goal, iterations, previousEvaluations);

  const evalJob: CoreCronJob = {
    id: `goal-eval-${goal.id}`,
    name: `goal-eval:${goal.id}`,
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "at", atMs: Date.now() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: prompt },
    state: {},
  };

  const sessionKey = `goal-eval:${goal.id}`;
  let resultText = "";

  try {
    const result = await coreDeps.runCronIsolatedAgentTurn({
      cfg,
      deps: cliDeps,
      job: evalJob,
      message: prompt,
      sessionKey,
      agentId: goal.agentId,
    });

    if (result.status === "error") {
      logger.warn(`Evaluator returned error for goal ${goal.id}: ${result.error}`);
      resultText = result.error ?? "";
    } else {
      resultText = result.outputText ?? result.summary ?? "";
    }
  } catch (err) {
    logger.error(`Evaluator threw for goal ${goal.id}: ${err}`);
    resultText = "";
  }

  const evalResult = parseEvaluatorResponse(resultText, goal.criteria);
  const durationMs = Date.now() - startMs;

  const record: GoalEvaluationRecord = {
    goalId: goal.id,
    iteration: goal.usage.iterations,
    timestamp: Date.now(),
    result: evalResult,
    durationMs,
  };
  appendEvaluationLog(record);

  return evalResult;
}
