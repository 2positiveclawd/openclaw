// ---------------------------------------------------------------------------
// Goal Loop – CLI Subcommands
// ---------------------------------------------------------------------------
//
// Registers `openclaw goal` with subcommands:
//   start, stop, status, list, resume, approve, reject

import type { Command } from "commander";
import crypto from "node:crypto";
import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type {
  GoalBudget,
  GoalEvalConfig,
  GoalLoopPluginConfig,
  GoalNotifyConfig,
  GoalState,
} from "./types.js";
import { listGoals, readGoal, writeGoal, readIterationLog, readEvaluationLog } from "./state.js";
import { getActiveGoalIds, isGoalRunning, stopGoalLoop } from "./loop-engine.js";
import { startGoalFromExternal, resolveApproval } from "./loop-service.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Time parsing helper
// ---------------------------------------------------------------------------

function parseTimeStr(input: string): number {
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
  if (!match) {
    const asNum = Number(input);
    if (!Number.isNaN(asNum) && asNum > 0) return asNum;
    throw new Error(
      `Invalid time format: "${input}". Use e.g. "2h", "30m", "120s", or milliseconds.`,
    );
  }
  const value = Number(match[1]);
  switch (match[2].toLowerCase()) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerGoalLoopCli(params: {
  program: Command;
  cfg: CoreConfig;
  ensureCoreDeps: () => Promise<CoreDeps>;
  ensureCliDeps: () => Promise<CoreCliDeps>;
  pluginConfig: GoalLoopPluginConfig;
  logger: Logger;
  createNotifyFn: (coreDeps: CoreDeps) => (notify: GoalNotifyConfig, message: string) => Promise<void>;
}): void {
  const { program, cfg, ensureCoreDeps, ensureCliDeps, pluginConfig, logger, createNotifyFn } = params;

  const root = program
    .command("goal")
    .description("Goal-directed autonomous agent loops with governance");

  // -------------------------------------------------------------------------
  // goal start
  // -------------------------------------------------------------------------
  root
    .command("start")
    .description("Start a new goal loop")
    .requiredOption("--goal <text>", "Goal description")
    .option("--criteria <items...>", "Acceptance criteria (space-separated)")
    .option("--agent-id <id>", "Agent ID to use for iterations")
    .option(
      "--budget-iterations <n>",
      "Max iterations",
      String(pluginConfig.defaultBudgetIterations),
    )
    .option("--budget-tokens <n>", "Max total tokens", String(pluginConfig.defaultBudgetTokens))
    .option(
      "--budget-time <duration>",
      "Max wall-clock time (e.g. 2h, 30m)",
      String(pluginConfig.defaultBudgetTimeMs) + "ms",
    )
    .option(
      "--provider-usage-threshold <n>",
      "Provider usage % threshold",
      String(pluginConfig.defaultProviderUsageThreshold),
    )
    .option(
      "--eval-every <n>",
      "Evaluate every N iterations",
      String(pluginConfig.defaultEvalEvery),
    )
    .option("--eval-model <ref>", "Model for evaluator (alias or provider/model)")
    .option(
      "--stall-threshold <n>",
      "Consecutive flat evals before stall",
      String(pluginConfig.defaultStallThreshold),
    )
    .option("--quality-gate <iterations...>", "Pause for approval at these iterations")
    .option("--notify-channel <channel>", "Notification channel (telegram, discord, etc.)")
    .option("--notify-to <recipient>", "Notification recipient")
    .option("--notify-account-id <id>", "Notification account ID")
    .action(async (opts) => {
      const goalId = crypto.randomUUID().slice(0, 8);
      const now = Date.now();

      const budget: GoalBudget = {
        maxIterations: parseInt(opts.budgetIterations, 10),
        maxTokens: parseInt(opts.budgetTokens, 10),
        maxTimeMs: parseTimeStr(opts.budgetTime),
        providerUsageThreshold: parseInt(opts.providerUsageThreshold, 10),
      };

      const evalConfig: GoalEvalConfig = {
        evalEvery: parseInt(opts.evalEvery, 10),
        evalModel: opts.evalModel ?? pluginConfig.defaultEvalModel,
        stallThreshold: parseInt(opts.stallThreshold, 10),
        minProgressDelta: 5,
        consecutiveErrorLimit: 3,
      };

      const notify: GoalNotifyConfig | null =
        opts.notifyChannel && opts.notifyTo
          ? {
              channel: opts.notifyChannel,
              to: opts.notifyTo,
              accountId: opts.notifyAccountId,
            }
          : null;

      const qualityGates = (opts.qualityGate ?? []).map((s: string) => ({
        atIteration: parseInt(s, 10),
      }));

      const goal: GoalState = {
        id: goalId,
        goal: opts.goal,
        criteria: opts.criteria ?? [],
        status: "pending",
        budget,
        evalConfig,
        notify,
        qualityGates,
        usage: {
          iterations: 0,
          totalTokens: 0,
          errors: 0,
          consecutiveErrors: 0,
          startedAtMs: 0,
        },
        agentId: opts.agentId,
        lastEvaluation: null,
        lastSuggestedAction: null,
        evaluationScores: [],
        stopReason: null,
        createdAtMs: now,
        updatedAtMs: now,
      };

      writeGoal(goal);

      try {
        const coreDeps = await ensureCoreDeps();
        const cliDeps = await ensureCliDeps();
        const notifyFn = createNotifyFn(coreDeps);
        startGoalFromExternal({ goal, coreDeps, cfg, cliDeps, pluginConfig, logger, notifyFn });
        console.log(JSON.stringify({ ok: true, goalId, status: "running" }));
      } catch (err) {
        console.log(
          JSON.stringify({
            ok: false,
            goalId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });

  // -------------------------------------------------------------------------
  // goal stop
  // -------------------------------------------------------------------------
  root
    .command("stop")
    .description("Stop a running goal")
    .argument("<goal-id>", "Goal ID to stop")
    .action(async (goalId: string) => {
      const goal = readGoal(goalId);
      if (!goal) {
        console.log(JSON.stringify({ ok: false, error: `Goal ${goalId} not found` }));
        return;
      }
      stopGoalLoop(goalId);
      goal.status = "stopped";
      goal.stopReason = "Manually stopped";
      goal.updatedAtMs = Date.now();
      writeGoal(goal);
      console.log(JSON.stringify({ ok: true, goalId, status: "stopped" }));
    });

  // -------------------------------------------------------------------------
  // goal status
  // -------------------------------------------------------------------------
  root
    .command("status")
    .description("Show goal status")
    .argument("[goal-id]", "Goal ID (shows all active if omitted)")
    .action(async (goalId?: string) => {
      if (goalId) {
        const goal = readGoal(goalId);
        if (!goal) {
          console.log(JSON.stringify({ ok: false, error: `Goal ${goalId} not found` }));
          return;
        }
        const iterations = readIterationLog(goalId);
        const evaluations = readEvaluationLog(goalId);
        console.log(
          JSON.stringify({
            ok: true,
            goal,
            iterationCount: iterations.length,
            evaluationCount: evaluations.length,
            isRunning: isGoalRunning(goalId),
          }),
        );
      } else {
        const active = getActiveGoalIds();
        const goals = listGoals();
        console.log(
          JSON.stringify({
            ok: true,
            totalGoals: goals.length,
            activeGoalIds: active,
            goals: goals.map((g) => ({
              id: g.id,
              goal: g.goal,
              status: g.status,
              iterations: g.usage.iterations,
              lastScore: g.lastEvaluation?.progressScore ?? null,
              isRunning: isGoalRunning(g.id),
            })),
          }),
        );
      }
    });

  // -------------------------------------------------------------------------
  // goal list
  // -------------------------------------------------------------------------
  root
    .command("list")
    .description("List all goals")
    .option("--active", "Only show active goals")
    .action(async (opts) => {
      const goals = listGoals();
      const filtered = opts.active
        ? goals.filter(
            (g) =>
              g.status === "running" || g.status === "evaluating" || g.status === "paused",
          )
        : goals;
      console.log(
        JSON.stringify({
          ok: true,
          goals: filtered.map((g) => ({
            id: g.id,
            goal: g.goal,
            status: g.status,
            iterations: g.usage.iterations,
            maxIterations: g.budget.maxIterations,
            lastScore: g.lastEvaluation?.progressScore ?? null,
            isRunning: isGoalRunning(g.id),
          })),
        }),
      );
    });

  // -------------------------------------------------------------------------
  // goal resume
  // -------------------------------------------------------------------------
  root
    .command("resume")
    .description("Resume a stopped or budget-exceeded goal")
    .argument("<goal-id>", "Goal ID to resume")
    .option("--add-iterations <n>", "Add iterations to budget")
    .option("--add-tokens <n>", "Add tokens to budget")
    .option("--add-time <duration>", "Add time to budget (e.g. 1h, 30m)")
    .action(async (goalId: string, opts) => {
      const goal = readGoal(goalId);
      if (!goal) {
        console.log(JSON.stringify({ ok: false, error: `Goal ${goalId} not found` }));
        return;
      }
      if (goal.status !== "stopped" && goal.status !== "budget_exceeded") {
        console.log(
          JSON.stringify({
            ok: false,
            error: `Goal ${goalId} is ${goal.status}, can only resume stopped or budget_exceeded goals`,
          }),
        );
        return;
      }

      if (opts.addIterations) {
        goal.budget.maxIterations += parseInt(opts.addIterations, 10);
      }
      if (opts.addTokens) {
        goal.budget.maxTokens += parseInt(opts.addTokens, 10);
      }
      if (opts.addTime) {
        goal.budget.maxTimeMs += parseTimeStr(opts.addTime);
      }

      goal.evaluationScores = [];
      goal.usage.consecutiveErrors = 0;
      goal.stopReason = null;
      goal.status = "pending";
      goal.updatedAtMs = Date.now();
      writeGoal(goal);

      try {
        const coreDeps = await ensureCoreDeps();
        const cliDeps = await ensureCliDeps();
        const notifyFn = createNotifyFn(coreDeps);
        startGoalFromExternal({ goal, coreDeps, cfg, cliDeps, pluginConfig, logger, notifyFn });
        console.log(JSON.stringify({ ok: true, goalId, status: "running" }));
      } catch (err) {
        console.log(
          JSON.stringify({
            ok: false,
            goalId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });

  // -------------------------------------------------------------------------
  // goal approve
  // -------------------------------------------------------------------------
  root
    .command("approve")
    .description("Approve a quality gate for a paused goal")
    .argument("<goal-id>", "Goal ID to approve")
    .action(async (goalId: string) => {
      const goal = readGoal(goalId);
      if (!goal) {
        console.log(JSON.stringify({ ok: false, error: `Goal ${goalId} not found` }));
        return;
      }
      if (goal.status !== "paused") {
        console.log(
          JSON.stringify({
            ok: false,
            error: `Goal ${goalId} is not paused (status: ${goal.status})`,
          }),
        );
        return;
      }
      const resolved = resolveApproval(goalId, "approved");
      if (resolved) {
        console.log(JSON.stringify({ ok: true, goalId, action: "approved" }));
      } else {
        goal.status = "running";
        goal.updatedAtMs = Date.now();
        writeGoal(goal);
        console.log(
          JSON.stringify({
            ok: true,
            goalId,
            action: "approved",
            note: "State updated directly",
          }),
        );
      }
    });

  // -------------------------------------------------------------------------
  // goal reject
  // -------------------------------------------------------------------------
  root
    .command("reject")
    .description("Reject a quality gate for a paused goal")
    .argument("<goal-id>", "Goal ID to reject")
    .action(async (goalId: string) => {
      const goal = readGoal(goalId);
      if (!goal) {
        console.log(JSON.stringify({ ok: false, error: `Goal ${goalId} not found` }));
        return;
      }
      if (goal.status !== "paused") {
        console.log(
          JSON.stringify({
            ok: false,
            error: `Goal ${goalId} is not paused (status: ${goal.status})`,
          }),
        );
        return;
      }
      const resolved = resolveApproval(goalId, "rejected");
      if (resolved) {
        console.log(JSON.stringify({ ok: true, goalId, action: "rejected" }));
      } else {
        goal.status = "stopped";
        goal.stopReason = "Quality gate rejected";
        goal.updatedAtMs = Date.now();
        writeGoal(goal);
        console.log(
          JSON.stringify({
            ok: true,
            goalId,
            action: "rejected",
            note: "State updated directly",
          }),
        );
      }
    });
}
