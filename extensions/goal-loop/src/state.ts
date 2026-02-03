// ---------------------------------------------------------------------------
// Goal Loop – File-based State Persistence
// ---------------------------------------------------------------------------
//
// Goals are stored in a single JSON file (~/.openclaw/goal-loop/goals.json).
// Per-goal iteration and evaluation logs are append-only JSONL files under
// ~/.openclaw/goal-loop/{goal-id}/.
//
// All writes to goals.json use atomic temp-file-then-rename to avoid corruption.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  GoalEvaluationRecord,
  GoalIterationRecord,
  GoalState,
  GoalStoreFile,
} from "./types.js";

const BASE_DIR = path.join(os.homedir(), ".openclaw", "goal-loop");

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function goalsFilePath(): string {
  return path.join(BASE_DIR, "goals.json");
}

function goalDir(goalId: string): string {
  return path.join(BASE_DIR, goalId);
}

function iterationsLogPath(goalId: string): string {
  return path.join(goalDir(goalId), "iterations.jsonl");
}

function evaluationsLogPath(goalId: string): string {
  return path.join(goalDir(goalId), "evaluations.jsonl");
}

// ---------------------------------------------------------------------------
// goals.json read / write (atomic)
// ---------------------------------------------------------------------------

export function readGoalStore(): GoalStoreFile {
  const filePath = goalsFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as GoalStoreFile;
    if (parsed.version !== 1 || !parsed.goals) {
      return { version: 1, goals: {} };
    }
    return parsed;
  } catch {
    return { version: 1, goals: {} };
  }
}

export function writeGoalStore(store: GoalStoreFile): void {
  ensureDir(BASE_DIR);
  const filePath = goalsFilePath();
  const tmpPath = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Update the goal store atomically with a mutator function.
 * Reads current state, applies `fn`, and writes back.
 */
export function updateGoalStore(fn: (store: GoalStoreFile) => void): GoalStoreFile {
  const store = readGoalStore();
  fn(store);
  writeGoalStore(store);
  return store;
}

// ---------------------------------------------------------------------------
// Single-goal convenience
// ---------------------------------------------------------------------------

export function readGoal(goalId: string): GoalState | null {
  const store = readGoalStore();
  return store.goals[goalId] ?? null;
}

export function writeGoal(goal: GoalState): void {
  updateGoalStore((store) => {
    store.goals[goal.id] = goal;
  });
}

export function listGoals(): GoalState[] {
  const store = readGoalStore();
  return Object.values(store.goals);
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
// Iteration log
// ---------------------------------------------------------------------------

export function appendIterationLog(record: GoalIterationRecord): void {
  appendJsonl(iterationsLogPath(record.goalId), record);
}

export function readIterationLog(goalId: string): GoalIterationRecord[] {
  return readJsonl<GoalIterationRecord>(iterationsLogPath(goalId));
}

// ---------------------------------------------------------------------------
// Evaluation log
// ---------------------------------------------------------------------------

export function appendEvaluationLog(record: GoalEvaluationRecord): void {
  appendJsonl(evaluationsLogPath(record.goalId), record);
}

export function readEvaluationLog(goalId: string): GoalEvaluationRecord[] {
  return readJsonl<GoalEvaluationRecord>(evaluationsLogPath(goalId));
}
