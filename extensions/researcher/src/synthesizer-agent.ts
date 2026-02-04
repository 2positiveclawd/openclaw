// ---------------------------------------------------------------------------
// Researcher – Synthesizer Agent (PRD Generator)
// ---------------------------------------------------------------------------
//
// Generates a complete Product Requirement Document from accumulated research
// rounds and user interview answers.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function formatAllRounds(rounds: ResearchRound[]): string {
  return rounds
    .map((r) => {
      let section = `### Round ${r.roundNumber}\n**Research:** ${r.researchBrief}`;
      if (r.questions.length > 0 && r.answers.length > 0) {
        const qa = r.questions.map((q, i) => {
          const a = r.answers[i] ?? "(no answer)";
          return `  Q: ${q}\n  A: ${a}`;
        });
        section += `\n**Interview:**\n${qa.join("\n")}`;
      }
      return section;
    })
    .join("\n\n");
}

export function buildSynthesizerPrompt(originalGoal: string, rounds: ResearchRound[]): string {
  return `You are a PRD writer. Generate a complete Product Requirement Document from
the research and user interviews.

## Original Goal
${originalGoal}

## Research Rounds
${formatAllRounds(rounds)}

## PRD Format
Generate a markdown PRD with these sections:
# <Project Title>

## Goal
<One clear sentence>

## Acceptance Criteria
- [ ] Criterion 1 (must be objectively verifiable)
- [ ] Criterion 2
...

## Technical Approach
- Stack: ...
- Architecture: ...

## Constraints
- ...

## Budget Recommendations
- Estimated complexity: <simple|medium|complex>
- Suggested max turns: <number>
- Suggested max time: <duration>

Return ONLY the PRD markdown (no JSON wrapper, no fences).`;
}

// ---------------------------------------------------------------------------
// PRD file writing
// ---------------------------------------------------------------------------

function generatePrdSlug(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function nextPrdNumber(): number {
  const prdsDir = path.join(os.homedir(), ".openclaw", "prds");
  try {
    fs.mkdirSync(prdsDir, { recursive: true });
    const files = fs.readdirSync(prdsDir);
    const numbers = files
      .map((f) => {
        const match = f.match(/^auto-(\d+)-/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter((n) => n > 0);
    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  } catch {
    return 1;
  }
}

export function writePrdFile(goal: string, prdContent: string): string {
  const prdsDir = path.join(os.homedir(), ".openclaw", "prds");
  fs.mkdirSync(prdsDir, { recursive: true });
  const num = nextPrdNumber();
  const slug = generatePrdSlug(goal);
  const filename = `auto-${String(num).padStart(3, "0")}-${slug}.md`;
  const filePath = path.join(prdsDir, filename);
  fs.writeFileSync(filePath, prdContent, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Research brief writing (auto-save for cross-agent knowledge sharing)
// ---------------------------------------------------------------------------

export function writeResearchBrief(params: {
  researchId: string;
  goal: string;
  rounds: ResearchRound[];
  prdPath: string;
}): string {
  const { researchId, goal, rounds, prdPath } = params;
  const briefsDir = path.join(os.homedir(), ".openclaw", "workspace", "memory", "research-briefs");
  fs.mkdirSync(briefsDir, { recursive: true });

  const date = new Date().toISOString().split("T")[0];
  const slug = generatePrdSlug(goal);
  const filename = `${date}-${slug}.md`;
  const filePath = path.join(briefsDir, filename);

  // Extract key findings from research rounds
  const keyFindings = rounds
    .map((r) => {
      // Take first 2-3 sentences from each research brief
      const sentences = r.researchBrief
        .split(/[.!?]+/)
        .filter((s) => s.trim())
        .slice(0, 3);
      return sentences.map((s) => `- ${s.trim()}`).join("\n");
    })
    .join("\n");

  // Extract Q&A summary
  const qaSummary = rounds
    .filter((r) => r.questions.length > 0 && r.answers.length > 0)
    .map((r) => {
      return r.questions
        .map((q, i) => {
          const a = r.answers[i] || "(no answer)";
          return `- **Q:** ${q}\n  **A:** ${a}`;
        })
        .join("\n");
    })
    .join("\n\n");

  const briefContent = `# Research Brief: ${goal}

**Date**: ${date}
**Research ID**: ${researchId}
**Status**: completed

## Key Findings

${keyFindings || "- Research findings extracted from rounds"}

## Interview Summary

${qaSummary || "- No interview questions were needed"}

## Recommendations

See the generated PRD for detailed technical recommendations and acceptance criteria.

## Related Files

- **PRD**: ${prdPath}
- **Research data**: ~/.openclaw/researcher/researches.json (id: ${researchId})
`;

  fs.writeFileSync(filePath, briefContent, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Run synthesizer agent turn
// ---------------------------------------------------------------------------

export async function runSynthesizerAgent(params: {
  researchId: string;
  originalGoal: string;
  rounds: ResearchRound[];
  coreDeps: CoreDeps;
  cfg: CoreConfig;
  cliDeps: CoreCliDeps;
  logger: Logger;
}): Promise<string | null> {
  const { researchId, originalGoal, rounds, coreDeps, cfg, cliDeps, logger } = params;
  const startMs = Date.now();

  const prompt = buildSynthesizerPrompt(originalGoal, rounds);

  const job: CoreCronJob = {
    id: `researcher-synth-${researchId}`,
    name: `researcher-synth:${researchId}`,
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "at", atMs: Date.now() },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: prompt },
    state: {},
  };

  const sessionKey = `researcher-synth:${researchId}`;
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
      logger.warn(`Synthesizer agent returned error for ${researchId}: ${result.error}`);
      resultText = result.error ?? "";
    } else {
      resultText = result.outputText ?? result.summary ?? "";
    }
  } catch (err) {
    logger.error(`Synthesizer agent threw for ${researchId}: ${err}`);
    resultText = "";
  }

  const durationMs = Date.now() - startMs;

  appendRoundLog({
    researchId,
    roundNumber: rounds.length,
    timestamp: Date.now(),
    phase: "interview", // logged as final synthesis phase
    data: resultText.slice(0, 10000),
    durationMs,
  });

  if (!resultText.trim()) {
    logger.error(`Synthesizer agent returned empty response for ${researchId}`);
    return null;
  }

  // Strip markdown fences if the model wrapped the output
  let prd = resultText.trim();
  if (prd.startsWith("```")) {
    const lines = prd.split("\n");
    // Remove first line (```markdown or ```) and last line (```)
    if (lines[lines.length - 1].trim() === "```") {
      lines.pop();
    }
    if (lines[0].startsWith("```")) {
      lines.shift();
    }
    prd = lines.join("\n").trim();
  }

  return prd;
}
