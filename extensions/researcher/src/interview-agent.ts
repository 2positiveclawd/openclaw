// ---------------------------------------------------------------------------
// Researcher – Interview Agent
// ---------------------------------------------------------------------------
//
// Generates targeted clarifying questions for the user based on the current
// research brief and previous Q&A rounds.

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

function formatPreviousQA(rounds: ResearchRound[]): string {
  const withAnswers = rounds.filter((r) => r.answers.length > 0);
  if (withAnswers.length === 0) return "(none)";
  return withAnswers
    .map((r) => {
      const qaPairs = r.questions.map((q, i) => {
        const a = r.answers[i] ?? "(no answer)";
        return `  Q: ${q}\n  A: ${a}`;
      });
      return `### Round ${r.roundNumber}\n${qaPairs.join("\n")}`;
    })
    .join("\n\n");
}

export function buildInterviewPrompt(
  originalGoal: string,
  currentBrief: string,
  previousRounds: ResearchRound[],
): string {
  return `You are an expert product interviewer. Based on the research, generate
targeted clarifying questions for the user.

## Original Goal
${originalGoal}

## Research Brief
${currentBrief}

## Previous Q&A
${formatPreviousQA(previousRounds)}

## Instructions
- Ask 3-5 specific, actionable questions
- Focus on decisions that affect implementation (not vague preferences)
- Each question should have clear options when possible
- Don't re-ask questions already answered
- If research is sufficient and no questions needed, return empty questions array

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "questions": [
    "Do you want single-player only or multiplayer?",
    "Should this be a web app (browser) or mobile (React Native)?",
    "What's your hosting preference: Vercel (free tier), AWS, or self-hosted?"
  ],
  "needsMoreResearch": true,
  "reasoning": "Brief explanation of why these questions matter"
}`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export type ParsedInterviewResponse = {
  questions: string[];
  needsMoreResearch: boolean;
  reasoning: string;
};

export function parseInterviewResponse(text: string): ParsedInterviewResponse | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      questions: Array.isArray(parsed.questions)
        ? (parsed.questions as unknown[]).filter((q): q is string => typeof q === "string")
        : [],
      needsMoreResearch: parsed.needsMoreResearch === true,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run interview agent turn
// ---------------------------------------------------------------------------

export async function runInterviewAgent(params: {
  researchId: string;
  originalGoal: string;
  currentBrief: string;
  previousRounds: ResearchRound[];
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  logger: Logger;
}): Promise<ParsedInterviewResponse | null> {
  const { researchId, originalGoal, currentBrief, previousRounds, coreDeps, cfg, cliDeps, logger } =
    params;
  const startMs = Date.now();

  const prompt = buildInterviewPrompt(originalGoal, currentBrief, previousRounds);

  const job: CoreCronJob = {
    id: `researcher-interview-${researchId}-r${previousRounds.length}`,
    name: `researcher-interview:${researchId}`,
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "at", atMs: Date.now() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: prompt },
    state: {},
  };

  const sessionKey = `researcher-interview:${researchId}`;
  let resultText = "";

  try {
    const result = await coreDeps.runCronIsolatedAgentTurn({
      cfg,
      deps: cliDeps,
      job,
      message: prompt,
      sessionKey,
      agentId: "researcher",
    });

    if (result.status === "error") {
      logger.warn(`Interview agent returned error for ${researchId}: ${result.error}`);
      resultText = result.error ?? "";
    } else {
      resultText = result.outputText ?? result.summary ?? "";
    }
  } catch (err) {
    logger.error(`Interview agent threw for ${researchId}: ${err}`);
    resultText = "";
  }

  const durationMs = Date.now() - startMs;
  const parsed = parseInterviewResponse(resultText);

  appendRoundLog({
    researchId,
    roundNumber: previousRounds.length,
    timestamp: Date.now(),
    phase: "interview",
    data: resultText.slice(0, 5000),
    durationMs,
  });

  if (!parsed) {
    logger.error(
      `Interview agent returned unparseable response for ${researchId}: ${resultText.slice(0, 200)}`,
    );
  }

  return parsed;
}
