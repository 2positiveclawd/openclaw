// ---------------------------------------------------------------------------
// Researcher – Orchestrator
// ---------------------------------------------------------------------------
//
// Main async loop: research → interview → loop → synthesize → ready → launch.
// Modeled after the planner's runPlanOrchestrator.

import type { CoreCliDeps, CoreConfig, CoreDeps } from "./core-bridge.js";
import type {
  ResearcherPluginConfig,
  ResearchNotifyConfig,
  ResearchRound,
  ResearchState,
} from "./types.js";
import { readResearch, writeResearch } from "./state.js";
import { runResearchAgent } from "./research-agent.js";
import { runInterviewAgent } from "./interview-agent.js";
import { runSynthesizerAgent, writePrdFile } from "./synthesizer-agent.js";

// ---------------------------------------------------------------------------
// Automation (webhooks, chains) - optional, fails silently if not available
// ---------------------------------------------------------------------------

let automationModule: typeof import("../../automation/src/index.js") | null = null;

async function loadAutomation() {
  if (automationModule !== null) return automationModule;
  try {
    automationModule = await import("../../automation/src/index.js");
    return automationModule;
  } catch {
    return null;
  }
}

async function fireAutomationEvent(
  eventFn: (mod: typeof import("../../automation/src/index.js")) => import("../../automation/src/index.js").AutomationEvent
) {
  try {
    const mod = await loadAutomation();
    if (mod) {
      const event = eventFn(mod);
      await mod.fireEvent(event);
    }
  } catch (err) {
    console.error("[researcher] Automation event failed:", err);
  }
}

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type NotifyFn = (notify: ResearchNotifyConfig, message: string) => Promise<void>;

// ---------------------------------------------------------------------------
// Active research tracking
// ---------------------------------------------------------------------------

const activeResearches = new Map<string, AbortController>();

export function getActiveResearchIds(): string[] {
  return [...activeResearches.keys()];
}

export function isResearchRunning(researchId: string): boolean {
  return activeResearches.has(researchId);
}

export function stopResearch(researchId: string): boolean {
  const controller = activeResearches.get(researchId);
  if (!controller) return false;
  controller.abort();
  activeResearches.delete(researchId);
  return true;
}

// ---------------------------------------------------------------------------
// Pending user input (interview answers)
// ---------------------------------------------------------------------------

const pendingInputs = new Map<string, (input: string) => void>();

export function waitForUserInput(
  researchId: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    pendingInputs.set(researchId, (input) => {
      if (timer) clearTimeout(timer);
      pendingInputs.delete(researchId);
      resolve(input);
    });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        pendingInputs.delete(researchId);
        resolve(null);
      }, timeoutMs);
    }
  });
}

export function resolveUserInput(researchId: string, input: string): boolean {
  const resolve = pendingInputs.get(researchId);
  if (!resolve) return false;
  resolve(input);
  return true;
}

export function isWaitingForInput(researchId: string): boolean {
  return pendingInputs.has(researchId);
}

// ---------------------------------------------------------------------------
// Pending "go" signal (ready → launch)
// ---------------------------------------------------------------------------

const pendingGos = new Map<string, (go: boolean) => void>();

export function waitForGo(
  researchId: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    pendingGos.set(researchId, (go) => {
      if (timer) clearTimeout(timer);
      pendingGos.delete(researchId);
      resolve(go);
    });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        pendingGos.delete(researchId);
        resolve(false);
      }, timeoutMs);
    }
  });
}

export function resolveGo(researchId: string): boolean {
  const resolve = pendingGos.get(researchId);
  if (!resolve) return false;
  resolve(true);
  return true;
}

export function isWaitingForGo(researchId: string): boolean {
  return pendingGos.has(researchId);
}

// ---------------------------------------------------------------------------
// Sleep with abort signal
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// ---------------------------------------------------------------------------
// Budget check
// ---------------------------------------------------------------------------

