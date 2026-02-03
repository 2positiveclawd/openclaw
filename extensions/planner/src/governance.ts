// ---------------------------------------------------------------------------
// Planner – Governance Checks
// ---------------------------------------------------------------------------
//
// Budget checks before each batch of worker dispatches.

import type { PlanState, GovernanceCheckResult, GovernanceResult } from "./types.js";

const BUDGET_WARNING_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

export function checkAgentTurnBudget(plan: PlanState): GovernanceCheckResult {
  const { usage, budget } = plan;
  if (usage.agentTurns >= budget.maxAgentTurns) {
    return {
      allowed: false,
      reason: `Agent turn budget exceeded (${usage.agentTurns}/${budget.maxAgentTurns})`,
    };
  }
  const ratio = usage.agentTurns / budget.maxAgentTurns;
  if (ratio >= BUDGET_WARNING_THRESHOLD) {
    return {
      allowed: true,
      warning: `Agent turn budget at ${Math.round(ratio * 100)}% (${usage.agentTurns}/${budget.maxAgentTurns})`,
    };
  }
  return { allowed: true };
}

export function checkTokenBudget(plan: PlanState): GovernanceCheckResult {
  const { usage, budget } = plan;
  if (usage.totalTokens >= budget.maxTokens) {
    return {
      allowed: false,
      reason: `Token budget exceeded (${usage.totalTokens}/${budget.maxTokens})`,
    };
  }
  const ratio = usage.totalTokens / budget.maxTokens;
  if (ratio >= BUDGET_WARNING_THRESHOLD) {
    return {
      allowed: true,
      warning: `Token budget at ${Math.round(ratio * 100)}% (${usage.totalTokens}/${budget.maxTokens})`,
    };
  }
  return { allowed: true };
}

export function checkTimeBudget(plan: PlanState): GovernanceCheckResult {
  const { usage, budget } = plan;
  if (usage.startedAtMs === 0) return { allowed: true };
  const elapsed = Date.now() - usage.startedAtMs;
  if (elapsed >= budget.maxTimeMs) {
    return {
      allowed: false,
      reason: `Time budget exceeded (${formatDuration(elapsed)}/${formatDuration(budget.maxTimeMs)})`,
    };
  }
  const ratio = elapsed / budget.maxTimeMs;
  if (ratio >= BUDGET_WARNING_THRESHOLD) {
    return {
      allowed: true,
      warning: `Time budget at ${Math.round(ratio * 100)}% (${formatDuration(elapsed)}/${formatDuration(budget.maxTimeMs)})`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Aggregate governance check
// ---------------------------------------------------------------------------

export function runGovernanceChecks(plan: PlanState): GovernanceResult {
  const warnings: string[] = [];
  const checks = [
    checkAgentTurnBudget(plan),
    checkTokenBudget(plan),
    checkTimeBudget(plan),
  ];
  for (const check of checks) {
    if (!check.allowed) {
      return { allowed: false, reason: check.reason, warnings };
    }
    if (check.warning) {
      warnings.push(check.warning);
    }
  }
  return { allowed: true, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m${seconds % 60}s`;
  }
  return `${seconds}s`;
}
