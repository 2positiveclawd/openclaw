// ---------------------------------------------------------------------------
// Goal Loop – Type Definitions
// ---------------------------------------------------------------------------

/** Possible states in the goal state machine. */
export type GoalStatus =
  | "pending"
  | "running"
  | "evaluating"
  | "paused"
  | "completed"
  | "budget_exceeded"
  | "stopped"
  | "failed";

/** Budget limits for a single goal. */
export type GoalBudget = {
  /** Maximum number of agent iterations. */
  maxIterations: number;
  /** Maximum total tokens (input + output) across all iterations. */
  maxTokens: number;
  /** Maximum wall-clock time in milliseconds. */
  maxTimeMs: number;
  /** Provider usage threshold (percentage, 0-100). */
  providerUsageThreshold: number;
};

/** Configuration for the progress evaluator. */
export type GoalEvalConfig = {
  /** Run evaluator every N iterations. */
  evalEvery: number;
  /** Model reference for evaluator (alias or provider/model). Null = use agent model. */
  evalModel: string | null;
  /** Number of consecutive flat evaluations before stall detection fires. */
  stallThreshold: number;
  /** Minimum progress delta between evaluations to avoid stall. */
  minProgressDelta: number;
  /** Consecutive error limit before circuit breaker trips. */
  consecutiveErrorLimit: number;
};

/** Notification configuration for a goal. */
export type GoalNotifyConfig = {
  /** Channel to send notifications through (telegram, discord, etc.). */
  channel: string;
  /** Recipient identifier. */
  to: string;
  /** Account ID for channel (if needed). */
  accountId?: string;
};

/** Quality gate definition. */
export type GoalQualityGate = {
  /** Iteration number at which to trigger the gate. */
  atIteration: number;
};

/** Cumulative resource usage across all iterations. */
export type GoalCumulativeUsage = {
  iterations: number;
  totalTokens: number;
  errors: number;
  consecutiveErrors: number;
  startedAtMs: number;
};

/** A single evaluation result from the progress evaluator. */
export type GoalEvaluationResult = {
  progressScore: number;
  assessment: string;
  criteriaStatus: Array<{ criterion: string; met: boolean; notes?: string }>;
  shouldContinue: boolean;
  suggestedNextAction?: string;
};

/** Full state of a goal. */
export type GoalState = {
  id: string;
  goal: string;
  criteria: string[];
  status: GoalStatus;
  budget: GoalBudget;
  evalConfig: GoalEvalConfig;
  notify: GoalNotifyConfig | null;
  qualityGates: GoalQualityGate[];
  usage: GoalCumulativeUsage;
  /** Agent ID used for iterations. */
  agentId?: string;
  /** Last evaluation result. */
  lastEvaluation: GoalEvaluationResult | null;
  /** Last evaluator suggested next action. */
  lastSuggestedAction: string | null;
  /** History of progress scores from evaluations (for stall detection). */
  evaluationScores: number[];
  /** Why the goal stopped/failed. */
  stopReason: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

/** Record appended to the per-goal iterations JSONL log. */
export type GoalIterationRecord = {
  goalId: string;
  iteration: number;
  timestamp: number;
  status: "ok" | "error" | "skipped";
  summary?: string;
  outputText?: string;
  error?: string;
  durationMs: number;
};

/** Record appended to the per-goal evaluations JSONL log. */
export type GoalEvaluationRecord = {
  goalId: string;
  iteration: number;
  timestamp: number;
  result: GoalEvaluationResult;
  durationMs: number;
};

/** Plugin-level configuration (parsed from pluginConfig). */
export type GoalLoopPluginConfig = {
  enabled: boolean;
  maxConcurrentGoals: number;
  defaultEvalModel: string | null;
  defaultBudgetIterations: number;
  defaultBudgetTokens: number;
  defaultBudgetTimeMs: number;
  defaultEvalEvery: number;
  defaultStallThreshold: number;
  defaultProviderUsageThreshold: number;
  approvalTimeoutMs: number;
  approvalTimeoutAction: "auto-approve" | "auto-reject";
};

/** Result of a governance check. */
export type GovernanceCheckResult = {
  allowed: boolean;
  reason?: string;
  /** Warning message (budget nearing limit, etc.). */
  warning?: string;
};

/** Stored goals file format. */
export type GoalStoreFile = {
  version: 1;
  goals: Record<string, GoalState>;
};
