// ---------------------------------------------------------------------------
// Researcher – Research Service (Long-Running)
// ---------------------------------------------------------------------------
//
// Manages research lifecycle: start, resume, stop. Registers as an OpenClaw
// plugin service that resumes active researches on gateway restart.

import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type { ResearcherPluginConfig, ResearchNotifyConfig, ResearchState } from "./types.js";
import {
  getActiveResearchIds,
  isResearchRunning,
  runResearchOrchestrator,
  stopResearch,
} from "./orchestrator.js";
import { listResearches, readResearch, writeResearch } from "./state.js";

// ---------------------------------------------------------------------------
// Gateway broadcast helper using WebSocket client
// ---------------------------------------------------------------------------

type BroadcastQuestionsFn = (params: {
  researchId: string;
  goal: string;
  questions: string[];
  timeoutMs: number;
  notify: ResearchNotifyConfig;
}) => Promise<void>;

// Lazy-loaded gateway client module
let gatewayClientModule: typeof import("openclaw/plugin-sdk") | null = null;

async function loadGatewayClient() {
  if (gatewayClientModule) return gatewayClientModule;
  try {
    gatewayClientModule = await import("openclaw/plugin-sdk");
    return gatewayClientModule;
  } catch {
    return null;
  }
}

type GatewayClientInstance = {
  start: () => void;
  stop: () => void;
  request: (method: string, params: unknown) => Promise<unknown>;
};

let sharedGatewayClient: GatewayClientInstance | null = null;
let gatewayClientStarting = false;

async function getOrCreateGatewayClient(params: {
  gatewayPort?: number;
  gatewayToken?: string;
  logger: Logger;
}): Promise<GatewayClientInstance | null> {
  if (sharedGatewayClient) return sharedGatewayClient;
  if (gatewayClientStarting) {
    // Wait a bit for the client to be created
    await new Promise((r) => setTimeout(r, 100));
    return sharedGatewayClient;
  }

  gatewayClientStarting = true;
  try {
    // Try to import the GatewayClient dynamically
    const { GatewayClient } = await import("../../../src/gateway/client.js");

    const { gatewayPort = 18789, gatewayToken, logger } = params;

    const client = new GatewayClient({
      url: `ws://127.0.0.1:${gatewayPort}`,
      clientName: "researcher-service",
      clientDisplayName: "Researcher Service",
      mode: "backend",
      token: gatewayToken,
      scopes: ["operator.researcher"],
      onHelloOk: () => {
        logger.info("Researcher gateway client connected");
      },
      onConnectError: (err: Error) => {
        logger.warn(`Researcher gateway client connect error: ${err.message}`);
      },
      onClose: (_code: number, _reason: string) => {
        // Silent close
      },
    });

    client.start();
    sharedGatewayClient = client;
    return client;
  } catch (err) {
    params.logger.warn(`Failed to create gateway client: ${err}`);
    return null;
  } finally {
    gatewayClientStarting = false;
  }
}

function createBroadcastQuestionsFn(params: {
  gatewayPort?: number;
  gatewayToken?: string;
  logger: Logger;
}): BroadcastQuestionsFn {
  const { logger, gatewayPort, gatewayToken } = params;

  return async (broadcastParams) => {
    try {
      const client = await getOrCreateGatewayClient({ gatewayPort, gatewayToken, logger });
      if (!client) {
        logger.warn("No gateway client available for broadcasting questions");
        return;
      }

      await client.request("researcher.interview.broadcast", broadcastParams);
    } catch (err) {
      logger.warn(`Broadcast questions failed: ${err}`);
    }
  };
}

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
  gatewayPort?: number;
  gatewayToken?: string;
}): ResearcherService {
  const { cfg, cliDeps, coreDeps, pluginConfig, logger, notifyFn, gatewayPort, gatewayToken } =
    params;

  // Create broadcast function for Discord buttons
  const broadcastQuestionsFn = createBroadcastQuestionsFn({
    gatewayPort,
    gatewayToken,
    logger,
  });

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
      broadcastQuestionsFn,
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
        if (
          research &&
          (research.status === "researching" ||
            research.status === "interviewing" ||
            research.status === "synthesizing")
        ) {
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
  gatewayPort?: number;
  gatewayToken?: string;
}): void {
  const {
    research,
    coreDeps,
    cfg,
    cliDeps,
    pluginConfig,
    logger,
    notifyFn,
    gatewayPort,
    gatewayToken,
  } = params;

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

  // Create broadcast function for Discord buttons
  const broadcastQuestionsFn = createBroadcastQuestionsFn({
    gatewayPort,
    gatewayToken,
    logger,
  });

  runResearchOrchestrator({
    research,
    coreDeps,
    cfg,
    cliDeps,
    pluginConfig,
    logger,
    notifyFn,
    broadcastQuestionsFn,
  }).catch((err) => {
    logger.error(`Research orchestrator ${research.id} threw unexpectedly: ${err}`);
  });
}
