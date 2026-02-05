// ---------------------------------------------------------------------------
// Planner – Orchestrator
// ---------------------------------------------------------------------------
//
// The main orchestration loop: plan phase -> execution loop -> completion.
// Ties together planner agent, worker agents, scheduler, governance, and
// evaluator into a single execution flow.

import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type { PlannerPluginConfig, PlanNotifyConfig, PlanState, PlanTask } from "./types.js";
import { runFinalEvaluation } from "./evaluator-agent.js";
import { runGovernanceChecks } from "./governance.js";
import { runPlannerAgent, type ParsedPlannerResponse } from "./planner-agent.js";
import {
  validateDag,
  findReadyTasks,
  updateReadyTasks,
  analyzeSchedulerState,
  skipDownstreamTasks,
} from "./scheduler.js";
import { readPlan, writePlan, appendTaskStateLog } from "./state.js";
import { runWorkerAgent } from "./worker-agent.js";

// ---------------------------------------------------------------------------
// Automation (webhooks, chains) - optional, fails silently if not available
// ---------------------------------------------------------------------------

let automationModule: typeof import("../../automation/src/index.js") | null = null;

async function loadAutomation() {
  if (automationModule !== null) return automationModule;
  try {
    automationModule = await import("../../automation/src/index.js");
    return automationModule;
  } catch {
    return null;
  }
}

async function fireAutomationEvent(
  eventFn: (
    mod: typeof import("../../automation/src/index.js"),
  ) => import("../../automation/src/index.js").AutomationEvent,
) {
  try {
    const mod = await loadAutomation();
    if (mod) {
      const event = eventFn(mod);
      await mod.fireEvent(event);
    }
  } catch (err) {
    console.error("[planner] Automation event failed:", err);
  }
}

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type NotifyFn = (notify: PlanNotifyConfig, message: string) => Promise<void>;

// ---------------------------------------------------------------------------
// Active plan tracking
// ---------------------------------------------------------------------------

const activePlans = new Map<string, AbortController>();

export function getActivePlanIds(): string[] {
  return [...activePlans.keys()];
}

export function isPlanRunning(planId: string): boolean {
  return activePlans.has(planId);
}

