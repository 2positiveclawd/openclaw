// ---------------------------------------------------------------------------
// Researcher – Research Service (Long-Running)
// ---------------------------------------------------------------------------
//
// Manages research lifecycle: start, resume, stop. Registers as an OpenClaw
// plugin service that resumes active researches on gateway restart.

import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type { ResearcherPluginConfig, ResearchNotifyConfig, ResearchState } from "./types.js";
import { listResearches, readResearch, writeResearch } from "./state.js";
import {
  getActiveResearchIds,
  isResearchRunning,
  runResearchOrchestrator,
  stopResearch,
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

export type ResearcherService = {
  id: string;
  start: (ctx: ServiceContext) => void | Promise<void>;
  stop?: (ctx: ServiceContext) => void | Promise<void>;
};

export function createResearcherService(params: {
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  coreDeps: CoreDeps;
  pluginConfig: ResearcherPluginConfig;
  logger: Logger;
  notifyFn: (notify: ResearchNotifyConfig, message: string) => Promise<void>;
}): ResearcherService {
  const { cfg, cliDeps, coreDeps, pluginConfig, logger, notifyFn } = params;

  const startResearch = (research: ResearchState): void => {
    if (isResearchRunning(research.id)) {
      logger.warn(`Research ${research.id} is already running`);
      return;
    }

    const activeCount = getActiveResearchIds().length;
    if (activeCount >= pluginConfig.maxConcurrentResearches) {
      logger.warn(
        `Cannot start research ${research.id}: max concurrent researches reached (${activeCount}/${pluginConfig.maxConcurrentResearches})`,
      );
      return;
    }

    runResearchOrchestrator({
      research,
      coreDeps,
      cfg,
      cliDeps,
      pluginConfig,
      logger,
      notifyFn,
    }).catch((err) => {
      logger.error(`Research orchestrator ${research.id} threw unexpectedly: ${err}`);
    });
  };

  return {
    id: "researcher",

    start: async (_ctx: ServiceContext) => {
      if (!pluginConfig.enabled) {
        logger.info("Researcher plugin disabled");
        return;
      }
      logger.info("Researcher service starting");

      const researches = listResearches();
      const resumable = researches.filter(
        (r) => r.status === "researching" || r.status === "synthesizing",
      );
      if (resumable.length > 0) {
        logger.info(`Resuming ${resumable.length} research(es)`);
        for (const research of resumable.slice(0, pluginConfig.maxConcurrentResearches)) {
          startResearch(research);
        }
      }
    },

    stop: async (_ctx: ServiceContext) => {
      logger.info("Researcher service stopping");
      const activeIds = getActiveResearchIds();
      for (const id of activeIds) {
        stopResearch(id);
        const research = readResearch(id);
        if (research && (research.status === "researching" || research.status === "interviewing" || research.status === "synthesizing")) {
          research.updatedAtMs = Date.now();
          writeResearch(research);
        }
      }
    },
  };
}

/**
 * Start a research from external callers (CLI, gateway).
 */
export function startResearchFromExternal(params: {
  research: ResearchState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  pluginConfig: ResearcherPluginConfig;
  logger: Logger;
  notifyFn: (notify: ResearchNotifyConfig, message: string) => Promise<void>;
}): void {
  const { research, coreDeps, cfg, cliDeps, pluginConfig, logger, notifyFn } = params;

  if (isResearchRunning(research.id)) {
    logger.warn(`Research ${research.id} is already running`);
    return;
  }

  const activeCount = getActiveResearchIds().length;
  if (activeCount >= pluginConfig.maxConcurrentResearches) {
    throw new Error(
      `Max concurrent researches reached (${activeCount}/${pluginConfig.maxConcurrentResearches})`,
    );
  }

  runResearchOrchestrator({
    research,
    coreDeps,
    cfg,
    cliDeps,
    pluginConfig,
    logger,
    notifyFn,
  }).catch((err) => {
    logger.error(`Research orchestrator ${research.id} threw unexpectedly: ${err}`);
  });
}
