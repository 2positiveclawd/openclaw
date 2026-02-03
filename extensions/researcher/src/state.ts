// ---------------------------------------------------------------------------
// Researcher – File-based State Persistence
// ---------------------------------------------------------------------------
//
// Researches are stored in a single JSON file
// (~/.openclaw/researcher/researches.json).
// Per-research logs are append-only JSONL files under
// ~/.openclaw/researcher/{researchId}/.
//
// All writes to researches.json use atomic temp-file-then-rename.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  ResearchRoundRecord,
  ResearchState,
  ResearchStoreFile,
} from "./types.js";

const BASE_DIR = path.join(os.homedir(), ".openclaw", "researcher");

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function storeFilePath(): string {
  return path.join(BASE_DIR, "researches.json");
}

function researchDir(researchId: string): string {
  return path.join(BASE_DIR, researchId);
}

function roundsLogPath(researchId: string): string {
  return path.join(researchDir(researchId), "rounds.jsonl");
}

// ---------------------------------------------------------------------------
// researches.json read / write (atomic)
// ---------------------------------------------------------------------------

export function readResearchStore(): ResearchStoreFile {
  const filePath = storeFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ResearchStoreFile;
    if (parsed.version !== 1 || !parsed.researches) {
      return { version: 1, researches: {} };
    }
    return parsed;
  } catch {
    return { version: 1, researches: {} };
  }
}

export function writeResearchStore(store: ResearchStoreFile): void {
  ensureDir(BASE_DIR);
  const filePath = storeFilePath();
  const tmpPath = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

/**
 * Update the research store atomically with a mutator function.
 */
export function updateResearchStore(
  fn: (store: ResearchStoreFile) => void,
): ResearchStoreFile {
  const store = readResearchStore();
  fn(store);
  writeResearchStore(store);
  return store;
}

// ---------------------------------------------------------------------------
// Single-research convenience
// ---------------------------------------------------------------------------

export function readResearch(researchId: string): ResearchState | null {
  const store = readResearchStore();
  return store.researches[researchId] ?? null;
}

export function writeResearch(research: ResearchState): void {
  updateResearchStore((store) => {
    store.researches[research.id] = research;
  });
}

export function listResearches(): ResearchState[] {
  const store = readResearchStore();
  return Object.values(store.researches);
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
// Rounds log
// ---------------------------------------------------------------------------

export function appendRoundLog(record: ResearchRoundRecord): void {
  appendJsonl(roundsLogPath(record.researchId), record);
}

export function readRoundLog(researchId: string): ResearchRoundRecord[] {
  return readJsonl<ResearchRoundRecord>(roundsLogPath(researchId));
}
