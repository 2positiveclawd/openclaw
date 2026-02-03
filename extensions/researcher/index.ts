// ---------------------------------------------------------------------------
// Researcher Plugin – Entry Point
// ---------------------------------------------------------------------------
//
// Registers:
//   - Service: research orchestrator manager (start/stop, resume on restart)
//   - CLI: `openclaw researcher` subcommands
//   - Gateway RPC: `researcher.status`
//   - HTTP route: GET /researcher/status
//   - Channel commands: /research-reply, /research-go, /research-stop,
//     /research-view, /research-status

import type { ResearcherPluginConfig, ResearchNotifyConfig } from "./src/types.js";
import type { CoreDeps, CoreCliDeps } from "./src/core-bridge.js";
import { loadCoreDeps } from "./src/core-bridge.js";
import { listResearches, readResearch, writeResearch, readRoundLog } from "./src/state.js";
import {
  getActiveResearchIds,
  isResearchRunning,
  resolveUserInput,
  isWaitingForInput,
  resolveGo,
  isWaitingForGo,
  stopResearch,
} from "./src/orchestrator.js";
import { createResearcherService } from "./src/research-service.js";
import { registerResearcherCli } from "./src/cli.js";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Plugin config defaults
// ---------------------------------------------------------------------------

function resolvePluginConfig(raw?: Record<string, unknown>): ResearcherPluginConfig {
  const plannerBudget = raw?.defaultPlannerBudget as Record<string, unknown> | undefined;
  return {
    enabled: raw?.enabled !== false,
    maxConcurrentResearches: asInt(raw?.maxConcurrentResearches, 2),
    defaultMaxRounds: asInt(raw?.defaultMaxRounds, 3),
    interviewTimeoutMs: asInt(raw?.interviewTimeoutMs, 1_800_000), // 30 min
    defaultPlannerBudget: {
      maxAgentTurns: asInt(plannerBudget?.maxAgentTurns, 50),
      maxTokens: asInt(plannerBudget?.maxTokens, 500_000),
      maxTimeMs: asInt(plannerBudget?.maxTimeMs, 3_600_000),
      maxConcurrency: asInt(plannerBudget?.maxConcurrency, 3),
    },
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
): (notify: ResearchNotifyConfig, message: string) => Promise<void> {
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

const researcherPlugin = {
  id: "researcher",
  name: "Researcher",
  description:
    "Research, interview, and PRD generation — turns vague goals into structured plans",
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
      id: "researcher",
      start: async (ctx: unknown) => {
        if (!pluginConfig.enabled) {
          logger.info("Researcher plugin disabled");
          return;
        }
        try {
          const coreDeps = await ensureCoreDeps();
          const cliDeps = await ensureCliDeps();
          const notifyFn = createNotifyFn(coreDeps, api.config, logger);
          const service = createResearcherService({
            cfg: api.config,
            cliDeps,
            coreDeps,
            pluginConfig,
            logger,
            notifyFn,
          });
          await service.start(ctx as Parameters<typeof service.start>[0]);
        } catch (err) {
          logger.error(`Researcher service failed to start: ${err}`);
        }
      },
      stop: async (ctx: unknown) => {
        try {
          const coreDeps = await ensureCoreDeps();
          const cliDeps = await ensureCliDeps();
          const notifyFn = createNotifyFn(coreDeps, api.config, logger);
          const service = createResearcherService({
            cfg: api.config,
            cliDeps,
            coreDeps,
            pluginConfig,
            logger,
            notifyFn,
          });
          await service.stop?.(ctx as Parameters<typeof service.start>[0]);
        } catch (err) {
          logger.error(`Researcher service failed to stop: ${err}`);
        }
      },
    });

    // -------------------------------------------------------------------
    // 2. Register CLI
    // -------------------------------------------------------------------
    api.registerCli(
      ({ program }) => {
        registerResearcherCli({
          program,
          cfg: api.config,
          ensureCoreDeps,
          ensureCliDeps,
          pluginConfig,
          logger,
          createNotifyFn: (coreDeps) => createNotifyFn(coreDeps, api.config, logger),
        });
      },
      { commands: ["researcher"] },
    );

    // -------------------------------------------------------------------
    // 3. Register gateway RPC method
    // -------------------------------------------------------------------
    api.registerGatewayMethod("researcher.status", async ({ params, respond }) => {
      try {
        const researchId =
          typeof params.researchId === "string" ? params.researchId : undefined;
        if (researchId) {
          const research = readResearch(researchId);
          if (!research) {
            respond(false, { error: `Research ${researchId} not found` });
            return;
          }
          respond(true, {
            research,
            roundLogs: readRoundLog(researchId),
            isRunning: isResearchRunning(researchId),
          });
        } else {
          const researches = listResearches();
          respond(true, {
            totalResearches: researches.length,
            activeResearchIds: getActiveResearchIds(),
            researches: researches.map((r) => ({
              id: r.id,
              goal: r.originalGoal,
              status: r.status,
              rounds: r.rounds.length,
              maxRounds: r.maxRounds,
              agentTurns: r.usage.agentTurns,
              prdPath: r.generatedPrdPath,
              planId: r.launchedPlanId,
              isRunning: isResearchRunning(r.id),
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
      path: "/researcher/status",
      handler: async (_req, res) => {
        const researches = listResearches();
        const payload = {
          totalResearches: researches.length,
          activeResearchIds: getActiveResearchIds(),
          researches: researches.map((r) => ({
            id: r.id,
            goal: r.originalGoal,
            status: r.status,
            rounds: r.rounds.length,
            maxRounds: r.maxRounds,
            agentTurns: r.usage.agentTurns,
            prdPath: r.generatedPrdPath,
            planId: r.launchedPlanId,
            isRunning: isResearchRunning(r.id),
            stopReason: r.stopReason,
          })),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      },
    });

    // -------------------------------------------------------------------
    // 5. Channel commands
    // -------------------------------------------------------------------

    // /research-reply <id> <answers>
    api.registerCommand({
      name: "research-reply",
      description: "Reply to research interview questions",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const args = ctx.args?.trim() ?? "";
        const spaceIdx = args.indexOf(" ");
        if (spaceIdx < 0) {
          return { text: "Usage: /research-reply <id> <your answers>" };
        }
        const id = args.slice(0, spaceIdx);
        const input = args.slice(spaceIdx + 1).trim();

        if (!input) {
          return { text: "Please include your answers after the research ID." };
        }

        const resolved = resolveUserInput(id, input);
        if (resolved) {
          return { text: "Got it, processing your answers..." };
        }

        // Check if research exists but isn't waiting
        const research = readResearch(id);
        if (!research) {
          return { text: `Research ${id} not found.` };
        }
        if (research.status !== "interviewing") {
          return { text: `Research ${id} is not waiting for input (status: ${research.status}).` };
        }
        return { text: `Research ${id} is not currently waiting for a reply.` };
      },
    });

    // /research-go <id>
    api.registerCommand({
      name: "research-go",
      description: "Launch the plan from a generated PRD",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const id = ctx.args?.trim();
        if (!id) {
          return { text: "Usage: /research-go <id>" };
        }

        const resolved = resolveGo(id);
        if (resolved) {
          return { text: `Launching plan from research ${id}...` };
        }

        const research = readResearch(id);
        if (!research) {
          return { text: `Research ${id} not found.` };
        }
        if (research.status === "launched") {
          return { text: `Research ${id} already launched plan ${research.launchedPlanId}.` };
        }
        if (research.status !== "ready") {
          return { text: `Research ${id} is not ready to launch (status: ${research.status}).` };
        }
        return { text: `Research ${id} is not currently waiting for a go signal.` };
      },
    });

    // /research-stop <id>
    api.registerCommand({
      name: "research-stop",
      description: "Stop a running research",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const id = ctx.args?.trim();
        if (!id) {
          return { text: "Usage: /research-stop <id>" };
        }

        const research = readResearch(id);
        if (!research) {
          return { text: `Research ${id} not found.` };
        }

        stopResearch(id);
        research.status = "stopped";
        research.stopReason = "Manually stopped via Discord";
        research.updatedAtMs = Date.now();
        writeResearch(research);

        return { text: `Research ${id} stopped.` };
      },
    });

    // /research-view <id>
    api.registerCommand({
      name: "research-view",
      description: "View the generated PRD",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const id = ctx.args?.trim();
        if (!id) {
          return { text: "Usage: /research-view <id>" };
        }

        const research = readResearch(id);
        if (!research) {
          return { text: `Research ${id} not found.` };
        }
        if (!research.generatedPrdPath) {
          return { text: `Research ${id} has not generated a PRD yet (status: ${research.status}).` };
        }

        try {
          const content = fs.readFileSync(research.generatedPrdPath, "utf-8");
          // Truncate for Discord if too long
          if (content.length > 1800) {
            return { text: content.slice(0, 1800) + "\n\n...(truncated)" };
          }
          return { text: content };
        } catch (err) {
          return { text: `Failed to read PRD: ${err instanceof Error ? err.message : err}` };
        }
      },
    });

    // /research-status [id]
    api.registerCommand({
      name: "research-status",
      description: "Show research status",
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const id = ctx.args?.trim();
        if (id) {
          const research = readResearch(id);
          if (!research) {
            return { text: `Research ${id} not found.` };
          }
          const lines = [
            `Research: ${research.originalGoal}`,
            `Status: ${research.status}${isResearchRunning(research.id) ? " (active)" : ""}`,
            `Rounds: ${research.rounds.length}/${research.maxRounds}`,
            `Turns: ${research.usage.agentTurns}/${research.budget.maxAgentTurns}`,
          ];
          if (research.generatedPrdPath) {
            lines.push(`PRD: ${research.generatedPrdPath}`);
          }
          if (research.launchedPlanId) {
            lines.push(`Plan: ${research.launchedPlanId}`);
          }
          if (research.stopReason) {
            lines.push(`Stop reason: ${research.stopReason}`);
          }
          return { text: lines.join("\n") };
        }
        const researches = listResearches();
        if (researches.length === 0) {
          return { text: "No researches." };
        }
        const lines = researches.map((r) => {
          return `[${r.id}] ${r.status}${isResearchRunning(r.id) ? "*" : ""} — ${r.rounds.length}/${r.maxRounds} rounds — ${r.originalGoal.slice(0, 60)}`;
        });
        return { text: lines.join("\n") };
      },
    });
  },
};

export default researcherPlugin;
