// ---------------------------------------------------------------------------
// Planner – Core Bridge
// ---------------------------------------------------------------------------
//
// Imports from openclaw/extension-bridge for extension-to-core communication.

import {
  runCronIsolatedAgentTurn,
  loadProviderUsageSummary,
  deliverOutboundPayloads,
  createDefaultDeps,
  type RunCronAgentTurnResult,
  type OutboundDeliveryResult,
  type CliDeps,
} from "openclaw/extension-bridge";

// ---------------------------------------------------------------------------
// Re-export types for extension use
// ---------------------------------------------------------------------------

export type CoreConfig = Record<string, unknown>;

export type CoreCronJob = {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: "at"; atMs: number };
  sessionTarget: "isolated";
  wakeMode: "now";
  payload: { kind: "agentTurn"; message: string };
  isolation?: Record<string, unknown>;
  state: Record<string, unknown>;
};

export type CoreRunCronAgentTurnResult = RunCronAgentTurnResult;

export type CoreUsageSummary = {
  updatedAt: number;
  providers: Array<{
    provider: string;
    displayName: string;
    windows: Array<{ label: string; usedPercent: number; resetAt?: number }>;
    error?: string;
  }>;
};

export type CoreOutboundDeliveryResult = OutboundDeliveryResult;

export type CoreCliDeps = CliDeps;

// ---------------------------------------------------------------------------
// Core deps interface
// ---------------------------------------------------------------------------

export type CoreDeps = {
  runCronIsolatedAgentTurn: typeof runCronIsolatedAgentTurn;
  loadProviderUsageSummary: typeof loadProviderUsageSummary;
  deliverOutboundPayloads: typeof deliverOutboundPayloads;
  createDefaultDeps: typeof createDefaultDeps;
};

// ---------------------------------------------------------------------------
// Load core deps (now synchronous since we use static imports)
// ---------------------------------------------------------------------------

const coreDeps: CoreDeps = {
  runCronIsolatedAgentTurn,
  loadProviderUsageSummary,
  deliverOutboundPayloads,
  createDefaultDeps,
};

export async function loadCoreDeps(): Promise<CoreDeps> {
  return coreDeps;
}
