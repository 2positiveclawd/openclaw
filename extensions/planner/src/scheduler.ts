// ---------------------------------------------------------------------------
// Planner – DAG Scheduler
// ---------------------------------------------------------------------------
//
// Handles DAG validation, ready task discovery, and deadlock detection.

import type { PlanTask, TaskStatus } from "./types.js";

// ---------------------------------------------------------------------------
// DAG validation
// ---------------------------------------------------------------------------

export type DagValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validate that tasks form a valid DAG: no cycles, all deps exist, no self-refs.
 */
export function validateDag(tasks: PlanTask[]): DagValidationResult {
  const errors: string[] = [];
  const ids = new Set(tasks.map((t) => t.id));

  // Check for duplicate IDs
  if (ids.size !== tasks.length) {
    const seen = new Set<string>();
    for (const t of tasks) {
      if (seen.has(t.id)) errors.push(`Duplicate task ID: ${t.id}`);
      seen.add(t.id);
    }
  }

  // Check all deps exist and no self-references
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (dep === task.id) {
        errors.push(`Task ${task.id} depends on itself`);
      } else if (!ids.has(dep)) {
        errors.push(`Task ${task.id} depends on unknown task ${dep}`);
      }
    }
  }

  // Check for cycles using topological sort (Kahn's algorithm)
  if (errors.length === 0) {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const t of tasks) {
      inDegree.set(t.id, 0);
      adj.set(t.id, []);
    }
    for (const t of tasks) {
      for (const dep of t.dependencies) {
        adj.get(dep)?.push(t.id);
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let processed = 0;
    while (queue.length > 0) {
      const id = queue.shift()!;
      processed++;
      for (const next of adj.get(id) ?? []) {
        const newDeg = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) queue.push(next);
      }
    }

    if (processed < tasks.length) {
      errors.push("Cycle detected in task dependencies");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Find ready tasks
// ---------------------------------------------------------------------------

/**
 * Return tasks that are in "ready" status.
 */
export function findReadyTasks(tasks: PlanTask[]): PlanTask[] {
  return tasks.filter((t) => t.status === "ready");
}

/**
 * Update task statuses: mark tasks as "ready" when all deps are completed.
 * Also allows deps on completed tasks from previous plan revisions.
 */
export function updateReadyTasks(
  tasks: PlanTask[],
  completedIds: Set<string>,
): void {
  for (const task of tasks) {
    if (task.status !== "pending") continue;
    const allDepsMet = task.dependencies.every(
      (dep) =>
        completedIds.has(dep) ||
        tasks.find((t) => t.id === dep)?.status === "completed",
    );
    if (allDepsMet) {
      task.status = "ready";
    }
  }
}

// ---------------------------------------------------------------------------
// Deadlock detection
// ---------------------------------------------------------------------------

export type SchedulerState = {
  hasReady: boolean;
  hasRunning: boolean;
  allDone: boolean;
  deadlocked: boolean;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  pendingCount: number;
  runningCount: number;
  readyCount: number;
};

/**
 * Analyze the current state of all tasks to detect deadlocks and completion.
 */
export function analyzeSchedulerState(tasks: PlanTask[]): SchedulerState {
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    ready: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const t of tasks) {
    counts[t.status]++;
  }

  const allDone =
    counts.pending === 0 && counts.ready === 0 && counts.running === 0;

  // Deadlocked = no ready, no running, but still have pending tasks
  // (whose deps can never be satisfied because some deps are failed/skipped)
  const deadlocked =
    counts.ready === 0 &&
    counts.running === 0 &&
    counts.pending > 0;

  return {
    hasReady: counts.ready > 0,
    hasRunning: counts.running > 0,
    allDone,
    deadlocked,
    completedCount: counts.completed,
    failedCount: counts.failed,
    skippedCount: counts.skipped,
    pendingCount: counts.pending,
    runningCount: counts.running,
    readyCount: counts.ready,
  };
}

// ---------------------------------------------------------------------------
// Skip downstream tasks
// ---------------------------------------------------------------------------

/**
 * When a task fails with no retries left, skip all downstream tasks that
 * depend on it (directly or transitively).
 */
export function skipDownstreamTasks(tasks: PlanTask[], failedTaskId: string): string[] {
  const skipped: string[] = [];
  const failedSet = new Set<string>([failedTaskId]);

  // Keep expanding: any task whose deps include a failed/skipped task also gets skipped
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (task.status !== "pending" && task.status !== "ready") continue;
      if (failedSet.has(task.id)) continue;
      const hasBlockedDep = task.dependencies.some((dep) => failedSet.has(dep));
      if (hasBlockedDep) {
        task.status = "skipped";
        failedSet.add(task.id);
        skipped.push(task.id);
        changed = true;
      }
    }
  }

  return skipped;
}
