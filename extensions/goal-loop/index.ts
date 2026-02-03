// ---------------------------------------------------------------------------
// Goal Loop Plugin – Entry Point
// ---------------------------------------------------------------------------
//
// Registers:
//   - Service: long-running loop manager (start/stop, resume on restart)
//   - CLI: `openclaw goal` subcommands
//   - Gateway RPC: `goal-loop.status`
//   - HTTP route: GET /goal-loop/status
//   - Channel commands: /goal-approve, /goal-reject, /goal-status

import type { GoalLoopPluginConfig, GoalNotifyConfig } from "./src/types.js";
import type { CoreDeps, CoreCliDeps } from "./src/core-bridge.js";
import { loadCoreDeps } from "./src/core-bridge.js";
import { listGoals, readGoal, writeGoal, readIterationLog, readEvaluationLog } from "./src/state.js";
import { getActiveGoalIds, isGoalRunning } from "./src/loop-engine.js";
import { createGoalLoopService, resolveApproval } from "./src/loop-service.js";
import { registerGoalLoopCli } from "./src/cli.js";

// ---------------------------------------------------------------------------
// Plugin config defaults
// ---------------------------------------------------------------------------

function resolvePluginConfig(raw?: Record<string, unknown>): GoalLoopPluginConfig {
  return {
    enabled: raw?.enabled !== false,
    maxConcurrentGoals: asInt(raw?.maxConcurrentGoals, 3),
    defaultEvalModel: typeof raw?.defaultEvalModel === "string" ? raw.defaultEvalModel : null,
    defaultBudgetIterations: asInt(raw?.defaultBudgetIterations, 50),
    defaultBudgetTokens: asInt(raw?.defaultBudgetTokens, 1_000_000),
    defaultBudgetTimeMs: asInt(raw?.defaultBudgetTimeMs, 4 * 3_600_000),
    defaultEvalEvery: asInt(raw?.defaultEvalEvery, 5),
    defaultStallThreshold: asInt(raw?.defaultStallThreshold, 3),
    defaultProviderUsageThreshold: asInt(raw?.defaultProviderUsageThreshold, 80),
    approvalTimeoutMs: asInt(raw?.approvalTimeoutMs, 30 * 60_000),
    approvalTimeoutAction:
      raw?.approvalTimeoutAction === "auto-approve" ? "auto-approve" : "auto-reject",
  };
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Notification helper factory
// ---------------------------------------------------------------------------

function createNotifyFn(
  coreDeps: CoreDeps,
  cfg: Record<string, unknown>,
  logger: { warn: (msg: string) => void },
): (notify: GoalNotifyConfig, message: string) => Promise<void> {
  return async (notify, message) => {
    try {
      await coreDeps.deliverOutboundPayloads({
        cfg,
        channel: notify.channel,
        to: notify.to,
        accountId: notify.accountId,
        payloads: [{ text: message }],
        bestEffort: true,
      });
    } catch (err) {
      logger.warn(`Notification delivery failed: ${err}`);
    }
  };
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const goalLoopPlugin = {
  id: "goal-loop",
  name: "Goal Loop",
  description:
    "Autonomous goal-directed agent loops with budget controls, progress evaluation, and governance",
  version: "2026.2.1",

  register(api: {
    config: Record<string, unknown>;
    pluginConfig?: Record<string, unknown>;
    logger: {
      debug?: (msg: string) => void;
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (msg: string) => void;
    };
    registerService: (service: {
      id: string;
      start: (ctx: unknown) => void | Promise<void>;
      stop?: (ctx: unknown) => void | Promise<void>;
    }) => void;
    registerCli: (
      registrar: (ctx: { program: import("commander").Command }) => void | Promise<void>,
      opts?: { commands?: string[] },
    ) => void;
    registerGatewayMethod: (
      method: string,
      handler: (opts: {
        params: Record<string, unknown>;
        respond: (ok: boolean, payload?: unknown) => void;
      }) => Promise<void> | void,
    ) => void;
    registerHttpRoute: (params: {
      path: string;
      handler: (
        req: import("node:http").IncomingMessage,
        res: import("node:http").ServerResponse,
      ) => Promise<void> | void;
    }) => void;
    registerCommand: (command: {
      name: string;
      description: string;
      acceptsArgs?: boolean;
      requireAuth?: boolean;
      handler: (ctx: {
        args?: string;
        channel: string;
        isAuthorizedSender: boolean;
      }) => { text?: string } | Promise<{ text?: string }>;
    }) => void;
  }) {
    const pluginConfig = resolvePluginConfig(api.pluginConfig);
    const logger = api.logger;

    // Lazy-loaded core deps (async, resolved on first use).
    let coreDepsCache: CoreDeps | null = null;
    let coreDepsPromise: Promise<CoreDeps> | null = null;
    let cliDepsCache: CoreCliDeps | null = null;

    const ensureCoreDeps = async (): Promise<CoreDeps> => {
      if (coreDepsCache) return coreDepsCache;
      if (!coreDepsPromise) {
        coreDepsPromise = loadCoreDeps();
      }
      coreDepsCache = await coreDepsPromise;
      return coreDepsCache;
    };

    const ensureCliDeps = async (): Promise<CoreCliDeps> => {
      if (cliDepsCache) return cliDepsCache;
      const core = await ensureCoreDeps();
      cliDepsCache = core.createDefaultDeps();
      return cliDepsCache;
    };

    // -------------------------------------------------------------------
    // 1. Register service
    // -------------------------------------------------------------------
    api.registerService({
      id: "goal-loop",
      start: async (ctx: unknown) => {
        if (!pluginConfig.enabled) {
          logger.info("Goal loop plugin disabled");
          return;
        }
        try {
          const coreDeps = await ensureCoreDeps();
          const cliDeps = await ensureCliDeps();
          const notifyFn = createNotifyFn(coreDeps, api.config, logger);
          const service = createGoalLoopService({
            cfg: api.config,
            cliDeps,
            coreDeps,
            pluginConfig,
            logger,
            notifyFn,
          });
          await service.start(ctx as Parameters<typeof service.start>[0]);
        } catch (err) {
          logger.error(`Goal loop service failed to start: ${err}`);
        }
      },
      stop: async (ctx: unknown) => {
        try {
          const coreDeps = await ensureCoreDeps();
          const cliDeps = await ensureCliDeps();
          const notifyFn = createNotifyFn(coreDeps, api.config, logger);
          const service = createGoalLoopService({
            cfg: api.config,
            cliDeps,
            coreDeps,
            pluginConfig,
            logger,
            notifyFn,
          });
          await service.stop?.(ctx as Parameters<typeof service.start>[0]);
        } catch (err) {
          logger.error(`Goal loop service failed to stop: ${err}`);
        }
      },
    });

    // -------------------------------------------------------------------
    // 2. Register CLI (synchronous — heavy deps deferred to action time)
    // -------------------------------------------------------------------
    api.registerCli(
      ({ program }) => {
        registerGoalLoopCli({
          program,
          cfg: api.config,
          ensureCoreDeps,
          ensureCliDeps,
          pluginConfig,
          logger,
          createNotifyFn: (coreDeps) => createNotifyFn(coreDeps, api.config, logger),
        });
      },
      { commands: ["goal"] },
    );

    // -------------------------------------------------------------------
    // 3. Register gateway RPC method
    // -------------------------------------------------------------------
    api.registerGatewayMethod("goal-loop.status", async ({ params, respond }) => {
      try {
        const goalId = typeof params.goalId === "string" ? params.goalId : undefined;
        if (goalId) {
          const goal = readGoal(goalId);
          if (!goal) {
            respond(false, { error: `Goal ${goalId} not found` });
            return;
          }
          respond(true, {
            goal,
            iterations: readIterationLog(goalId),
            evaluations: readEvaluationLog(goalId),
            isRunning: isGoalRunning(goalId),
          });
        } else {
          const goals = listGoals();
          respond(true, {
            totalGoals: goals.length,
            activeGoalIds: getActiveGoalIds(),
            goals: goals.map((g) => ({
              id: g.id,
              goal: g.goal,
              status: g.status,
              iterations: g.usage.iterations,
              lastScore: g.lastEvaluation?.progressScore ?? null,
              isRunning: isGoalRunning(g.id),
            })),
          });
        }
      } catch (err) {
        respond(false, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    // -------------------------------------------------------------------
    // 4. Register HTTP route
    // -------------------------------------------------------------------
    api.registerHttpRoute({
      path: "/goal-loop/status",
      handler: async (_req, res) => {
        const goals = listGoals();
        const payload = {
          totalGoals: goals.length,
          activeGoalIds: getActiveGoalIds(),
          goals: goals.map((g) => ({
            id: g.id,
            goal: g.goal,
            status: g.status,
            iterations: g.usage.iterations,
            maxIterations: g.budget.maxIterations,
            tokens: g.usage.totalTokens,
            maxTokens: g.budget.maxTokens,
            lastScore: g.lastEvaluation?.progressScore ?? null,
            isRunning: isGoalRunning(g.id),
            stopReason: g.stopReason,
          })),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      },
    });

    // -------------------------------------------------------------------
    // 5. Register channel text commands
    // -------------------------------------------------------------------
    api.registerCommand({
      name: "goal-approve",
      description: "Approve a quality gate for a paused goal",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const goalId = ctx.args?.trim();
        if (!goalId) {
          return { text: "Usage: /goal-approve <goal-id>" };
        }
        const goal = readGoal(goalId);
        if (!goal) {
          return { text: `Goal ${goalId} not found.` };
        }
        if (goal.status !== "paused") {
          return { text: `Goal ${goalId} is not paused (status: ${goal.status}).` };
        }
        const resolved = resolveApproval(goalId, "approved");
        if (resolved) {
          return { text: `Goal ${goalId} approved. Resuming.` };
        }
        goal.status = "running";
        goal.updatedAtMs = Date.now();
        writeGoal(goal);
        return { text: `Goal ${goalId} approved (state updated directly).` };
      },
    });

    api.registerCommand({
      name: "goal-reject",
      description: "Reject a quality gate for a paused goal",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const goalId = ctx.args?.trim();
        if (!goalId) {
          return { text: "Usage: /goal-reject <goal-id>" };
        }
        const goal = readGoal(goalId);
        if (!goal) {
          return { text: `Goal ${goalId} not found.` };
        }
        if (goal.status !== "paused") {
          return { text: `Goal ${goalId} is not paused (status: ${goal.status}).` };
        }
        const resolved = resolveApproval(goalId, "rejected");
        if (resolved) {
          return { text: `Goal ${goalId} rejected. Stopping.` };
        }
        goal.status = "stopped";
        goal.stopReason = "Quality gate rejected";
        goal.updatedAtMs = Date.now();
        writeGoal(goal);
        return { text: `Goal ${goalId} rejected (stopped).` };
      },
    });

    // -------------------------------------------------------------------
    // 6. Register goal-status command for quick checks
    // -------------------------------------------------------------------
    api.registerCommand({
      name: "goal-status",
      description: "Show goal loop status",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const goalId = ctx.args?.trim();
        if (goalId) {
          const goal = readGoal(goalId);
          if (!goal) {
            return { text: `Goal ${goalId} not found.` };
          }
          const lines = [
            `Goal: ${goal.goal}`,
            `Status: ${goal.status}${isGoalRunning(goal.id) ? " (loop active)" : ""}`,
            `Iterations: ${goal.usage.iterations}/${goal.budget.maxIterations}`,
            `Tokens: ${goal.usage.totalTokens}/${goal.budget.maxTokens}`,
          ];
          if (goal.lastEvaluation) {
            lines.push(`Last score: ${goal.lastEvaluation.progressScore}/100`);
            lines.push(`Assessment: ${goal.lastEvaluation.assessment}`);
          }
          if (goal.stopReason) {
            lines.push(`Stop reason: ${goal.stopReason}`);
          }
          return { text: lines.join("\n") };
        }
        const goals = listGoals();
        if (goals.length === 0) {
          return { text: "No goals." };
        }
        const lines = goals.map(
          (g) =>
            `[${g.id}] ${g.status}${isGoalRunning(g.id) ? "*" : ""} — ${g.usage.iterations}/${g.budget.maxIterations} — ${g.goal.slice(0, 60)}`,
        );
        return { text: lines.join("\n") };
      },
    });
  },
};

export default goalLoopPlugin;
