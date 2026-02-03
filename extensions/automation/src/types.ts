// ---------------------------------------------------------------------------
// Automation Types
// ---------------------------------------------------------------------------

export type EventType =
  | "goal.started"
  | "goal.completed"
  | "goal.failed"
  | "goal.stalled"
  | "goal.iteration"
  | "plan.started"
  | "plan.completed"
  | "plan.failed"
  | "plan.task.completed"
  | "plan.task.failed"
  | "research.started"
  | "research.completed"
  | "research.round"
  | "system.error";

export interface AutomationEvent {
  type: EventType;
  timestamp: number;
  data: {
    id: string;
    goal?: string;
    status?: string;
    score?: number;
    duration?: number;
    iteration?: number;
    taskId?: string;
    error?: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: EventType[];
  enabled: boolean;
  secret?: string;
  createdAt: number;
  lastTriggered?: number;
  lastStatus?: number;
}

export interface WebhookPayload {
  event: EventType;
  timestamp: number;
  data: AutomationEvent["data"];
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

export interface ChainTrigger {
  type: "goal" | "plan" | "research";
  id?: string; // specific ID or undefined for any
  event: "completed" | "failed";
  condition?: {
    minScore?: number;
    maxScore?: number;
  };
}

export interface ChainAction {
  type: "goal" | "plan" | "research";
  templateId?: string;
  config?: {
    goal?: string;
    criteria?: string[];
    budget?: {
      maxIterations?: number;
      maxTokens?: number;
      maxTimeMs?: number;
    };
  };
}

export interface Chain {
  id: string;
  name: string;
  description: string;
  trigger: ChainTrigger;
  action: ChainAction;
  enabled: boolean;
  createdAt: number;
  triggeredCount: number;
  lastTriggered?: number;
}

// ---------------------------------------------------------------------------
// Templates (read-only, stored by dashboard)
// ---------------------------------------------------------------------------

export interface Template {
  id: string;
  name: string;
  description: string;
  type: "goal" | "plan" | "research";
  config: {
    goal?: string;
    criteria?: string[];
    budget?: {
      maxIterations?: number;
      maxTokens?: number;
      maxTimeMs?: number;
      evalEvery?: number;
    };
  };
}
