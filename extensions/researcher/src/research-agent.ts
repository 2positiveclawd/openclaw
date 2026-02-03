// ---------------------------------------------------------------------------
// Researcher – Research Agent
// ---------------------------------------------------------------------------
//
// Builds a prompt for the research LLM that investigates a goal: prior art,
// tech options, constraints, and unknowns. Parses the JSON response.

import type { CoreCliDeps, CoreConfig, CoreCronJob, CoreDeps } from "./core-bridge.js";
import type { ResearchRound } from "./types.js";
import { appendRoundLog } from "./state.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function formatPreviousRounds(rounds: ResearchRound[]): string {
  if (rounds.length === 0) return "(none)";
  return rounds
    .map((r) => {
      let section = `### Round ${r.roundNumber}\n**Research Brief:** ${r.researchBrief}`;
      if (r.questions.length > 0) {
        section += `\n**Questions Asked:**\n${r.questions.map((q, i) => `  ${i + 1}. ${q}`).join("\n")}`;
      }
      if (r.answers.length > 0) {
        section += `\n**User Answers:**\n${r.answers.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}`;
      }
      return section;
    })
    .join("\n\n");
}

export function buildResearchPrompt(
  originalGoal: string,
  previousRounds: ResearchRound[],
): string {
  return `You are a research analyst. Investigate this goal and produce a structured brief.

## Goal
${originalGoal}

## Previous Research & User Answers
${formatPreviousRounds(previousRounds)}

## Instructions
- Identify similar existing projects, products, or solutions
- Analyze viable tech stacks and frameworks
- Note constraints (hosting, cost, time, skillset)
- Identify risks and unknowns that need user clarification
- Consider the user's implicit requirements
- If previous rounds exist, build on them — don't repeat what's already known

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "brief": "Structured research findings as a paragraph...",
  "keyFindings": ["finding 1", "finding 2"],
  "techOptions": [{"name": "...", "pros": "...", "cons": "..."}],
  "risksAndUnknowns": ["risk 1", "unknown 2"],
  "needsUserInput": true
}`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export type ParsedResearchResponse = {
  brief: string;
  keyFindings: string[];
  techOptions: Array<{ name: string; pros: string; cons: string }>;
  risksAndUnknowns: string[];
  needsUserInput: boolean;
};

export function parseResearchResponse(text: string): ParsedResearchResponse | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.brief !== "string") return null;

    return {
      brief: parsed.brief,
      keyFindings: Array.isArray(parsed.keyFindings)
        ? (parsed.keyFindings as unknown[]).filter((f): f is string => typeof f === "string")
        : [],
      techOptions: Array.isArray(parsed.techOptions)
        ? (parsed.techOptions as unknown[])
            .filter(
              (t): t is Record<string, unknown> =>
                typeof t === "object" && t !== null && typeof (t as Record<string, unknown>).name === "string",
            )
            .map((t) => ({
              name: String(t.name),
              pros: typeof t.pros === "string" ? t.pros : "",
              cons: typeof t.cons === "string" ? t.cons : "",
            }))
        : [],
      risksAndUnknowns: Array.isArray(parsed.risksAndUnknowns)
        ? (parsed.risksAndUnknowns as unknown[]).filter((r): r is string => typeof r === "string")
        : [],
      needsUserInput: parsed.needsUserInput === true,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run research agent turn
// ---------------------------------------------------------------------------

export async function runResearchAgent(params: {
  researchId: string;
  originalGoal: string;
  previousRounds: ResearchRound[];
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  logger: Logger;
}): Promise<ParsedResearchResponse | null> {
  const { researchId, originalGoal, previousRounds, coreDeps, cfg, cliDeps, logger } =
    params;
  const startMs = Date.now();

  const prompt = buildResearchPrompt(originalGoal, previousRounds);

  const job: CoreCronJob = {
    id: `researcher-research-${researchId}-r${previousRounds.length}`,
    name: `researcher:${researchId}`,
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "at", atMs: Date.now() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: prompt },
    state: {},
  };

  const sessionKey = `researcher:${researchId}`;
  let resultText = "";

  try {
    const result = await coreDeps.runCronIsolatedAgentTurn({
      cfg,
      deps: cliDeps,
      job,
      message: prompt,
      sessionKey,
    });

    if (result.status === "error") {
      logger.warn(`Research agent returned error for ${researchId}: ${result.error}`);
      resultText = result.error ?? "";
    } else {
      resultText = result.outputText ?? result.summary ?? "";
    }
  } catch (err) {
    logger.error(`Research agent threw for ${researchId}: ${err}`);
    resultText = "";
  }

  const durationMs = Date.now() - startMs;
  const parsed = parseResearchResponse(resultText);

  appendRoundLog({
    researchId,
    roundNumber: previousRounds.length,
    timestamp: Date.now(),
    phase: "research",
    data: resultText.slice(0, 5000),
    durationMs,
  });

  if (!parsed) {
    logger.error(
      `Research agent returned unparseable response for ${researchId}: ${resultText.slice(0, 200)}`,
    );
  }

  return parsed;
}