export function stopPlan(planId: string): boolean {
  const controller = activePlans.get(planId);
  if (!controller) return false;
  controller.abort();
  activePlans.delete(planId);
  return true;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runPlanOrchestrator(params: {
  plan: PlanState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  pluginConfig: PlannerPluginConfig;
  logger: Logger;
  notifyFn: NotifyFn;
}): Promise<void> {
  const { coreDeps, cfg, cliDeps, pluginConfig, logger, notifyFn } = params;
  let plan = params.plan;

  if (activePlans.has(plan.id)) {
    logger.warn(`Plan ${plan.id} orchestrator already active`);
    return;
  }

  const controller = new AbortController();
  activePlans.set(plan.id, controller);

  try {
    await orchestratorBody(plan, controller.signal, {
      coreDeps,
      cfg,
      cliDeps,
      pluginConfig,
      logger,
      notifyFn,
    });
  } catch (err) {
    if (!controller.signal.aborted) {
      logger.error(`Plan ${plan.id} orchestrator failed: ${err}`);
      plan = readPlan(plan.id) ?? plan;
      plan.status = "failed";
      plan.stopReason = String(err);
      plan.updatedAtMs = Date.now();
      writePlan(plan);
      if (plan.notify) {
        await notifyFn(
          plan.notify,
          `Plan FAILED: ${plan.goal} [${plan.id}] -- ${plan.stopReason}`,
        ).catch(() => {});
      }
      // Fire automation event: plan.failed
      await fireAutomationEvent((mod) =>
        mod.events.planFailed(plan.id, plan.goal, plan.stopReason),
      );
    }
  } finally {
    activePlans.delete(plan.id);
  }
}

async function orchestratorBody(
  initialPlan: PlanState,
  signal: AbortSignal,
  ctx: {
    coreDeps: CoreDeps;
    cfg: CoreConfig;
    cliDeps: CoreCliDeps;
    pluginConfig: PlannerPluginConfig;
    logger: Logger;
    notifyFn: NotifyFn;
  },
): Promise<void> {
  let plan = initialPlan;

  // =========================================================================
  // PHASE 1: PLANNING
  // =========================================================================
  if (plan.tasks.length === 0) {
    plan.status = "planning";
    plan.currentPhase = "planning";
    plan.updatedAtMs = Date.now();
    if (plan.usage.startedAtMs === 0) {
      plan.usage.startedAtMs = Date.now();
    }
    writePlan(plan);

    if (plan.notify) {
      await ctx.notifyFn(plan.notify, `Plan started: ${plan.goal} [${plan.id}]`).catch(() => {});
    }

    // Fire automation event: plan.started
    await fireAutomationEvent((mod) => mod.events.planStarted(plan.id, plan.goal));

    ctx.logger.info(`Plan ${plan.id}: running planner agent`);
    plan.usage.agentTurns++;
    writePlan(plan);

    const planResult = await runPlannerAgent({
      plan,
      coreDeps: ctx.coreDeps,
      cfg: ctx.cfg,
      cliDeps: ctx.cliDeps,
      logger: ctx.logger,
    });

    if (!planResult || planResult.tasks.length === 0) {
      plan.status = "failed";
      plan.stopReason = "Planner agent failed to produce a valid task DAG";
      plan.updatedAtMs = Date.now();
      writePlan(plan);
      if (plan.notify) {
        await ctx
          .notifyFn(plan.notify, `Plan FAILED: ${plan.goal} [${plan.id}] -- ${plan.stopReason}`)
          .catch(() => {});
      }
      return;
    }

    // Convert parsed response into PlanTasks
    const tasks = applyParsedTasks(planResult, plan.budget.maxRetries);

    // Validate DAG
    const validation = validateDag(tasks);
    if (!validation.valid) {
      plan.status = "failed";
      plan.stopReason = `Invalid task DAG: ${validation.errors.join("; ")}`;
      plan.updatedAtMs = Date.now();
      writePlan(plan);
      if (plan.notify) {
        await ctx
          .notifyFn(plan.notify, `Plan FAILED: ${plan.goal} [${plan.id}] -- ${plan.stopReason}`)
          .catch(() => {});
      }
      return;
    }

    plan.tasks = tasks;
    // Mark tasks with no deps as ready
    const completedIds = new Set<string>();
    updateReadyTasks(plan.tasks, completedIds);
    plan.status = "running";
    plan.currentPhase = "executing";
    plan.updatedAtMs = Date.now();
    writePlan(plan);

    if (plan.notify) {
      await ctx
        .notifyFn(
          plan.notify,
          `Plan decomposed into ${tasks.length} tasks [${plan.id}]. Starting execution.`,
        )
        .catch(() => {});
    }

    ctx.logger.info(`Plan ${plan.id}: ${tasks.length} tasks created, starting execution`);
  } else {
    // Resuming: ensure we're in the right state
    plan.status = "running";
    plan.currentPhase = "executing";
    if (plan.usage.startedAtMs === 0) {
      plan.usage.startedAtMs = Date.now();
    }
    plan.updatedAtMs = Date.now();
    writePlan(plan);
  }

  // =========================================================================
  // PHASE 2: EXECUTION LOOP
  // =========================================================================
  while (!signal.aborted) {
    plan = readPlan(plan.id) ?? plan;
    if (plan.status !== "running") {
      ctx.logger.info(`Plan ${plan.id} no longer running (status: ${plan.status})`);
      return;
    }

    // --- Governance check ---
    const governance = runGovernanceChecks(plan);
    if (!governance.allowed) {
      plan.status = "stopped";
      plan.stopReason = governance.reason ?? "Budget exceeded";
      plan.updatedAtMs = Date.now();
      writePlan(plan);
      ctx.logger.info(`Plan ${plan.id} stopped: ${plan.stopReason}`);
      if (plan.notify) {
        await ctx
          .notifyFn(plan.notify, `Plan stopped: ${plan.goal} [${plan.id}] -- ${plan.stopReason}`)
          .catch(() => {});
      }
      return;
    }
    for (const warning of governance.warnings) {
      ctx.logger.warn(`Plan ${plan.id}: ${warning}`);
      if (plan.notify) {
        await ctx.notifyFn(plan.notify, `Plan warning [${plan.id}]: ${warning}`).catch(() => {});
      }
    }

    // --- Update ready tasks ---
    const completedIds = new Set(
      plan.tasks.filter((t) => t.status === "completed").map((t) => t.id),
    );
    updateReadyTasks(plan.tasks, completedIds);
    writePlan(plan);

    // --- Analyze state ---
    const state = analyzeSchedulerState(plan.tasks);

    if (state.allDone) {
      ctx.logger.info(`Plan ${plan.id}: all tasks done, moving to evaluation`);
      break;
    }

    if (state.deadlocked) {
      ctx.logger.warn(`Plan ${plan.id}: deadlock detected`);
      // Check if replan makes sense
      const failRate = state.failedCount / plan.tasks.length;
      if (failRate * 100 >= plan.budget.replanThreshold) {
        const replanSuccess = await handleReplan(plan, signal, ctx);
        if (!replanSuccess) {
          plan = readPlan(plan.id) ?? plan;
          break; // Replan failed, go to evaluation
        }
        plan = readPlan(plan.id) ?? plan;
        continue; // Retry with replanned tasks
      }
      // Can't recover from deadlock without replanning
      break;
    }

    if (!state.hasReady && state.hasRunning) {
      // Tasks are running but none ready; wait briefly then check again
      await sleep(1000, signal);
      continue;
    }

    if (!state.hasReady) {
      // Nothing to do
      break;
    }

    // --- Dispatch workers ---
    const readyTasks = findReadyTasks(plan.tasks);
    const batchSize = Math.min(readyTasks.length, plan.budget.maxConcurrency);
    const batch = readyTasks.slice(0, batchSize);

    // Mark tasks as running
    for (const task of batch) {
      setTaskStatus(plan, task.id, "running");
      task.startedAtMs = Date.now();
    }
    plan.updatedAtMs = Date.now();
    writePlan(plan);

    ctx.logger.info(
      `Plan ${plan.id}: dispatching ${batch.length} workers (${batch.map((t) => t.id).join(", ")})`,
    );

    // Run workers concurrently
    const promises = batch.map((task) =>
      runWorkerAgent({
        task,
        plan,
        coreDeps: ctx.coreDeps,
        cfg: ctx.cfg,
        cliDeps: ctx.cliDeps,
        logger: ctx.logger,
      }).then((result) => ({ taskId: task.id, result })),
    );

    const results = await Promise.allSettled(promises);

    // --- Process results ---
    plan = readPlan(plan.id) ?? plan;
    let batchFailed = 0;
    let batchCompleted = 0;

    for (const settled of results) {
      if (settled.status === "rejected") {
        // Should not happen (runWorkerAgent catches internally), but handle anyway
        continue;
      }

      const { taskId, result } = settled.value;
      const task = plan.tasks.find((t) => t.id === taskId);
      if (!task) continue;

      plan.usage.agentTurns++;

      if (result.status === "ok") {
        task.result = result;
        task.completedAtMs = Date.now();
        setTaskStatus(plan, taskId, "completed");
        batchCompleted++;
        ctx.logger.info(`Plan ${plan.id}: task ${taskId} completed`);
      } else {
        task.result = result;
        task.retries++;
        plan.usage.errors++;

        if (task.retries >= task.maxRetries) {
          setTaskStatus(plan, taskId, "failed");
          batchFailed++;
          ctx.logger.warn(
            `Plan ${plan.id}: task ${taskId} failed (max retries reached): ${result.error}`,
          );
          // Skip downstream tasks
          const skipped = skipDownstreamTasks(plan.tasks, taskId);
          if (skipped.length > 0) {
            ctx.logger.info(`Plan ${plan.id}: skipped downstream tasks: ${skipped.join(", ")}`);
          }
        } else {
          setTaskStatus(plan, taskId, "ready");
          ctx.logger.info(
            `Plan ${plan.id}: task ${taskId} failed, will retry (${task.retries}/${task.maxRetries}): ${result.error}`,
          );
        }
      }
    }

    plan.updatedAtMs = Date.now();
    writePlan(plan);

    // --- Batch evaluation: check if replan needed ---
    const totalInBatch = batchCompleted + batchFailed;
    if (totalInBatch > 0 && batchFailed > 0) {
      const failRate = (batchFailed / totalInBatch) * 100;
      if (failRate >= plan.budget.replanThreshold) {
        ctx.logger.info(
          `Plan ${plan.id}: batch failure rate ${Math.round(failRate)}% exceeds threshold ${plan.budget.replanThreshold}%, replanning`,
        );
        const replanSuccess = await handleReplan(plan, signal, ctx);
        if (!replanSuccess) {
          plan = readPlan(plan.id) ?? plan;
        } else {
          plan = readPlan(plan.id) ?? plan;
        }
      }
    }

    if (plan.notify && (batchCompleted > 0 || batchFailed > 0)) {
      const taskState = analyzeSchedulerState(plan.tasks);
      await ctx
        .notifyFn(
          plan.notify,
          `Plan progress [${plan.id}]: ${taskState.completedCount}/${plan.tasks.length} tasks done` +
            (taskState.failedCount > 0 ? `, ${taskState.failedCount} failed` : "") +
            (taskState.skippedCount > 0 ? `, ${taskState.skippedCount} skipped` : ""),
        )
        .catch(() => {});
    }

    // Brief pause between batches
    await sleep(500, signal);
  }

  if (signal.aborted) return;

  // =========================================================================
  // PHASE 3: COMPLETION / EVALUATION
  // =========================================================================
  plan = readPlan(plan.id) ?? plan;
  plan.currentPhase = "evaluating";
  plan.updatedAtMs = Date.now();
  writePlan(plan);

  ctx.logger.info(`Plan ${plan.id}: running final evaluation`);
  plan.usage.agentTurns++;
  writePlan(plan);

  const evalResult = await runFinalEvaluation({
    plan,
    coreDeps: ctx.coreDeps,
    cfg: ctx.cfg,
    cliDeps: ctx.cliDeps,
    logger: ctx.logger,
  });

  plan = readPlan(plan.id) ?? plan;
  plan.finalEvaluation = evalResult;

  if (evalResult.score >= 95) {
    plan.status = "completed";
    plan.stopReason = `Plan completed with score ${evalResult.score}/100`;
    plan.currentPhase = "done";
  } else {
    // Could replan for remaining gaps, but for v1 just mark as completed
    // with the score. The user can resume or start a new plan.
    plan.status = "completed";
    plan.stopReason = `Plan finished with score ${evalResult.score}/100: ${evalResult.assessment}`;
    plan.currentPhase = "done";
  }

  plan.updatedAtMs = Date.now();
  writePlan(plan);

  ctx.logger.info(`Plan ${plan.id} finished: score ${evalResult.score}/100`);
  if (plan.notify) {
    await ctx
      .notifyFn(
        plan.notify,
        `Plan COMPLETED: ${plan.goal} [${plan.id}] -- Score: ${evalResult.score}/100. ${evalResult.assessment}`,
      )
      .catch(() => {});
  }

  // Fire automation event: plan.completed
  const duration = Date.now() - (plan.usage.startedAtMs || Date.now());
  await fireAutomationEvent((mod) =>
    mod.events.planCompleted(plan.id, plan.goal, evalResult.score, duration, evalResult.assessment),
  );
}

// ---------------------------------------------------------------------------
// Replanning
// ---------------------------------------------------------------------------

async function handleReplan(
  plan: PlanState,
  signal: AbortSignal,
  ctx: {
    coreDeps: CoreDeps;
    cfg: CoreConfig;
    cliDeps: CoreCliDeps;
    pluginConfig: PlannerPluginConfig;
    logger: Logger;
    notifyFn: NotifyFn;
  },
): Promise<boolean> {
  plan = readPlan(plan.id) ?? plan;
  plan.currentPhase = "replanning";
  plan.updatedAtMs = Date.now();
  writePlan(plan);

  ctx.logger.info(`Plan ${plan.id}: triggering replan (revision ${plan.planRevision + 1})`);
  plan.usage.agentTurns++;
  writePlan(plan);

  if (plan.notify) {
    await ctx
      .notifyFn(plan.notify, `Re-planning triggered for [${plan.id}]: adjusting task strategy.`)
      .catch(() => {});
  }

  const replanResult = await runPlannerAgent({
    plan,
    coreDeps: ctx.coreDeps,
    cfg: ctx.cfg,
    cliDeps: ctx.cliDeps,
    logger: ctx.logger,
    replan: true,
  });

  if (!replanResult || replanResult.tasks.length === 0) {
    ctx.logger.warn(`Plan ${plan.id}: replanner produced no tasks`);
    plan.currentPhase = "executing";
    plan.updatedAtMs = Date.now();
    writePlan(plan);
    return false;
  }

  // Merge: keep completed tasks, replace pending/ready/failed with new ones
  const completed = plan.tasks.filter((t) => t.status === "completed");
  const completedIds = new Set(completed.map((t) => t.id));

  const newTasks = applyParsedTasks(replanResult, plan.budget.maxRetries);

  // Filter out tasks that reference already-completed IDs (don't redo them)
  const filteredNew = newTasks.filter((t) => !completedIds.has(t.id));

  // Combine completed + new
  const mergedTasks = [...completed, ...filteredNew];

  const validation = validateDag(mergedTasks);
  if (!validation.valid) {
    ctx.logger.warn(`Plan ${plan.id}: replanned DAG is invalid: ${validation.errors.join("; ")}`);
    plan.currentPhase = "executing";
    plan.updatedAtMs = Date.now();
    writePlan(plan);
    return false;
  }

  plan.tasks = mergedTasks;
  plan.planRevision++;
  plan.currentPhase = "executing";
  updateReadyTasks(plan.tasks, completedIds);
  plan.updatedAtMs = Date.now();
  writePlan(plan);

  ctx.logger.info(
    `Plan ${plan.id}: replanned to ${mergedTasks.length} tasks (revision ${plan.planRevision})`,
  );
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyParsedTasks(parsed: ParsedPlannerResponse, maxRetries: number): PlanTask[] {
  return parsed.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: "pending" as const,
    dependencies: t.dependencies,
    group: t.group,
    retries: 0,
    maxRetries,
  }));
}

function setTaskStatus(plan: PlanState, taskId: string, newStatus: PlanTask["status"]): void {
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const fromStatus = task.status;
  task.status = newStatus;
  appendTaskStateLog({
    planId: plan.id,
    taskId,
    timestamp: Date.now(),
    fromStatus,
    toStatus: newStatus,
  });
}

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
