// ---------------------------------------------------------------------------
// Goal Loop – Governance Checks
// ---------------------------------------------------------------------------
//
// Each iteration passes through governance before running. Checks include:
// - Budget limits (iterations, tokens, wall-clock time)
// - Provider usage threshold
// - Circuit breaker (consecutive errors)
// - Stall detection (flat evaluation scores)
//
// Also emits warnings when any budget limit reaches 80%.

import type { GoalState, GovernanceCheckResult } from "./types.js";

const BUDGET_WARNING_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

export function checkIterationBudget(goal: GoalState): GovernanceCheckResult {
  const { usage, budget } = goal;
  if (usage.iterations >= budget.maxIterations) {
    return { allowed: false, reason: `Iteration budget exceeded (${usage.iterations}/${budget.maxIterations})` };
  }
  const ratio = usage.iterations / budget.maxIterations;
  if (ratio >= BUDGET_WARNING_THRESHOLD) {
    return { allowed: true, warning: `Iteration budget at ${Math.round(ratio * 100)}% (${usage.iterations}/${budget.maxIterations})` };
  }
  return { allowed: true };
}

export function checkTokenBudget(goal: GoalState): GovernanceCheckResult {
  const { usage, budget } = goal;
  if (usage.totalTokens >= budget.maxTokens) {
    return { allowed: false, reason: `Token budget exceeded (${usage.totalTokens}/${budget.maxTokens})` };
  }
  const ratio = usage.totalTokens / budget.maxTokens;
  if (ratio >= BUDGET_WARNING_THRESHOLD) {
    return { allowed: true, warning: `Token budget at ${Math.round(ratio * 100)}% (${usage.totalTokens}/${budget.maxTokens})` };
  }
  return { allowed: true };
}

export function checkTimeBudget(goal: GoalState): GovernanceCheckResult {
  const { usage, budget } = goal;
  const elapsed = Date.now() - usage.startedAtMs;
  if (elapsed >= budget.maxTimeMs) {
    return { allowed: false, reason: `Time budget exceeded (${formatDuration(elapsed)}/${formatDuration(budget.maxTimeMs)})` };
  }
  const ratio = elapsed / budget.maxTimeMs;
  if (ratio >= BUDGET_WARNING_THRESHOLD) {
    return { allowed: true, warning: `Time budget at ${Math.round(ratio * 100)}% (${formatDuration(elapsed)}/${formatDuration(budget.maxTimeMs)})` };
  }
  return { allowed: true };
}

export function checkCircuitBreaker(goal: GoalState): GovernanceCheckResult {
  const { usage, evalConfig } = goal;
  if (usage.consecutiveErrors >= evalConfig.consecutiveErrorLimit) {
    return {
      allowed: false,
      reason: `Circuit breaker tripped: ${usage.consecutiveErrors} consecutive errors (limit: ${evalConfig.consecutiveErrorLimit})`,
    };
  }
  return { allowed: true };
}

export function checkStallDetection(goal: GoalState): GovernanceCheckResult {
  const { evaluationScores, evalConfig } = goal;
  if (evaluationScores.length < evalConfig.stallThreshold) {
    return { allowed: true };
  }
  const recent = evaluationScores.slice(-evalConfig.stallThreshold);
  const allFlat = recent.every((score, i) => {
    if (i === 0) return true;
    return Math.abs(score - recent[i - 1]) < evalConfig.minProgressDelta;
  });
  if (allFlat) {
    return {
      allowed: false,
      reason: `Stall detected: last ${evalConfig.stallThreshold} evaluations show < ${evalConfig.minProgressDelta} point progress (scores: ${recent.join(", ")})`,
    };
  }
  return { allowed: true };
}

/**
 * Check provider usage via OpenClaw's `loadProviderUsageSummary`.
 * The function is passed in to avoid a hard dependency on the core module.
 */
export async function checkProviderUsage(
  goal: GoalState,
  loadUsage: () => Promise<{ providers: Array<{ windows: Array<{ usedPercent: number }> }> }>,
): Promise<GovernanceCheckResult> {
  try {
    const summary = await loadUsage();
    for (const provider of summary.providers) {
      for (const window of provider.windows) {
        if (window.usedPercent >= goal.budget.providerUsageThreshold) {
          return {
            allowed: false,
            reason: `Provider usage at ${window.usedPercent}% (threshold: ${goal.budget.providerUsageThreshold}%)`,
          };
        }
      }
    }
  } catch {
    // Provider usage check is best-effort; don't block on failure.
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Aggregate governance check
// ---------------------------------------------------------------------------

export type GovernanceResult = {
  allowed: boolean;
  reason?: string;
  warnings: string[];
};

/**
 * Run all synchronous governance checks. Provider usage should be checked
 * separately (async) and merged.
 */
export function runSyncGovernanceChecks(goal: GoalState): GovernanceResult {
  const warnings: string[] = [];
  const checks = [
    checkIterationBudget(goal),
    checkTokenBudget(goal),
    checkTimeBudget(goal),
    checkCircuitBreaker(goal),
    checkStallDetection(goal),
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

/**
 * Full governance check including async provider usage.
 */
export async function runGovernanceChecks(
  goal: GoalState,
  loadUsage: () => Promise<{ providers: Array<{ windows: Array<{ usedPercent: number }> }> }>,
): Promise<GovernanceResult> {
  const syncResult = runSyncGovernanceChecks(goal);
  if (!syncResult.allowed) return syncResult;

  const providerCheck = await checkProviderUsage(goal, loadUsage);
  if (!providerCheck.allowed) {
    return { allowed: false, reason: providerCheck.reason, warnings: syncResult.warnings };
  }
  return syncResult;
}

// ---------------------------------------------------------------------------
// Quality gate check
// ---------------------------------------------------------------------------

export function shouldTriggerQualityGate(goal: GoalState): boolean {
  return goal.qualityGates.some((gate) => gate.atIteration === goal.usage.iterations + 1);
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
