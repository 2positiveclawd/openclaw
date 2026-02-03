// ---------------------------------------------------------------------------
// Planner – Plan Service (Long-Running)
// ---------------------------------------------------------------------------
//
// Manages plan lifecycle: start, resume, stop. Registers as an OpenClaw
// plugin service that resumes active plans on gateway restart.

import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type { PlannerPluginConfig, PlanNotifyConfig, PlanState } from "./types.js";
import { listPlans, readPlan, writePlan } from "./state.js";
import {
  getActivePlanIds,
  isPlanRunning,
  runPlanOrchestrator,
  stopPlan,
} from "./orchestrator.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type ServiceContext = {
  config: CoreConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: Logger;
};

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export type PlannerService = {
  id: string;
  start: (ctx: ServiceContext) => void | Promise<void>;
  stop?: (ctx: ServiceContext) => void | Promise<void>;
};

export function createPlannerService(params: {
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  coreDeps: CoreDeps;
  pluginConfig: PlannerPluginConfig;
  logger: Logger;
  notifyFn: (notify: PlanNotifyConfig, message: string) => Promise<void>;
}): PlannerService {
  const { cfg, cliDeps, coreDeps, pluginConfig, logger, notifyFn } = params;

  const startPlan = (plan: PlanState): void => {
    if (isPlanRunning(plan.id)) {
      logger.warn(`Plan ${plan.id} is already running`);
      return;
    }

    const activeCount = getActivePlanIds().length;
    if (activeCount >= pluginConfig.maxConcurrentPlans) {
      logger.warn(
        `Cannot start plan ${plan.id}: max concurrent plans reached (${activeCount}/${pluginConfig.maxConcurrentPlans})`,
      );
      return;
    }

    runPlanOrchestrator({
      plan,
      coreDeps,
      cfg,
      cliDeps,
      pluginConfig,
      logger,
      notifyFn,
    }).catch((err) => {
      logger.error(`Plan orchestrator ${plan.id} threw unexpectedly: ${err}`);
    });
  };

  return {
    id: "planner",

    start: async (_ctx: ServiceContext) => {
      if (!pluginConfig.enabled) {
        logger.info("Planner plugin disabled");
        return;
      }
      logger.info("Planner service starting");

      const plans = listPlans();
      const resumable = plans.filter(
        (p) => p.status === "running" || p.status === "planning",
      );
      if (resumable.length > 0) {
        logger.info(`Resuming ${resumable.length} plan(s)`);
        for (const plan of resumable.slice(0, pluginConfig.maxConcurrentPlans)) {
          startPlan(plan);
        }
      }
    },

    stop: async (_ctx: ServiceContext) => {
      logger.info("Planner service stopping");
      const activeIds = getActivePlanIds();
      for (const id of activeIds) {
        stopPlan(id);
        const plan = readPlan(id);
        if (plan && (plan.status === "running" || plan.status === "planning")) {
          plan.updatedAtMs = Date.now();
          writePlan(plan);
        }
      }
    },
  };
}

/**
 * Start a plan from external callers (CLI, gateway).
 */
export function startPlanFromExternal(params: {
  plan: PlanState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  pluginConfig: PlannerPluginConfig;
  logger: Logger;
  notifyFn: (notify: PlanNotifyConfig, message: string) => Promise<void>;
}): void {
  const { plan, coreDeps, cfg, cliDeps, pluginConfig, logger, notifyFn } = params;

  if (isPlanRunning(plan.id)) {
    logger.warn(`Plan ${plan.id} is already running`);
    return;
  }

  const activeCount = getActivePlanIds().length;
  if (activeCount >= pluginConfig.maxConcurrentPlans) {
    throw new Error(
      `Max concurrent plans reached (${activeCount}/${pluginConfig.maxConcurrentPlans})`,
    );
  }

  runPlanOrchestrator({
    plan,
    coreDeps,
    cfg,
    cliDeps,
    pluginConfig,
    logger,
    notifyFn,
  }).catch((err) => {
    logger.error(`Plan orchestrator ${plan.id} threw unexpectedly: ${err}`);
  });
}
