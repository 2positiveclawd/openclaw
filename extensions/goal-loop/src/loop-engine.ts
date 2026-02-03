// ---------------------------------------------------------------------------
// Goal Loop – Core Iteration Loop Engine
// ---------------------------------------------------------------------------
//
// The engine runs the goal loop: governance -> quality gate -> agent turn ->
// record -> evaluate -> check terminal -> sleep -> repeat.

import type { CoreCliDeps, CoreConfig, CoreCronJob, CoreDeps } from "./core-bridge.js";
import type { GoalLoopPluginConfig, GoalNotifyConfig, GoalState } from "./types.js";
import { readGoal, writeGoal, appendIterationLog } from "./state.js";
import { runGovernanceChecks, shouldTriggerQualityGate } from "./governance.js";
import { runProgressEvaluation } from "./evaluator.js";

// ---------------------------------------------------------------------------
// Automation (webhooks, chains) - optional, fails silently if not available
// ---------------------------------------------------------------------------

let automationModule: typeof import("../../automation/dist/index.js") | null = null;

async function loadAutomation() {
  if (automationModule !== null) return automationModule;
  try {
    // Try dist (compiled) first, then src (for jiti/dev mode)
    try {
      automationModule = await import("../../automation/dist/index.js");
    } catch {
      automationModule = await import("../../automation/src/index.js" as any);
    }
    return automationModule;
  } catch {
    // Automation extension not available
    return null;
  }
}

async function fireAutomationEvent(
  eventFn: (mod: typeof import("../../automation/dist/index.js")) => import("../../automation/dist/index.js").AutomationEvent
) {
  try {
    const mod = await loadAutomation();
    if (mod) {
      const event = eventFn(mod);
      await mod.fireEvent(event);
    }
  } catch (err) {
    // Don't let automation failures break the goal loop
    console.error("[goal-loop] Automation event failed:", err);
  }
}

async function recordGoalLearning(goal: GoalState, outcome: "completed" | "failed" | "stalled") {
  try {
    const mod = await loadAutomation();
    if (mod?.recordLearning) {
      const duration = Date.now() - (goal.usage.startedAtMs || Date.now());
      const score = goal.lastEvaluation?.progressScore ?? 0;

      // Extract what worked/failed from evaluation
      const whatWorked: string[] = [];
      const whatFailed: string[] = [];

      if (goal.lastEvaluation?.criteriaStatus) {
        for (const cs of goal.lastEvaluation.criteriaStatus) {
          if (cs.met) {
            whatWorked.push(cs.criterion);
          } else {
            whatFailed.push(cs.criterion);
          }
        }
      }

      mod.recordLearning({
        id: goal.id,
        goal: goal.goal,
        outcome,
        score,
        iterations: goal.usage.iterations,
        durationMs: duration,
        tokensUsed: goal.usage.totalTokens,
        whatWorked,
        whatFailed,
        suggestions: goal.lastEvaluation?.suggestedNextAction
          ? [goal.lastEvaluation.suggestedNextAction]
          : [],
      });
    }
  } catch (err) {
    console.error("[goal-loop] Failed to record learning:", err);
  }
}

async function getLearningContext(goalText: string): Promise<string | null> {
  try {
    const mod = await loadAutomation();
    if (mod?.generateLearningContext) {
      return mod.generateLearningContext(goalText);
    }
  } catch {
    // Ignore errors
  }
  return null;
}

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const LOOP_SLEEP_MS = 1000;

// ---------------------------------------------------------------------------
// Active loop tracking
// ---------------------------------------------------------------------------

const activeLoops = new Map<string, AbortController>();

export function getActiveGoalIds(): string[] {
  return [...activeLoops.keys()];
}

export function isGoalRunning(goalId: string): boolean {
  return activeLoops.has(goalId);
}

// ---------------------------------------------------------------------------
// Stop a running loop
// ---------------------------------------------------------------------------

export function stopGoalLoop(goalId: string): boolean {
  const controller = activeLoops.get(goalId);
  if (!controller) return false;
  controller.abort();
  activeLoops.delete(goalId);
  return true;
}

// ---------------------------------------------------------------------------
// Notification helper type
// ---------------------------------------------------------------------------

type NotifyFn = (notify: GoalNotifyConfig, message: string) => Promise<void>;

// ---------------------------------------------------------------------------
// Build iteration prompt
// ---------------------------------------------------------------------------

