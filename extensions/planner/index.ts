// ---------------------------------------------------------------------------
// Planner Plugin – Entry Point
// ---------------------------------------------------------------------------
//
// Registers:
//   - Service: plan orchestrator manager (start/stop, resume on restart)
//   - CLI: `openclaw planner` subcommands
//   - Gateway RPC: `planner.status`
//   - HTTP route: GET /planner/status
//   - Channel commands: /plan-status

import type { PlannerPluginConfig, PlanNotifyConfig } from "./src/types.js";
import type { CoreDeps, CoreCliDeps } from "./src/core-bridge.js";
import { loadCoreDeps } from "./src/core-bridge.js";
import { listPlans, readPlan, readWorkerRunLog, readEvaluationLog } from "./src/state.js";
import { getActivePlanIds, isPlanRunning } from "./src/orchestrator.js";
import { createPlannerService } from "./src/plan-service.js";
import { registerPlannerCli } from "./src/cli.js";

// ---------------------------------------------------------------------------
// Plugin config defaults
// ---------------------------------------------------------------------------

function resolvePluginConfig(raw?: Record<string, unknown>): PlannerPluginConfig {
  return {
    enabled: raw?.enabled !== false,
    maxConcurrentPlans: asInt(raw?.maxConcurrentPlans, 3),
    defaultMaxAgentTurns: asInt(raw?.defaultMaxAgentTurns, 50),
    defaultMaxTokens: asInt(raw?.defaultMaxTokens, 500_000),
    defaultMaxTimeMs: asInt(raw?.defaultMaxTimeMs, 3_600_000),
    defaultMaxConcurrency: asInt(raw?.defaultMaxConcurrency, 3),
    defaultMaxRetries: asInt(raw?.defaultMaxRetries, 2),
    defaultReplanThreshold: asInt(raw?.defaultReplanThreshold, 50),
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
): (notify: PlanNotifyConfig, message: string) => Promise<void> {
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

const plannerPlugin = {
  id: "planner",
  name: "Planner",
  description:
    "Task-based goal decomposition with DAG scheduling, parallel execution, and replanning",
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
      id: "planner",
      start: async (ctx: unknown) => {
        if (!pluginConfig.enabled) {
          logger.info("Planner plugin disabled");
          return;
        }
        try {
          const coreDeps = await ensureCoreDeps();
          const cliDeps = await ensureCliDeps();
          const notifyFn = createNotifyFn(coreDeps, api.config, logger);
          const service = createPlannerService({
            cfg: api.config,
            cliDeps,
            coreDeps,
            pluginConfig,
            logger,
            notifyFn,
          });
          await service.start(ctx as Parameters<typeof service.start>[0]);
        } catch (err) {
          logger.error(`Planner service failed to start: ${err}`);
        }
      },
      stop: async (ctx: unknown) => {
        try {
          const coreDeps = await ensureCoreDeps();
          const cliDeps = await ensureCliDeps();
          const notifyFn = createNotifyFn(coreDeps, api.config, logger);
          const service = createPlannerService({
            cfg: api.config,
            cliDeps,
            coreDeps,
            pluginConfig,
            logger,
            notifyFn,
          });
          await service.stop?.(ctx as Parameters<typeof service.start>[0]);
        } catch (err) {
          logger.error(`Planner service failed to stop: ${err}`);
        }
      },
    });

    // -------------------------------------------------------------------
    // 2. Register CLI
    // -------------------------------------------------------------------
    api.registerCli(
      ({ program }) => {
        registerPlannerCli({
          program,
          cfg: api.config,
          ensureCoreDeps,
          ensureCliDeps,
          pluginConfig,
          logger,
          createNotifyFn: (coreDeps) => createNotifyFn(coreDeps, api.config, logger),
        });
      },
      { commands: ["planner"] },
    );

    // -------------------------------------------------------------------
    // 3. Register gateway RPC method
    // -------------------------------------------------------------------
    api.registerGatewayMethod("planner.status", async ({ params, respond }) => {
      try {
        const planId = typeof params.planId === "string" ? params.planId : undefined;
        if (planId) {
          const plan = readPlan(planId);
          if (!plan) {
            respond(false, { error: `Plan ${planId} not found` });
            return;
          }
          respond(true, {
            plan,
            workerRuns: readWorkerRunLog(planId),
            evaluations: readEvaluationLog(planId),
            isRunning: isPlanRunning(planId),
          });
        } else {
          const plans = listPlans();
          respond(true, {
            totalPlans: plans.length,
            activePlanIds: getActivePlanIds(),
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
      path: "/planner/status",
      handler: async (_req, res) => {
        const plans = listPlans();
        const payload = {
          totalPlans: plans.length,
          activePlanIds: getActivePlanIds(),
          plans: plans.map((p) => ({
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
            stopReason: p.stopReason,
          })),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      },
    });

    // -------------------------------------------------------------------
    // 5. Register channel command: /plan-status
    // -------------------------------------------------------------------
    api.registerCommand({
      name: "plan-status",
      description: "Show planner status",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const planId = ctx.args?.trim();
        if (planId) {
          const plan = readPlan(planId);
          if (!plan) {
            return { text: `Plan ${planId} not found.` };
          }
          const completed = plan.tasks.filter((t) => t.status === "completed").length;
          const failed = plan.tasks.filter((t) => t.status === "failed").length;
          const lines = [
            `Plan: ${plan.goal}`,
            `Status: ${plan.status}${isPlanRunning(plan.id) ? " (active)" : ""} | Phase: ${plan.currentPhase}`,
            `Tasks: ${completed}/${plan.tasks.length} done${failed > 0 ? `, ${failed} failed` : ""}`,
            `Turns: ${plan.usage.agentTurns}/${plan.budget.maxAgentTurns}`,
          ];
          if (plan.finalEvaluation) {
            lines.push(`Score: ${plan.finalEvaluation.score}/100`);
            lines.push(`Assessment: ${plan.finalEvaluation.assessment}`);
          }
          if (plan.stopReason) {
            lines.push(`Stop reason: ${plan.stopReason}`);
          }
          return { text: lines.join("\n") };
        }
        const plans = listPlans();
        if (plans.length === 0) {
          return { text: "No plans." };
        }
        const lines = plans.map((p) => {
          const completed = p.tasks.filter((t) => t.status === "completed").length;
          return `[${p.id}] ${p.status}${isPlanRunning(p.id) ? "*" : ""} — ${completed}/${p.tasks.length} tasks — ${p.goal.slice(0, 60)}`;
        });
        return { text: lines.join("\n") };
      },
    });
  },
};

export default plannerPlugin;
