// ---------------------------------------------------------------------------
// Researcher – Type Definitions
// ---------------------------------------------------------------------------

/** Possible phases of a research session. */
export type ResearchPhase =
  | "researching"    // Agent doing research
  | "interviewing"   // Waiting for user answers
  | "synthesizing"   // Generating PRD
  | "ready"          // PRD generated, awaiting user "go"
  | "launched"       // Planner started
  | "stopped"        // Manually stopped
  | "failed";        // Error

/** A single research↔interview round. */
export type ResearchRound = {
  roundNumber: number;
  researchBrief: string;
  questions: string[];
  answers: string[];
  researchedAtMs: number;
  answeredAtMs?: number;
};

/** Notification configuration. */
export type ResearchNotifyConfig = {
  channel: string;
  to: string;
  accountId?: string;
};

/** Budget limits for the research session. */
export type ResearchBudget = {
  maxAgentTurns: number;
  maxTokens: number;
  maxTimeMs: number;
};

/** Cumulative resource usage. */
export type ResearchUsage = {
  agentTurns: number;
  totalTokens: number;
  startedAtMs: number;
};

/** Full state of a research session. */
export type ResearchState = {
  id: string;
  originalGoal: string;
  status: ResearchPhase;
  rounds: ResearchRound[];
  currentRound: number;
  maxRounds: number;
  generatedPrdPath: string | null;
  launchedPlanId: string | null;
  notify: ResearchNotifyConfig | null;
  budget: ResearchBudget;
  usage: ResearchUsage;
  stopReason: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

/** Plugin-level configuration (parsed from pluginConfig). */
export type ResearcherPluginConfig = {
  enabled: boolean;
  maxConcurrentResearches: number;
  defaultMaxRounds: number;
  interviewTimeoutMs: number;
  defaultPlannerBudget: {
    maxAgentTurns: number;
    maxTokens: number;
    maxTimeMs: number;
    maxConcurrency: number;
  };
};

/** Stored researches file format. */
export type ResearchStoreFile = {
  version: 1;
  researches: Record<string, ResearchState>;
};

/** Record appended to per-research rounds JSONL. */
export type ResearchRoundRecord = {
  researchId: string;
  roundNumber: number;
  timestamp: number;
  phase: "research" | "interview" | "answers";
  data: string;
  durationMs?: number;
};