async function buildIterationPrompt(goal: GoalState): Promise<string> {
  const criteriaList = goal.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");
  let prompt = `You are working toward the following goal:

## Goal
${goal.goal}

## Acceptance Criteria
${criteriaList}`;

  // On first iteration, inject learning context from similar past goals
  if (goal.usage.iterations === 0) {
    const learningContext = await getLearningContext(goal.goal);
    if (learningContext) {
      console.log(`[goal-loop] Injecting learning context for goal ${goal.id} (found similar past goals)`);
      prompt += `\n\n${learningContext}`;
    }
  }

  prompt += `\n\n## Progress
- Iteration: ${goal.usage.iterations + 1}
- Tokens used: ${goal.usage.totalTokens}`;

  if (goal.lastEvaluation) {
    prompt += `\n- Last progress score: ${goal.lastEvaluation.progressScore}/100`;
    prompt += `\n- Last assessment: ${goal.lastEvaluation.assessment}`;
    const unmet = goal.lastEvaluation.criteriaStatus.filter((c) => !c.met);
    if (unmet.length > 0) {
      prompt += `\n- Unmet criteria: ${unmet.map((c) => c.criterion).join("; ")}`;
    }
  }

  if (goal.lastSuggestedAction) {
    prompt += `\n\n## Suggested Next Action\n${goal.lastSuggestedAction}`;
  }

  prompt += `\n\nContinue working toward the goal. Focus on the unmet acceptance criteria.`;
  return prompt;
}

// ---------------------------------------------------------------------------
// Main goal loop
// ---------------------------------------------------------------------------

export async function runGoalLoop(params: {
  goal: GoalState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  pluginConfig: GoalLoopPluginConfig;
  logger: Logger;
  notifyFn: NotifyFn;
  loadUsage: () => Promise<{ providers: Array<{ windows: Array<{ usedPercent: number }> }> }>;
  waitForApproval: (goalId: string) => Promise<"approved" | "rejected" | "timeout">;
}): Promise<void> {
  const { coreDeps, cfg, cliDeps, pluginConfig, logger, notifyFn, loadUsage, waitForApproval } =
    params;
  let goal = params.goal;

  if (activeLoops.has(goal.id)) {
    logger.warn(`Goal ${goal.id} loop already active`);
    return;
  }

  const controller = new AbortController();
  activeLoops.set(goal.id, controller);

  goal.status = "running";
  goal.updatedAtMs = Date.now();
  if (goal.usage.startedAtMs === 0) {
    goal.usage.startedAtMs = Date.now();
  }
  writeGoal(goal);

  if (goal.notify) {
    await notifyFn(goal.notify, `Goal started: ${goal.goal} [${goal.id}]`).catch(() => {});
  }

  // Fire automation event: goal.started
  await fireAutomationEvent((mod) => mod.events.goalStarted(goal.id, goal.goal));

  try {
    await loopBody(goal, controller.signal, {
      coreDeps,
      cfg,
      cliDeps,
      pluginConfig,
      logger,
      notifyFn,
      loadUsage,
      waitForApproval,
    });
  } catch (err) {
    if (!controller.signal.aborted) {
      logger.error(`Goal ${goal.id} loop failed: ${err}`);
      goal = readGoal(goal.id) ?? goal;
      goal.status = "failed";
      goal.stopReason = String(err);
      goal.updatedAtMs = Date.now();
      writeGoal(goal);
      if (goal.notify) {
        await notifyFn(
          goal.notify,
          `Goal FAILED: ${goal.goal} [${goal.id}] — ${goal.stopReason}`,
        ).catch(() => {});
      }
      // Fire automation event: goal.failed
      await fireAutomationEvent((mod) => mod.events.goalFailed(goal.id, goal.goal, goal.stopReason));
      // Record learning for future goals
      await recordGoalLearning(goal, "failed");
    }
  } finally {
    activeLoops.delete(goal.id);
  }
}

