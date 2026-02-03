// ---------------------------------------------------------------------------
// Planner – File-based State Persistence
// ---------------------------------------------------------------------------
//
// Plans are stored in a single JSON file (~/.openclaw/planner/plans.json).
// Per-plan logs are append-only JSONL files under ~/.openclaw/planner/{planId}/.
//
// All writes to plans.json use atomic temp-file-then-rename to avoid corruption.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  PlanEvaluationRecord,
  PlanState,
  PlanStoreFile,
  TaskStateRecord,
  WorkerRunRecord,
} from "./types.js";

const BASE_DIR = path.join(os.homedir(), ".openclaw", "planner");

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function plansFilePath(): string {
  return path.join(BASE_DIR, "plans.json");
}

function planDir(planId: string): string {
  return path.join(BASE_DIR, planId);
}

function tasksLogPath(planId: string): string {
  return path.join(planDir(planId), "tasks.jsonl");
}

function workerRunsLogPath(planId: string): string {
  return path.join(planDir(planId), "worker-runs.jsonl");
}

function evaluationsLogPath(planId: string): string {
  return path.join(planDir(planId), "evaluations.jsonl");
}

// ---------------------------------------------------------------------------
// plans.json read / write (atomic)
// ---------------------------------------------------------------------------

export function readPlanStore(): PlanStoreFile {
  const filePath = plansFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as PlanStoreFile;
    if (parsed.version !== 1 || !parsed.plans) {
      return { version: 1, plans: {} };
    }
    return parsed;
  } catch {
    return { version: 1, plans: {} };
  }
}

export function writePlanStore(store: PlanStoreFile): void {
  ensureDir(BASE_DIR);
  const filePath = plansFilePath();
  const tmpPath = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Update the plan store atomically with a mutator function.
 * Reads current state, applies `fn`, and writes back.
 */
export function updatePlanStore(fn: (store: PlanStoreFile) => void): PlanStoreFile {
  const store = readPlanStore();
  fn(store);
  writePlanStore(store);
  return store;
}

// ---------------------------------------------------------------------------
// Single-plan convenience
// ---------------------------------------------------------------------------

export function readPlan(planId: string): PlanState | null {
  const store = readPlanStore();
  return store.plans[planId] ?? null;
}

export function writePlan(plan: PlanState): void {
  updatePlanStore((store) => {
    store.plans[plan.id] = plan;
  });
}

export function listPlans(): PlanState[] {
  const store = readPlanStore();
  return Object.values(store.plans);
}

// ---------------------------------------------------------------------------
// JSONL append / read helpers
// ---------------------------------------------------------------------------

function appendJsonl(filePath: string, record: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
}

function readJsonl<T>(filePath: string): T[] {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Task state log
// ---------------------------------------------------------------------------

export function appendTaskStateLog(record: TaskStateRecord): void {
  appendJsonl(tasksLogPath(record.planId), record);
}

export function readTaskStateLog(planId: string): TaskStateRecord[] {
  return readJsonl<TaskStateRecord>(tasksLogPath(planId));
}

// ---------------------------------------------------------------------------
// Worker run log
// ---------------------------------------------------------------------------

export function appendWorkerRunLog(record: WorkerRunRecord): void {
  appendJsonl(workerRunsLogPath(record.planId), record);
}

export function readWorkerRunLog(planId: string): WorkerRunRecord[] {
  return readJsonl<WorkerRunRecord>(workerRunsLogPath(planId));
}

// ---------------------------------------------------------------------------
// Evaluation log
// ---------------------------------------------------------------------------

export function appendEvaluationLog(record: PlanEvaluationRecord): void {
  appendJsonl(evaluationsLogPath(record.planId), record);
}

export function readEvaluationLog(planId: string): PlanEvaluationRecord[] {
  return readJsonl<PlanEvaluationRecord>(evaluationsLogPath(planId));
}
