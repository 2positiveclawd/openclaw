import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { NormalizedUsage, UsageLike } from "../agents/usage.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { normalizeUsage } from "../agents/usage.js";
import {
  resolveSessionFilePath,
  resolveSessionTranscriptsDirForAgent,
} from "../config/sessions/paths.js";
import { estimateUsageCost, resolveModelCostConfig } from "../utils/usage-format.js";

type ParsedUsageEntry = {
  usage: NormalizedUsage;
  costTotal?: number;
  provider?: string;
  model?: string;
  timestamp?: Date;
};

export type CostUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  missingCostEntries: number;
};

export type CostUsageDailyEntry = CostUsageTotals & {
  date: string;
};

export type CostUsageSummary = {
  updatedAt: number;
  days: number;
  daily: CostUsageDailyEntry[];
  totals: CostUsageTotals;
};

export type SessionCostSummary = CostUsageTotals & {
  sessionId?: string;
  sessionFile?: string;
  lastActivity?: number;
};

const emptyTotals = (): CostUsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  totalCost: 0,
  missingCostEntries: 0,
});

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const extractCostTotal = (usageRaw?: UsageLike | null): number | undefined => {
  if (!usageRaw || typeof usageRaw !== "object") {
    return undefined;
  }
  const record = usageRaw as Record<string, unknown>;
  const cost = record.cost as Record<string, unknown> | undefined;
  const total = toFiniteNumber(cost?.total);
  if (total === undefined) {
    return undefined;
  }
  if (total < 0) {
    return undefined;
  }
  return total;
};

const parseTimestamp = (entry: Record<string, unknown>): Date | undefined => {
  const raw = entry.timestamp;
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  const message = entry.message as Record<string, unknown> | undefined;
  const messageTimestamp = toFiniteNumber(message?.timestamp);
  if (messageTimestamp !== undefined) {
    const parsed = new Date(messageTimestamp);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  return undefined;
};

const parseUsageEntry = (entry: Record<string, unknown>): ParsedUsageEntry | null => {
  const message = entry.message as Record<string, unknown> | undefined;
  const role = message?.role;
  if (role !== "assistant") {
    return null;
  }

  const usageRaw =
    (message?.usage as UsageLike | undefined) ?? (entry.usage as UsageLike | undefined);
  const usage = normalizeUsage(usageRaw);
  if (!usage) {
    return null;
  }

  const provider =
    (typeof message?.provider === "string" ? message?.provider : undefined) ??
    (typeof entry.provider === "string" ? entry.provider : undefined);
  const model =
    (typeof message?.model === "string" ? message?.model : undefined) ??
    (typeof entry.model === "string" ? entry.model : undefined);

  return {
    usage,
    costTotal: extractCostTotal(usageRaw),
    provider,
    model,
    timestamp: parseTimestamp(entry),
  };
};

const formatDayKey = (date: Date): string =>
  date.toLocaleDateString("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

const applyUsageTotals = (totals: CostUsageTotals, usage: NormalizedUsage) => {
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
  const totalTokens =
    usage.total ??
    (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  totals.totalTokens += totalTokens;
};

const applyCostTotal = (totals: CostUsageTotals, costTotal: number | undefined) => {
  if (costTotal === undefined) {
    totals.missingCostEntries += 1;
    return;
  }
  totals.totalCost += costTotal;
};

async function scanUsageFile(params: {
  filePath: string;
  config?: OpenClawConfig;
  onEntry: (entry: ParsedUsageEntry) => void;
}): Promise<void> {
  const fileStream = fs.createReadStream(params.filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const entry = parseUsageEntry(parsed);
      if (!entry) {
        continue;
      }

      if (entry.costTotal === undefined) {
        const cost = resolveModelCostConfig({
          provider: entry.provider,
          model: entry.model,
          config: params.config,
        });
        entry.costTotal = estimateUsageCost({ usage: entry.usage, cost });
      }

      params.onEntry(entry);
    } catch {
      // Ignore malformed lines
    }
  }
}

export async function loadCostUsageSummary(params?: {
  days?: number;
  config?: OpenClawConfig;
  agentId?: string;
}): Promise<CostUsageSummary> {
  const days = Math.max(1, Math.floor(params?.days ?? 30));
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - (days - 1));
  const sinceTime = since.getTime();

  const dailyMap = new Map<string, CostUsageTotals>();
  const totals = emptyTotals();

  const sessionsDir = resolveSessionTranscriptsDirForAgent(params?.agentId);
  const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const files = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map(async (entry) => {
          const filePath = path.join(sessionsDir, entry.name);
          const stats = await fs.promises.stat(filePath).catch(() => null);
          if (!stats) {
            return null;
          }
          if (stats.mtimeMs < sinceTime) {
            return null;
          }
          return filePath;
        }),
    )
  ).filter((filePath): filePath is string => Boolean(filePath));

  for (const filePath of files) {
    await scanUsageFile({
      filePath,
      config: params?.config,
      onEntry: (entry) => {
        const ts = entry.timestamp?.getTime();
        if (!ts || ts < sinceTime) {
          return;
        }
        const dayKey = formatDayKey(entry.timestamp ?? now);
        const bucket = dailyMap.get(dayKey) ?? emptyTotals();
        applyUsageTotals(bucket, entry.usage);
        applyCostTotal(bucket, entry.costTotal);
        dailyMap.set(dayKey, bucket);

        applyUsageTotals(totals, entry.usage);
        applyCostTotal(totals, entry.costTotal);
      },
    });
  }

  const daily = Array.from(dailyMap.entries())
    .map(([date, bucket]) => Object.assign({ date }, bucket))
    .toSorted((a, b) => a.date.localeCompare(b.date));

  return {
    updatedAt: Date.now(),
    days,
    daily,
    totals,
  };
}

