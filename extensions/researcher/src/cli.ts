// ---------------------------------------------------------------------------
// Researcher – CLI Subcommands
// ---------------------------------------------------------------------------
//
// Registers `openclaw researcher` with subcommands:
//   start, stop, status, list, view

import type { Command } from "commander";
import crypto from "node:crypto";
import fs from "node:fs";
import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type {
  ResearchBudget,
  ResearcherPluginConfig,
  ResearchNotifyConfig,
  ResearchState,
} from "./types.js";
import { listResearches, readResearch, writeResearch, readRoundLog } from "./state.js";
import { getActiveResearchIds, isResearchRunning, stopResearch } from "./orchestrator.js";
import { startResearchFromExternal } from "./research-service.js";

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

export function registerResearcherCli(params: {
  program: Command;
  cfg: CoreConfig;
  ensureCoreDeps: () => Promise<CoreDeps>;
  ensureCliDeps: () => Promise<CoreCliDeps>;
  pluginConfig: ResearcherPluginConfig;
  logger: Logger;
  createNotifyFn: (
    coreDeps: CoreDeps,
  ) => (notify: ResearchNotifyConfig, message: string) => Promise<void>;
}): void {
  const { program, cfg, ensureCoreDeps, ensureCliDeps, pluginConfig, logger, createNotifyFn } =
    params;

  const root = program
    .command("researcher")
    .description("Research, interview, and PRD generation for goals");

  // -------------------------------------------------------------------------
  // researcher start
  // -------------------------------------------------------------------------
  root
    .command("start")
    .description("Start a new research session")
    .requiredOption("--goal <text>", "Goal description")
    .option(
      "--max-rounds <n>",
      "Max research/interview rounds",
      String(pluginConfig.defaultMaxRounds),
    )
    .option(
      "--max-turns <n>",
      "Agent turn budget",
      "20",
    )
    .option(
      "--max-tokens <n>",
      "Token budget",
      "200000",
    )
    .option(
      "--max-time <duration>",
      "Wall clock limit (e.g. 2h, 30m)",
      "30m",
    )
    .option("--notify-channel <channel>", "Notification channel")
    .option("--notify-to <recipient>", "Notification recipient")
    .option("--notify-account-id <id>", "Notification account ID")
    .action(async (opts) => {
      const researchId = crypto.randomUUID().slice(0, 8);
      const now = Date.now();

      const budget: ResearchBudget = {
        maxAgentTurns: parseInt(opts.maxTurns, 10),
        maxTokens: parseInt(opts.maxTokens, 10),
        maxTimeMs: parseTimeStr(opts.maxTime),
      };

      const notify: ResearchNotifyConfig | null =
        opts.notifyChannel && opts.notifyTo
          ? {
              channel: opts.notifyChannel,
              to: opts.notifyTo,
              accountId: opts.notifyAccountId,
            }
          : null;

      const research: ResearchState = {
        id: researchId,
        originalGoal: opts.goal,
        status: "researching",
        rounds: [],
        currentRound: 0,
        maxRounds: parseInt(opts.maxRounds, 10),
        generatedPrdPath: null,
        launchedPlanId: null,
        notify,
        budget,
        usage: { agentTurns: 0, totalTokens: 0, startedAtMs: 0 },
        stopReason: null,
        createdAtMs: now,
        updatedAtMs: now,
      };

      writeResearch(research);

      try {
        const coreDeps = await ensureCoreDeps();
        const cliDeps = await ensureCliDeps();
        const notifyFn = createNotifyFn(coreDeps);
        startResearchFromExternal({
          research,
          coreDeps,
          cfg,
          cliDeps,
          pluginConfig,
          logger,
          notifyFn,
        });
        console.log(JSON.stringify({ ok: true, researchId, status: "researching" }));
      } catch (err) {
        console.log(
          JSON.stringify({
            ok: false,
            researchId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });

  // -------------------------------------------------------------------------
  // researcher stop
  // -------------------------------------------------------------------------
  root
    .command("stop")
    .description("Stop a running research")
    .argument("<research-id>", "Research ID to stop")
    .action(async (researchId: string) => {
      const research = readResearch(researchId);
      if (!research) {
        console.log(JSON.stringify({ ok: false, error: `Research ${researchId} not found` }));
        return;
      }
      stopResearch(researchId);
      research.status = "stopped";
      research.stopReason = "Manually stopped";
      research.updatedAtMs = Date.now();
      writeResearch(research);
      console.log(JSON.stringify({ ok: true, researchId, status: "stopped" }));
    });

  // -------------------------------------------------------------------------
  // researcher status
  // -------------------------------------------------------------------------
  root
    .command("status")
    .description("Show research status")
    .argument("[research-id]", "Research ID (shows all if omitted)")
    .action(async (researchId?: string) => {
      if (researchId) {
        const research = readResearch(researchId);
        if (!research) {
          console.log(JSON.stringify({ ok: false, error: `Research ${researchId} not found` }));
          return;
        }
        const roundLogs = readRoundLog(researchId);
        console.log(
          JSON.stringify({
            ok: true,
            research,
            roundLogCount: roundLogs.length,
            isRunning: isResearchRunning(researchId),
          }),
        );
      } else {
        const active = getActiveResearchIds();
        const researches = listResearches();
        console.log(
          JSON.stringify({
            ok: true,
            totalResearches: researches.length,
            activeResearchIds: active,
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
          }),
        );
      }
    });

  // -------------------------------------------------------------------------
  // researcher list
  // -------------------------------------------------------------------------
  root
    .command("list")
    .description("List all researches")
    .option("--active", "Only show active researches")
    .action(async (opts) => {
      const researches = listResearches();
      const filtered = opts.active
        ? researches.filter(
            (r) =>
              r.status === "researching" ||
              r.status === "interviewing" ||
              r.status === "synthesizing" ||
              r.status === "ready",
          )
        : researches;
      console.log(
        JSON.stringify({
          ok: true,
          researches: filtered.map((r) => ({
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
        }),
      );
    });

  // -------------------------------------------------------------------------
  // researcher view
  // -------------------------------------------------------------------------
  root
    .command("view")
    .description("Show generated PRD content")
    .argument("<research-id>", "Research ID")
    .action(async (researchId: string) => {
      const research = readResearch(researchId);
      if (!research) {
        console.log(JSON.stringify({ ok: false, error: `Research ${researchId} not found` }));
        return;
      }
      if (!research.generatedPrdPath) {
        console.log(
          JSON.stringify({ ok: false, error: `Research ${researchId} has not generated a PRD yet` }),
        );
        return;
      }
      try {
        const content = fs.readFileSync(research.generatedPrdPath, "utf-8");
        console.log(content);
      } catch (err) {
        console.log(
          JSON.stringify({
            ok: false,
            error: `Failed to read PRD at ${research.generatedPrdPath}: ${err instanceof Error ? err.message : err}`,
          }),
        );
      }
    });
}