async function loopBody(
  initialGoal: GoalState,
  signal: AbortSignal,
  ctx: {
    coreDeps: CoreDeps;
    cfg: CoreConfig;
    cliDeps: CoreCliDeps;
    pluginConfig: GoalLoopPluginConfig;
    logger: Logger;
    notifyFn: NotifyFn;
    loadUsage: () => Promise<{ providers: Array<{ windows: Array<{ usedPercent: number }> }> }>;
    waitForApproval: (goalId: string) => Promise<"approved" | "rejected" | "timeout">;
  },
): Promise<void> {
  let goal = initialGoal;

  while (!signal.aborted) {
    goal = readGoal(goal.id) ?? goal;
    if (goal.status !== "running") {
      ctx.logger.info(
        `Goal ${goal.id} is no longer running (status: ${goal.status}), exiting loop`,
      );
      return;
    }

    // -----------------------------------------------------------------------
    // 1. Governance checks
    // -----------------------------------------------------------------------
    const governance = await runGovernanceChecks(goal, ctx.loadUsage);
    if (!governance.allowed) {
      const isBudget =
        governance.reason?.includes("budget") || governance.reason?.includes("Provider usage");
      goal.status = isBudget ? "budget_exceeded" : "stopped";
      goal.stopReason = governance.reason ?? "Governance check failed";
      goal.updatedAtMs = Date.now();
      writeGoal(goal);
      ctx.logger.info(`Goal ${goal.id} stopped: ${goal.stopReason}`);
      if (goal.notify) {
        await ctx.notifyFn(
          goal.notify,
          `Goal stopped: ${goal.goal} [${goal.id}] — ${goal.stopReason}`,
        ).catch(() => {});
      }
      return;
    }
    for (const warning of governance.warnings) {
      ctx.logger.warn(`Goal ${goal.id}: ${warning}`);
      if (goal.notify) {
        await ctx.notifyFn(goal.notify, `Goal warning [${goal.id}]: ${warning}`).catch(() => {});
      }
    }

    // -----------------------------------------------------------------------
    // 2. Quality gate check
    // -----------------------------------------------------------------------
    if (shouldTriggerQualityGate(goal)) {
      goal.status = "paused";
      goal.updatedAtMs = Date.now();
      writeGoal(goal);
      ctx.logger.info(
        `Goal ${goal.id} paused for quality gate at iteration ${goal.usage.iterations + 1}`,
      );
      if (goal.notify) {
        await ctx.notifyFn(
          goal.notify,
          `Approval needed for goal [${goal.id}] at iteration ${goal.usage.iterations + 1}. Reply: /goal-approve ${goal.id} or /goal-reject ${goal.id}`,
        ).catch(() => {});
      }
      const approvalResult = await ctx.waitForApproval(goal.id);
      goal = readGoal(goal.id) ?? goal;
      if (approvalResult === "rejected" || approvalResult === "timeout") {
        if (goal.status === "paused") {
          const action =
            approvalResult === "timeout"
              ? ctx.pluginConfig.approvalTimeoutAction
              : "auto-reject";
          if (action === "auto-reject") {
            goal.status = "stopped";
            goal.stopReason =
              approvalResult === "timeout"
                ? "Quality gate approval timed out"
                : "Quality gate rejected";
            goal.updatedAtMs = Date.now();
            writeGoal(goal);
            ctx.logger.info(`Goal ${goal.id} stopped: ${goal.stopReason}`);
            if (goal.notify) {
              await ctx.notifyFn(
                goal.notify,
                `Goal stopped: ${goal.goal} [${goal.id}] — ${goal.stopReason}`,
              ).catch(() => {});
            }
            return;
          }
          // auto-approve on timeout
        }
      }
      goal = readGoal(goal.id) ?? goal;
      if (goal.status === "paused") {
        goal.status = "running";
        goal.updatedAtMs = Date.now();
        writeGoal(goal);
      }
      if (goal.status !== "running") return;
    }

    // -----------------------------------------------------------------------
    // 3. Build iteration prompt
    // -----------------------------------------------------------------------
    const prompt = await buildIterationPrompt(goal);

    // -----------------------------------------------------------------------
    // 4. Run agent turn
    // -----------------------------------------------------------------------
    const iterationStart = Date.now();
    const sessionKey = `goal:${goal.id}`;
    const job: CoreCronJob = {
      id: `goal-iter-${goal.id}`,
      agentId: goal.agentId,
      name: `goal:${goal.id}`,
      enabled: true,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      schedule: { kind: "at", atMs: Date.now() },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: prompt },
      state: {},
    };

    let turnResult: {
      status: "ok" | "error" | "skipped";
      summary?: string;
      outputText?: string;
      error?: string;
    };
    try {
      turnResult = await ctx.coreDeps.runCronIsolatedAgentTurn({
        cfg: ctx.cfg,
        deps: ctx.cliDeps,
        job,
        message: prompt,
        sessionKey,
        agentId: goal.agentId,
      });
    } catch (err) {
      turnResult = { status: "error", error: String(err) };
    }
    const iterationDuration = Date.now() - iterationStart;

    // -----------------------------------------------------------------------
    // 5. Record results
    // -----------------------------------------------------------------------
    const iterNum = goal.usage.iterations + 1;
    appendIterationLog({
      goalId: goal.id,
      iteration: iterNum,
      timestamp: Date.now(),
      status: turnResult.status,
      summary: turnResult.summary,
      outputText: turnResult.outputText,
      error: turnResult.error,
      durationMs: iterationDuration,
    });

    goal.usage.iterations = iterNum;
    if (turnResult.status === "error") {
      goal.usage.errors += 1;
      goal.usage.consecutiveErrors += 1;
    } else {
      goal.usage.consecutiveErrors = 0;
    }
    goal.updatedAtMs = Date.now();
    writeGoal(goal);

    // -----------------------------------------------------------------------
    // 6. Evaluate progress (every N iterations)
    // -----------------------------------------------------------------------
    const shouldEval = iterNum % goal.evalConfig.evalEvery === 0;
    if (shouldEval) {
      goal.status = "evaluating";
      goal.updatedAtMs = Date.now();
      writeGoal(goal);

      const evalResult = await runProgressEvaluation({
        goal,
        coreDeps: ctx.coreDeps,
        cfg: ctx.cfg,
        cliDeps: ctx.cliDeps,
        logger: ctx.logger,
      });

      goal = readGoal(goal.id) ?? goal;
      goal.lastEvaluation = evalResult;
      goal.lastSuggestedAction = evalResult.suggestedNextAction ?? null;
      goal.evaluationScores.push(evalResult.progressScore);
      goal.updatedAtMs = Date.now();

      // -------------------------------------------------------------------
      // 7. Check terminal conditions
      // -------------------------------------------------------------------
      if (evalResult.progressScore >= 95 && !evalResult.shouldContinue) {
        goal.status = "completed";
        goal.stopReason = `Goal completed with score ${evalResult.progressScore}/100`;
        writeGoal(goal);
        ctx.logger.info(`Goal ${goal.id} completed: ${evalResult.assessment}`);
        if (goal.notify) {
          await ctx.notifyFn(
            goal.notify,
            `Goal COMPLETED: ${goal.goal} [${goal.id}] — Score: ${evalResult.progressScore}/100`,
          ).catch(() => {});
        }
        // Fire automation event: goal.completed
        const duration = Date.now() - (goal.usage.startedAtMs || Date.now());
        await fireAutomationEvent((mod) =>
          mod.events.goalCompleted(goal.id, goal.goal, evalResult.progressScore, duration)
        );
        // Record learning for future goals
        await recordGoalLearning(goal, "completed");
        return;
      }
      if (!evalResult.shouldContinue) {
        goal.status = "stopped";
        goal.stopReason = `Evaluator recommended stop: ${evalResult.assessment}`;
        writeGoal(goal);
        ctx.logger.info(`Goal ${goal.id} stopped by evaluator: ${evalResult.assessment}`);
        if (goal.notify) {
          await ctx.notifyFn(
            goal.notify,
            `Goal stopped by evaluator: ${goal.goal} [${goal.id}] — ${evalResult.assessment}`,
          ).catch(() => {});
        }
        // Fire automation event: goal.failed (stopped by evaluator)
        await fireAutomationEvent((mod) =>
          mod.events.goalFailed(goal.id, goal.goal, evalResult.assessment)
        );
        // Record learning for future goals
        await recordGoalLearning(goal, "failed");
        return;
      }

      goal.status = "running";
      writeGoal(goal);

      // Re-check governance after eval score update (stall detection).
      const stallCheck = await runGovernanceChecks(goal, ctx.loadUsage);
      if (!stallCheck.allowed) {
        goal.status = "stopped";
        goal.stopReason = stallCheck.reason ?? "Stall detected";
        goal.updatedAtMs = Date.now();
        writeGoal(goal);
        ctx.logger.info(`Goal ${goal.id} stopped: ${goal.stopReason}`);
        if (goal.notify) {
          await ctx.notifyFn(
            goal.notify,
            `Goal stopped: ${goal.goal} [${goal.id}] — ${goal.stopReason}`,
          ).catch(() => {});
        }
        // Fire automation event: goal.stalled
        const lastScore = goal.evaluationScores[goal.evaluationScores.length - 1] ?? 0;
        await fireAutomationEvent((mod) =>
          mod.events.goalStalled(goal.id, goal.goal, lastScore)
        );
        // Record learning for future goals
        await recordGoalLearning(goal, "stalled");
        return;
      }

      if (goal.notify) {
        await ctx.notifyFn(
          goal.notify,
          `Goal checkpoint [${goal.id}] — Iteration ${iterNum}, Score: ${evalResult.progressScore}/100. ${evalResult.assessment}`,
        ).catch(() => {});
      }
    } else {
      goal.status = "running";
      writeGoal(goal);
    }

    // -----------------------------------------------------------------------
    // 8. Sleep then loop
    // -----------------------------------------------------------------------
    await sleep(LOOP_SLEEP_MS, signal);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