function checkBudget(research: ResearchState): { allowed: boolean; reason?: string } {
  const { usage, budget } = research;
  if (usage.agentTurns >= budget.maxAgentTurns) {
    return {
      allowed: false,
      reason: `Agent turn budget exceeded (${usage.agentTurns}/${budget.maxAgentTurns})`,
    };
  }
  if (usage.startedAtMs > 0 && Date.now() - usage.startedAtMs >= budget.maxTimeMs) {
    return {
      allowed: false,
      reason: `Time budget exceeded`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runResearchOrchestrator(params: {
  research: ResearchState;
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  pluginConfig: ResearcherPluginConfig;
  logger: Logger;
  notifyFn: NotifyFn;
}): Promise<void> {
  const { coreDeps, cfg, cliDeps, pluginConfig, logger, notifyFn } = params;
  let research = params.research;

  if (activeResearches.has(research.id)) {
    logger.warn(`Research ${research.id} orchestrator already active`);
    return;
  }

  const controller = new AbortController();
  activeResearches.set(research.id, controller);

  try {
    await orchestratorBody(research, controller.signal, {
      coreDeps,
      cfg,
      cliDeps,
      pluginConfig,
      logger,
      notifyFn,
    });
  } catch (err) {
    if (!controller.signal.aborted) {
      logger.error(`Research ${research.id} orchestrator failed: ${err}`);
      research = readResearch(research.id) ?? research;
      research.status = "failed";
      research.stopReason = String(err);
      research.updatedAtMs = Date.now();
      writeResearch(research);
      if (research.notify) {
        await notifyFn(
          research.notify,
          `Research FAILED: ${research.originalGoal} [${research.id}] -- ${research.stopReason}`,
        ).catch(() => {});
      }
    }
  } finally {
    activeResearches.delete(research.id);
  }
}

// ---------------------------------------------------------------------------
// Orchestrator body
// ---------------------------------------------------------------------------

async function orchestratorBody(
  initialResearch: ResearchState,
  signal: AbortSignal,
  ctx: {
    coreDeps: CoreDeps;
    cfg: CoreConfig;
    cliDeps: CoreCliDeps;
    pluginConfig: ResearcherPluginConfig;
    logger: Logger;
    notifyFn: NotifyFn;
  },
): Promise<void> {
  let research = initialResearch;

  // Mark started
  research.status = "researching";
  if (research.usage.startedAtMs === 0) {
    research.usage.startedAtMs = Date.now();
  }
  research.updatedAtMs = Date.now();
  writeResearch(research);

  if (research.notify) {
    await ctx.notifyFn(
      research.notify,
      `Researching your goal: ${research.originalGoal} [${research.id}]. I'll ask you some questions shortly.`,
    ).catch(() => {});
  }

  // Fire automation event: research.started
  await fireAutomationEvent((mod) => mod.events.researchStarted(research.id, research.originalGoal));

  // =========================================================================
  // LOOP: research → interview → (repeat)
  // =========================================================================
  while (research.currentRound < research.maxRounds && !signal.aborted) {
    research = readResearch(research.id) ?? research;
    if (research.status === "stopped" || research.status === "failed") {
      ctx.logger.info(`Research ${research.id} no longer active (status: ${research.status})`);
      return;
    }

    // --- Budget check ---
    const budgetCheck = checkBudget(research);
    if (!budgetCheck.allowed) {
      research.status = "stopped";
      research.stopReason = budgetCheck.reason ?? "Budget exceeded";
      research.updatedAtMs = Date.now();
      writeResearch(research);
      ctx.logger.info(`Research ${research.id} stopped: ${research.stopReason}`);
      if (research.notify) {
        await ctx.notifyFn(
          research.notify,
          `Research stopped [${research.id}]: ${research.stopReason}`,
        ).catch(() => {});
      }
      return;
    }

    // -----------------------------------------------------------------
    // PHASE A: RESEARCH
    // -----------------------------------------------------------------
    research.status = "researching";
    research.updatedAtMs = Date.now();
    writeResearch(research);

    ctx.logger.info(`Research ${research.id}: running research agent (round ${research.currentRound})`);
    research.usage.agentTurns++;
    writeResearch(research);

    const researchResult = await runResearchAgent({
      researchId: research.id,
      originalGoal: research.originalGoal,
      previousRounds: research.rounds,
      coreDeps: ctx.coreDeps,
      cfg: ctx.cfg,
      cliDeps: ctx.cliDeps,
      logger: ctx.logger,
    });

    if (signal.aborted) return;

    if (!researchResult) {
      ctx.logger.warn(`Research ${research.id}: research agent returned no result, using fallback`);
    }

    const brief = researchResult?.brief ?? "Research agent did not return a structured brief.";

    // Create round entry
    const round: ResearchRound = {
      roundNumber: research.currentRound,
      researchBrief: brief,
      questions: [],
      answers: [],
      researchedAtMs: Date.now(),
    };

    // -----------------------------------------------------------------
    // PHASE B: INTERVIEW
    // -----------------------------------------------------------------
    ctx.logger.info(`Research ${research.id}: running interview agent (round ${research.currentRound})`);
    research.usage.agentTurns++;
    writeResearch(research);

    const interviewResult = await runInterviewAgent({
      researchId: research.id,
      originalGoal: research.originalGoal,
      currentBrief: brief,
      previousRounds: research.rounds,
      coreDeps: ctx.coreDeps,
      cfg: ctx.cfg,
      cliDeps: ctx.cliDeps,
      logger: ctx.logger,
    });

    if (signal.aborted) return;

    const questions = interviewResult?.questions ?? [];

    if (questions.length === 0) {
      // No questions needed — research is sufficient
      ctx.logger.info(`Research ${research.id}: no questions needed, ending loop`);
      round.questions = [];
      round.answers = [];
      research.rounds.push(round);
      research.currentRound++;
      research.updatedAtMs = Date.now();
      writeResearch(research);
      break;
    }

    round.questions = questions;

    // Store partial round (questions but no answers yet)
    research.rounds.push(round);
    research.currentRound++;
    research.status = "interviewing";
    research.updatedAtMs = Date.now();
    writeResearch(research);

    // Notify user with questions
    const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
    if (research.notify) {
      await ctx.notifyFn(
        research.notify,
        `I have ${questions.length} questions about your project [${research.id}]:\n${questionList}\n\nReply: /research-reply ${research.id} <your answers>`,
      ).catch(() => {});
    }

    // --- Wait for user input ---
    ctx.logger.info(`Research ${research.id}: waiting for user input`);
    const userInput = await waitForUserInput(
      research.id,
      ctx.pluginConfig.interviewTimeoutMs,
    );

    if (signal.aborted) return;

    research = readResearch(research.id) ?? research;
    const currentRound = research.rounds[research.rounds.length - 1];

    if (!userInput) {
      // Timeout
      ctx.logger.warn(`Research ${research.id}: interview timed out`);
      if (currentRound) {
        currentRound.answers = ["(timed out — no response)"];
        currentRound.answeredAtMs = Date.now();
      }
      research.updatedAtMs = Date.now();
      writeResearch(research);

      if (research.notify) {
        await ctx.notifyFn(
          research.notify,
          `Interview timed out for research ${research.id}. Proceeding with available information.`,
        ).catch(() => {});
      }
      break;
    }

    // Store answers
    if (currentRound) {
      currentRound.answers = [userInput];
      currentRound.answeredAtMs = Date.now();
    }
    research.updatedAtMs = Date.now();
    writeResearch(research);

    ctx.logger.info(`Research ${research.id}: received user answers`);

    // Check if more research is needed
    const needsMore = interviewResult?.needsMoreResearch ?? false;
    if (!needsMore) {
      ctx.logger.info(`Research ${research.id}: interview agent says no more research needed`);
      break;
    }

    if (research.notify) {
      await ctx.notifyFn(
        research.notify,
        `Thanks! Doing a deeper dive based on your answers... [${research.id}]`,
      ).catch(() => {});
    }

    await sleep(500, signal);
  }

  if (signal.aborted) return;

  // =========================================================================
  // PHASE: SYNTHESIZE
  // =========================================================================
  research = readResearch(research.id) ?? research;
  research.status = "synthesizing";
  research.updatedAtMs = Date.now();
  writeResearch(research);

  ctx.logger.info(`Research ${research.id}: running synthesizer agent`);
  research.usage.agentTurns++;
  writeResearch(research);

  const prdContent = await runSynthesizerAgent({
    researchId: research.id,
    originalGoal: research.originalGoal,
    rounds: research.rounds,
    coreDeps: ctx.coreDeps,
    cfg: ctx.cfg,
    cliDeps: ctx.cliDeps,
    logger: ctx.logger,
  });

  if (signal.aborted) return;

  if (!prdContent) {
    research = readResearch(research.id) ?? research;
    research.status = "failed";
    research.stopReason = "Synthesizer agent failed to generate PRD";
    research.updatedAtMs = Date.now();
    writeResearch(research);
    if (research.notify) {
      await ctx.notifyFn(
        research.notify,
        `Research FAILED [${research.id}]: Could not generate PRD.`,
      ).catch(() => {});
    }
    return;
  }

  // Write PRD file
  const prdPath = writePrdFile(research.originalGoal, prdContent);
  ctx.logger.info(`Research ${research.id}: PRD written to ${prdPath}`);

  research = readResearch(research.id) ?? research;
  research.generatedPrdPath = prdPath;

  // =========================================================================
  // PHASE: READY
  // =========================================================================
  research.status = "ready";
  research.updatedAtMs = Date.now();
  writeResearch(research);

  if (research.notify) {
    await ctx.notifyFn(
      research.notify,
      `Research complete! PRD saved at ${prdPath} [${research.id}].\nReply: /research-go ${research.id} to start building\nReply: /research-view ${research.id} to review the PRD first`,
    ).catch(() => {});
  }

  // Fire automation event: research.completed
  const duration = Date.now() - (research.usage.startedAtMs || Date.now());
  await fireAutomationEvent((mod) =>
    mod.events.researchCompleted(research.id, research.originalGoal, duration)
  );

  // --- Wait for "go" ---
  ctx.logger.info(`Research ${research.id}: waiting for go signal`);
  const goSignal = await waitForGo(
    research.id,
    ctx.pluginConfig.interviewTimeoutMs,
  );

  if (signal.aborted) return;

  research = readResearch(research.id) ?? research;

  if (!goSignal) {
    ctx.logger.info(`Research ${research.id}: go signal timed out`);
    if (research.notify) {
      await ctx.notifyFn(
        research.notify,
        `Research ${research.id} timed out waiting for /research-go. PRD is still saved at ${research.generatedPrdPath}. You can launch manually with: openclaw-planner start --from-prd ${research.generatedPrdPath}`,
      ).catch(() => {});
    }
    return;
  }

  // =========================================================================
  // PHASE: LAUNCH
  // =========================================================================
  ctx.logger.info(`Research ${research.id}: launching planner`);

  // Build planner start command
  const plannerArgs = [
    "planner", "start",
    "--goal", research.originalGoal,
    "--from-prd", prdPath,
    "--max-turns", String(ctx.pluginConfig.defaultPlannerBudget.maxAgentTurns),
    "--max-tokens", String(ctx.pluginConfig.defaultPlannerBudget.maxTokens),
    "--max-time", String(ctx.pluginConfig.defaultPlannerBudget.maxTimeMs) + "ms",
    "--concurrency", String(ctx.pluginConfig.defaultPlannerBudget.maxConcurrency),
  ];

  if (research.notify) {
    plannerArgs.push("--notify-channel", research.notify.channel);
    plannerArgs.push("--notify-to", research.notify.to);
    if (research.notify.accountId) {
      plannerArgs.push("--notify-account-id", research.notify.accountId);
    }
  }

  // Execute planner via subprocess
  const { execFileSync } = await import("node:child_process");
  try {
    const output = execFileSync(
      "node",
      ["/home/azureuser/openclaw/openclaw.mjs", ...plannerArgs],
      { encoding: "utf-8", timeout: 30_000 },
    );

    let planId: string | null = null;
    try {
      const parsed = JSON.parse(output.trim());
      planId = parsed.planId ?? null;
    } catch {
      // try to extract planId from output
      const match = output.match(/"planId"\s*:\s*"([^"]+)"/);
      planId = match ? match[1] : null;
    }

    research = readResearch(research.id) ?? research;
    research.status = "launched";
    research.launchedPlanId = planId;
    research.updatedAtMs = Date.now();
    writeResearch(research);

    ctx.logger.info(`Research ${research.id}: plan ${planId} launched`);

    if (research.notify) {
      await ctx.notifyFn(
        research.notify,
        `Plan ${planId ?? "(unknown)"} started from your research [${research.id}]! I'll update you on progress.`,
      ).catch(() => {});
    }
  } catch (err) {
    ctx.logger.error(`Research ${research.id}: failed to launch planner: ${err}`);
    research = readResearch(research.id) ?? research;
    research.status = "failed";
    research.stopReason = `Failed to launch planner: ${err instanceof Error ? err.message : String(err)}`;
    research.updatedAtMs = Date.now();
    writeResearch(research);

    if (research.notify) {
      await ctx.notifyFn(
        research.notify,
        `Research FAILED [${research.id}]: Could not launch planner. PRD is saved at ${research.generatedPrdPath}. You can launch manually.`,
      ).catch(() => {});
    }
  }
}
