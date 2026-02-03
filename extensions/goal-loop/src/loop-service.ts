// ---------------------------------------------------------------------------
// Goal Loop – Long-Running Service
// ---------------------------------------------------------------------------
//
// Registers as an OpenClaw plugin service. On start, resumes any goals that
// were in "running" state when the gateway last stopped. On stop, aborts all
// active loops and persists their state.

import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type { GoalLoopPluginConfig, GoalNotifyConfig, GoalState } from "./types.js";
import { listGoals, readGoal, writeGoal } from "./state.js";
import { getActiveGoalIds, isGoalRunning, runGoalLoop, stopGoalLoop } from "./loop-engine.js";

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
// Approval tracking (channel commands set these)
// ---------------------------------------------------------------------------

type ApprovalResolve = (result: "approved" | "rejected" | "timeout") => void;

const pendingApprovals = new Map<string, ApprovalResolve>();

export function resolveApproval(goalId: string, result: "approved" | "rejected"): boolean {
  const resolve = pendingApprovals.get(goalId);
  if (!resolve) return false;
  pendingApprovals.delete(goalId);
  resolve(result);
  return true;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export type GoalLoopService = {
  id: string;
  start: (ctx: ServiceContext) => void | Promise<void>;
  stop?: (ctx: ServiceContext) => void | Promise<void>;
};

export function createGoalLoopService(params: {
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  coreDeps: CoreDeps;
  pluginConfig: GoalLoopPluginConfig;
  logger: Logger;
  notifyFn: (notify: GoalNotifyConfig, message: string) => Promise<void>;
}): GoalLoopService {
  const { cfg, cliDeps, coreDeps, pluginConfig, logger, notifyFn } = params;

  const loadUsage = () => coreDeps.loadProviderUsageSummary();

  const waitForApproval = (goalId: string): Promise<"approved" | "rejected" | "timeout"> => {
    return new Promise<"approved" | "rejected" | "timeout">((resolve) => {
      const timeoutMs = pluginConfig.approvalTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | null = null;

      pendingApprovals.set(goalId, (result) => {
        if (timer) clearTimeout(timer);
        resolve(result);
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          pendingApprovals.delete(goalId);
          resolve("timeout");
        }, timeoutMs);
      }
    });
  };

  const startGoal = (goal: GoalState): void => {
    if (isGoalRunning(goal.id)) {
      logger.warn(`Goal ${goal.id} is already running`);
      return;
    }

    const activeCount = getActiveGoalIds().length;
    if (activeCount >= pluginConfig.maxConcurrentGoals) {
      logger.warn(
        `Cannot start goal ${goal.id}: max concurrent goals reached (${activeCount}/${pluginConfig.maxConcurrentGoals})`,
      );
      return;
    }

    runGoalLoop({
      goal,
      coreDeps,
      cfg,
      cliDeps,
      pluginConfig,
      logger,
      notifyFn,
      loadUsage,
      waitForApproval,
    }).catch((err) => {
      logger.error(`Goal loop ${goal.id} threw unexpectedly: ${err}`);
    });
  };

  return {
    id: "goal-loop",

    start: async (_ctx: ServiceContext) => {
      if (!pluginConfig.enabled) {
        logger.info("Goal loop plugin disabled");
        return;
      }
      logger.info("Goal loop service starting");

      const goals = listGoals();
      const resumable = goals.filter(
        (g) => g.status === "running" || g.status === "evaluating",
      );
      if (resumable.length > 0) {
        logger.info(`Resuming ${resumable.length} goal(s)`);
        for (const goal of resumable.slice(0, pluginConfig.maxConcurrentGoals)) {
          startGoal(goal);
        }
      }
    },

    stop: async (_ctx: ServiceContext) => {
      logger.info("Goal loop service stopping");
      const activeIds = getActiveGoalIds();
      for (const id of activeIds) {
        stopGoalLoop(id);
        const goal = readGoal(id);
        if (goal && (goal.status === "running" || goal.status === "evaluating")) {
          goal.updatedAtMs = Date.now();
          writeGoal(goal);
        }
      }
      for (const [, resolve] of pendingApprovals) {
        resolve("timeout");
      }
      pendingApprovals.clear();
    },
  };
}

/**
 * Start a goal loop from external callers (CLI, gateway).
 */
export function startGoalFromExternal(params: {
  goal: GoalState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  pluginConfig: GoalLoopPluginConfig;
  logger: Logger;
  notifyFn: (notify: GoalNotifyConfig, message: string) => Promise<void>;
}): void {
  const { goal, coreDeps, cfg, cliDeps, pluginConfig, logger, notifyFn } = params;

  if (isGoalRunning(goal.id)) {
    logger.warn(`Goal ${goal.id} is already running`);
    return;
  }

  const activeCount = getActiveGoalIds().length;
  if (activeCount >= pluginConfig.maxConcurrentGoals) {
    throw new Error(
      `Max concurrent goals reached (${activeCount}/${pluginConfig.maxConcurrentGoals})`,
    );
  }

  const loadUsage = () => coreDeps.loadProviderUsageSummary();

  const waitForApproval = (goalId: string): Promise<"approved" | "rejected" | "timeout"> => {
    return new Promise<"approved" | "rejected" | "timeout">((resolve) => {
      const timeoutMs = pluginConfig.approvalTimeoutMs;
      let timer: ReturnType<typeof setTimeout> | null = null;

      pendingApprovals.set(goalId, (result) => {
        if (timer) clearTimeout(timer);
        resolve(result);
      });

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          pendingApprovals.delete(goalId);
          resolve("timeout");
        }, timeoutMs);
      }
    });
  };

  runGoalLoop({
    goal,
    coreDeps,
    cfg,
    cliDeps,
    pluginConfig,
    logger,
    notifyFn,
    loadUsage,
    waitForApproval,
  }).catch((err) => {
    logger.error(`Goal loop ${goal.id} threw unexpectedly: ${err}`);
  });
}