// ---------------------------------------------------------------------------
// Source attribution: parse session keys to determine what generated the usage
// ---------------------------------------------------------------------------

export type SourceUsageEntry = {
  sourceType: "cron" | "goal" | "planner" | "discord" | "manual" | "other";
  sourceId: string;
  sourceName: string;
  agentId: string;
  tokens: number;
  cost: number;
  sessionCount: number;
  lastActivity?: number;
};

export type SourceUsageSummary = {
  updatedAt: number;
  sources: SourceUsageEntry[];
};

function parseSessionSource(sessionKey: string): {
  sourceType: SourceUsageEntry["sourceType"];
  sourceId: string;
} {
  // Strip the "agent:{agentId}:" prefix if present
  const stripped = sessionKey.replace(/^agent:[^:]+:/, "");

  if (stripped.startsWith("cron:")) {
    return { sourceType: "cron", sourceId: stripped.slice(5) };
  }
  if (stripped.startsWith("goal:")) {
    return { sourceType: "goal", sourceId: stripped.split(":")[1] ?? stripped };
  }
  if (
    stripped.startsWith("planner-worker:") ||
    stripped.startsWith("planner:") ||
    stripped.startsWith("planner-eval:")
  ) {
    const parts = stripped.split(":");
    return { sourceType: "planner", sourceId: parts[1] ?? stripped };
  }
  if (stripped.startsWith("discord:")) {
    return { sourceType: "discord", sourceId: stripped };
  }
  if (stripped === "main") {
    return { sourceType: "manual", sourceId: "main" };
  }
  return { sourceType: "other", sourceId: stripped };
}

export async function loadCostUsageBySource(params?: {
  config?: OpenClawConfig;
  cronJobNames?: Record<string, string>;
}): Promise<SourceUsageSummary> {
  const agentsDir = path.join(
    process.env.OPENCLAW_HOME ?? path.join(os.homedir(), ".openclaw"),
    "agents",
  );

  const sourceMap = new Map<string, SourceUsageEntry>();

  let agentDirs: string[];
  try {
    agentDirs = (await fs.promises.readdir(agentsDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return { updatedAt: Date.now(), sources: [] };
  }

  for (const agentId of agentDirs) {
    const sessionsFile = path.join(agentsDir, agentId, "sessions/sessions.json");
    let store: Record<string, Record<string, unknown>>;
    try {
      const raw = await fs.promises.readFile(sessionsFile, "utf-8");
      store = JSON.parse(raw);
    } catch {
      continue;
    }

    for (const [sessionKey, entry] of Object.entries(store)) {
      const totalTokens = typeof entry.totalTokens === "number" ? entry.totalTokens : 0;
      const inputTokens = typeof entry.inputTokens === "number" ? entry.inputTokens : 0;
      const outputTokens = typeof entry.outputTokens === "number" ? entry.outputTokens : 0;

      if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0) continue;

      const { sourceType, sourceId } = parseSessionSource(sessionKey);
      const mapKey = `${sourceType}:${sourceId}`;

      const existing = sourceMap.get(mapKey);
      const tokens = totalTokens || inputTokens + outputTokens;
      const updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : undefined;

      if (existing) {
        existing.tokens += tokens;
        existing.sessionCount++;
        if (updatedAt && (!existing.lastActivity || updatedAt > existing.lastActivity)) {
          existing.lastActivity = updatedAt;
        }
      } else {
        // Resolve display name
        let sourceName = sourceId;
        if (sourceType === "cron" && params?.cronJobNames?.[sourceId]) {
          sourceName = params.cronJobNames[sourceId];
        } else if (sourceType === "goal") {
          sourceName = `Goal ${sourceId.slice(0, 8)}`;
        } else if (sourceType === "planner") {
          sourceName = `Plan ${sourceId.slice(0, 8)}`;
        } else if (sourceType === "discord") {
          sourceName = "Discord";
        } else if (sourceType === "manual") {
          sourceName = "Manual session";
        }

        sourceMap.set(mapKey, {
          sourceType,
          sourceId,
          sourceName,
          agentId,
          tokens,
          cost: 0,
          sessionCount: 1,
          lastActivity: updatedAt,
        });
      }
    }
  }

  const sources = Array.from(sourceMap.values()).sort((a, b) => b.tokens - a.tokens);
  return { updatedAt: Date.now(), sources };
}

export async function loadSessionCostSummary(params: {
  sessionId?: string;
  sessionEntry?: SessionEntry;
  sessionFile?: string;
  config?: OpenClawConfig;
}): Promise<SessionCostSummary | null> {
  const sessionFile =
    params.sessionFile ??
    (params.sessionId ? resolveSessionFilePath(params.sessionId, params.sessionEntry) : undefined);
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return null;
  }

  const totals = emptyTotals();
  let lastActivity: number | undefined;

  await scanUsageFile({
    filePath: sessionFile,
    config: params.config,
    onEntry: (entry) => {
      applyUsageTotals(totals, entry.usage);
      applyCostTotal(totals, entry.costTotal);
      const ts = entry.timestamp?.getTime();
      if (ts && (!lastActivity || ts > lastActivity)) {
        lastActivity = ts;
      }
    },
  });

  return {
    sessionId: params.sessionId,
    sessionFile,
    lastActivity,
    ...totals,
  };
}
