// ---------------------------------------------------------------------------
// Planner – Type Definitions
// ---------------------------------------------------------------------------

/** Possible states for a plan. */
export type PlanStatus = "pending" | "planning" | "running" | "completed" | "failed" | "stopped";

/** Possible states for a task within a plan. */
export type TaskStatus = "pending" | "ready" | "running" | "completed" | "failed" | "skipped";

/** Result of a single task execution. */
export type TaskResult = {
  status: "ok" | "error";
  summary?: string;
  outputText?: string;
  error?: string;
  tokenUsage?: { input: number; output: number; total: number };
};

/** A single unit of work in the DAG. */
export type PlanTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  group?: string;
  result?: TaskResult;
  retries: number;
  maxRetries: number;
  startedAtMs?: number;
  completedAtMs?: number;
};

/** Budget limits for a plan. */
export type PlanBudget = {
  /** Total agent turns across all tasks + planning. */
  maxAgentTurns: number;
  /** Total token budget. */
  maxTokens: number;
  /** Wall clock limit in milliseconds. */
  maxTimeMs: number;
  /** Per-task retry limit. */
  maxRetries: number;
  /** Maximum parallel workers. */
  maxConcurrency: number;
  /** Re-plan if failure rate exceeds this percentage. */
  replanThreshold: number;
};

/** Cumulative resource usage. */
export type PlanUsage = {
  agentTurns: number;
  totalTokens: number;
  errors: number;
  startedAtMs: number;
};

/** Notification configuration. */
export type PlanNotifyConfig = {
  channel: string;
  to: string;
  accountId?: string;
};

/** Final evaluation result. */
export type EvaluationResult = {
  score: number;
  assessment: string;
  criteriaStatus: Array<{ criterion: string; met: boolean; notes?: string }>;
  suggestions?: string;
};

/** Current phase of orchestration. */
export type PlanPhase = "planning" | "executing" | "replanning" | "evaluating" | "done";

/** Full state of a plan. */
export type PlanState = {
  id: string;
  goal: string;
  criteria: string[];
  status: PlanStatus;
  tasks: PlanTask[];
  budget: PlanBudget;
  usage: PlanUsage;
  notify: PlanNotifyConfig | null;
  currentPhase: PlanPhase;
  planRevision: number;
  finalEvaluation: EvaluationResult | null;
  stopReason: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

/** Plugin-level configuration (parsed from pluginConfig). */
export type PlannerPluginConfig = {
  enabled: boolean;
  maxConcurrentPlans: number;
  defaultMaxAgentTurns: number;
  defaultMaxTokens: number;
  defaultMaxTimeMs: number;
  defaultMaxConcurrency: number;
  defaultMaxRetries: number;
  defaultReplanThreshold: number;
};

/** Stored plans file format. */
export type PlanStoreFile = {
  version: 1;
  plans: Record<string, PlanState>;
};

/** Result of a governance check. */
export type GovernanceCheckResult = {
  allowed: boolean;
  reason?: string;
  warning?: string;
};

/** Aggregate governance result. */
export type GovernanceResult = {
  allowed: boolean;
  reason?: string;
  warnings: string[];
};

/** Record appended to per-plan worker runs JSONL. */
export type WorkerRunRecord = {
  planId: string;
  taskId: string;
  timestamp: number;
  status: "ok" | "error";
  summary?: string;
  outputText?: string;
  error?: string;
  durationMs: number;
};

/** Record appended to per-plan task state changes JSONL. */
export type TaskStateRecord = {
  planId: string;
  taskId: string;
  timestamp: number;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  reason?: string;
};

/** Record appended to per-plan evaluations JSONL. */
export type PlanEvaluationRecord = {
  planId: string;
  timestamp: number;
  phase: "planning" | "replanning" | "final";
  result?: EvaluationResult;
  taskCount?: number;
  durationMs: number;
};
