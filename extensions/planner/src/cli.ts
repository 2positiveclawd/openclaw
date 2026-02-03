// ---------------------------------------------------------------------------
// Planner – CLI Subcommands
// ---------------------------------------------------------------------------
//
// Registers `openclaw planner` with subcommands:
//   start, stop, status, list, tasks, resume

import type { Command } from "commander";
import crypto from "node:crypto";
import fs from "node:fs";
import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type {
  PlanBudget,
  PlannerPluginConfig,
  PlanNotifyConfig,
  PlanState,
} from "./types.js";
import { listPlans, readPlan, writePlan, readWorkerRunLog, readEvaluationLog } from "./state.js";
import { getActivePlanIds, isPlanRunning, stopPlan } from "./orchestrator.js";
import { startPlanFromExternal } from "./plan-service.js";

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

export function registerPlannerCli(params: {
  program: Command;
  cfg: CoreConfig;
  ensureCoreDeps: () => Promise<CoreDeps>;
  ensureCliDeps: () => Promise<CoreCliDeps>;
  pluginConfig: PlannerPluginConfig;
  logger: Logger;
  createNotifyFn: (
    coreDeps: CoreDeps,
  ) => (notify: PlanNotifyConfig, message: string) => Promise<void>;
}): void {
  const { program, cfg, ensureCoreDeps, ensureCliDeps, pluginConfig, logger, createNotifyFn } =
    params;

  const root = program
    .command("planner")
    .description("Task-based goal decomposition with DAG scheduling and parallel execution");

  // -------------------------------------------------------------------------
  // planner start
  // -------------------------------------------------------------------------
  root
    .command("start")
    .description("Start a new plan")
    .requiredOption("--goal <text>", "Goal description")
    .option("--criteria <items...>", "Acceptance criteria (space-separated)")
    .option("--from-prd <path>", "Load goal and criteria from a PRD file")
    .option(
      "--max-turns <n>",
      "Max total agent turns",
      String(pluginConfig.defaultMaxAgentTurns),
    )
    .option(
      "--max-tokens <n>",
      "Max total tokens",
      String(pluginConfig.defaultMaxTokens),
    )
    .option(
      "--max-time <duration>",
      "Max wall-clock time (e.g. 2h, 30m)",
      String(pluginConfig.defaultMaxTimeMs) + "ms",
    )
    .option(
      "--concurrency <n>",
      "Max parallel workers",
      String(pluginConfig.defaultMaxConcurrency),
    )
    .option(
      "--max-retries <n>",
      "Per-task retry limit",
      String(pluginConfig.defaultMaxRetries),
    )
    .option(
      "--replan-threshold <n>",
      "Re-plan if batch failure rate exceeds this %",
      String(pluginConfig.defaultReplanThreshold),
    )
    .option("--notify-channel <channel>", "Notification channel")
    .option("--notify-to <recipient>", "Notification recipient")
    .option("--notify-account-id <id>", "Notification account ID")
    .action(async (opts) => {
      let goalText = opts.goal;
      let criteria: string[] = opts.criteria ?? [];

      // Load from PRD if specified
      if (opts.fromPrd) {
        try {
          const prdContent = fs.readFileSync(opts.fromPrd, "utf-8");
          const prdGoal = extractPrdGoal(prdContent);
          const prdCriteria = extractPrdCriteria(prdContent);
          if (prdGoal) goalText = prdGoal;
          if (prdCriteria.length > 0 && criteria.length === 0) criteria = prdCriteria;
        } catch (err) {
          console.log(
            JSON.stringify({
              ok: false,
              error: `Failed to read PRD: ${err instanceof Error ? err.message : err}`,
            }),
          );
          return;
        }
      }

      const planId = crypto.randomUUID().slice(0, 8);
      const now = Date.now();

      const budget: PlanBudget = {
        maxAgentTurns: parseInt(opts.maxTurns, 10),
        maxTokens: parseInt(opts.maxTokens, 10),
        maxTimeMs: parseTimeStr(opts.maxTime),
        maxRetries: parseInt(opts.maxRetries, 10),
        maxConcurrency: parseInt(opts.concurrency, 10),
        replanThreshold: parseInt(opts.replanThreshold, 10),
      };

      const notify: PlanNotifyConfig | null =
        opts.notifyChannel && opts.notifyTo
          ? {
              channel: opts.notifyChannel,
              to: opts.notifyTo,
              accountId: opts.notifyAccountId,
            }
          : null;

      const plan: PlanState = {
        id: planId,
        goal: goalText,
        criteria,
        status: "pending",
        tasks: [],
        budget,
        usage: { agentTurns: 0, totalTokens: 0, errors: 0, startedAtMs: 0 },
        notify,
        currentPhase: "planning",
        planRevision: 0,
        finalEvaluation: null,
        stopReason: null,
        createdAtMs: now,
        updatedAtMs: now,
      };

      writePlan(plan);

      try {
        const coreDeps = await ensureCoreDeps();
        const cliDeps = await ensureCliDeps();
        const notifyFn = createNotifyFn(coreDeps);
        startPlanFromExternal({
          plan,
          coreDeps,
          cfg,
          cliDeps,
          pluginConfig,
          logger,
          notifyFn,
        });
        console.log(JSON.stringify({ ok: true, planId, status: "planning" }));
      } catch (err) {
        console.log(
          JSON.stringify({
            ok: false,
            planId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });

  // -------------------------------------------------------------------------
  // planner stop
  // -------------------------------------------------------------------------
  root
    .command("stop")
    .description("Stop a running plan")
    .argument("<plan-id>", "Plan ID to stop")
    .action(async (planId: string) => {
      const plan = readPlan(planId);
      if (!plan) {
        console.log(JSON.stringify({ ok: false, error: `Plan ${planId} not found` }));
        return;
      }
      stopPlan(planId);
      plan.status = "stopped";
      plan.stopReason = "Manually stopped";
      plan.updatedAtMs = Date.now();
      writePlan(plan);
      console.log(JSON.stringify({ ok: true, planId, status: "stopped" }));
    });

  // -------------------------------------------------------------------------
  // planner status
  // -------------------------------------------------------------------------
  root
    .command("status")
    .description("Show plan status")
    .argument("[plan-id]", "Plan ID (shows all if omitted)")
    .action(async (planId?: string) => {
      if (planId) {
        const plan = readPlan(planId);
        if (!plan) {
          console.log(JSON.stringify({ ok: false, error: `Plan ${planId} not found` }));
          return;
        }
        const workerRuns = readWorkerRunLog(planId);
        const evaluations = readEvaluationLog(planId);
        console.log(
          JSON.stringify({
            ok: true,
            plan,
            workerRunCount: workerRuns.length,
            evaluationCount: evaluations.length,
            isRunning: isPlanRunning(planId),
          }),
        );
      } else {
        const active = getActivePlanIds();
        const plans = listPlans();
        console.log(
          JSON.stringify({
            ok: true,
            totalPlans: plans.length,
            activePlanIds: active,
            plans: plans.map((p) => ({
              id: p.id,
              goal: p.goal,
              status: p.status,
              phase: p.currentPhase,
              tasks: p.tasks.length,
              completedTasks: p.tasks.filter((t) => t.status === "completed").length,
              agentTurns: p.usage.agentTurns,
              finalScore: p.finalEvaluation?.score ?? null,
              isRunning: isPlanRunning(p.id),
            })),
          }),
        );
      }
    });

  // -------------------------------------------------------------------------
  // planner list
  // -------------------------------------------------------------------------
  root
    .command("list")
    .description("List all plans")
    .option("--active", "Only show active plans")
    .action(async (opts) => {
      const plans = listPlans();
      const filtered = opts.active
        ? plans.filter(
            (p) =>
              p.status === "planning" || p.status === "running",
          )
        : plans;
      console.log(
        JSON.stringify({
          ok: true,
          plans: filtered.map((p) => ({
            id: p.id,
            goal: p.goal,
            status: p.status,
            phase: p.currentPhase,
            tasks: p.tasks.length,
            completedTasks: p.tasks.filter((t) => t.status === "completed").length,
            agentTurns: p.usage.agentTurns,
            maxAgentTurns: p.budget.maxAgentTurns,
            finalScore: p.finalEvaluation?.score ?? null,
            isRunning: isPlanRunning(p.id),
          })),
        }),
      );
    });

  // -------------------------------------------------------------------------
  // planner tasks (kanban view)
  // -------------------------------------------------------------------------
  root
    .command("tasks")
    .description("Show task board for a plan")
    .argument("<plan-id>", "Plan ID")
    .action(async (planId: string) => {
      const plan = readPlan(planId);
      if (!plan) {
        console.log(JSON.stringify({ ok: false, error: `Plan ${planId} not found` }));
        return;
      }

      // Group tasks by status for kanban-style display
      const groups: Record<string, typeof plan.tasks> = {
        pending: [],
        ready: [],
        running: [],
        completed: [],
        failed: [],
        skipped: [],
      };

      for (const task of plan.tasks) {
        groups[task.status]?.push(task);
      }

      const lines: string[] = [
        `Plan: ${plan.goal} [${plan.id}]`,
        `Status: ${plan.status} | Phase: ${plan.currentPhase} | Revision: ${plan.planRevision}`,
        `Turns: ${plan.usage.agentTurns}/${plan.budget.maxAgentTurns}`,
        "",
      ];

      for (const [status, tasks] of Object.entries(groups)) {
        if (tasks.length === 0) continue;
        lines.push(`--- ${status.toUpperCase()} (${tasks.length}) ---`);
        for (const t of tasks) {
          const deps = t.dependencies.length > 0 ? ` [deps: ${t.dependencies.join(",")}]` : "";
          const group = t.group ? ` (${t.group})` : "";
          const retries = t.retries > 0 ? ` [retries: ${t.retries}/${t.maxRetries}]` : "";
          const summary = t.result?.summary ? ` -- ${t.result.summary.slice(0, 80)}` : "";
          const error = t.result?.error ? ` -- ERR: ${t.result.error.slice(0, 80)}` : "";
          lines.push(`  [${t.id}] ${t.title}${group}${deps}${retries}${summary}${error}`);
        }
        lines.push("");
      }

      if (plan.finalEvaluation) {
        lines.push(`Final Score: ${plan.finalEvaluation.score}/100`);
        lines.push(`Assessment: ${plan.finalEvaluation.assessment}`);
      }

      // Output as both text (for human) and JSON (for programmatic use)
      console.log(lines.join("\n"));
    });

  // -------------------------------------------------------------------------
  // planner resume
  // -------------------------------------------------------------------------
  root
    .command("resume")
    .description("Resume a stopped plan")
    .argument("<plan-id>", "Plan ID to resume")
    .option("--add-turns <n>", "Add agent turns to budget")
    .option("--add-tokens <n>", "Add tokens to budget")
    .option("--add-time <duration>", "Add time to budget")
    .action(async (planId: string, opts) => {
      const plan = readPlan(planId);
      if (!plan) {
        console.log(JSON.stringify({ ok: false, error: `Plan ${planId} not found` }));
        return;
      }
      if (plan.status !== "stopped" && plan.status !== "failed") {
        console.log(
          JSON.stringify({
            ok: false,
            error: `Plan ${planId} is ${plan.status}, can only resume stopped or failed plans`,
          }),
        );
        return;
      }

      if (opts.addTurns) {
        plan.budget.maxAgentTurns += parseInt(opts.addTurns, 10);
      }
      if (opts.addTokens) {
        plan.budget.maxTokens += parseInt(opts.addTokens, 10);
      }
      if (opts.addTime) {
        plan.budget.maxTimeMs += parseTimeStr(opts.addTime);
      }

      plan.stopReason = null;
      plan.status = "pending";
      plan.updatedAtMs = Date.now();
      writePlan(plan);

      try {
        const coreDeps = await ensureCoreDeps();
        const cliDeps = await ensureCliDeps();
        const notifyFn = createNotifyFn(coreDeps);
        startPlanFromExternal({
          plan,
          coreDeps,
          cfg,
          cliDeps,
          pluginConfig,
          logger,
          notifyFn,
        });
        console.log(JSON.stringify({ ok: true, planId, status: "running" }));
      } catch (err) {
        console.log(
          JSON.stringify({
            ok: false,
            planId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });
}

// ---------------------------------------------------------------------------
// PRD parsing helpers
// ---------------------------------------------------------------------------

function extractPrdGoal(content: string): string | null {
  // Look for a "Goal" or "Objective" section
  const goalMatch = content.match(
    /^#+\s*(?:Goal|Objective|Project Goal)\s*\n+([\s\S]*?)(?=\n#|\n---|\Z)/im,
  );
  if (goalMatch) {
    return goalMatch[1].trim().split("\n")[0].trim();
  }
  return null;
}

function extractPrdCriteria(content: string): string[] {
  // Look for "Acceptance Criteria" or "Success Criteria" section
  const criteriaMatch = content.match(
    /^#+\s*(?:Acceptance|Success)\s*Criteria\s*\n+([\s\S]*?)(?=\n#|\n---|\Z)/im,
  );
  if (!criteriaMatch) return [];

  return criteriaMatch[1]
    .split("\n")
    .map((line) => line.replace(/^[-*\d.]+\s*/, "").trim())
    .filter((line) => line.length > 0);
}
