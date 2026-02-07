import type { CostUsageSummary, SourceUsageSummary } from "../../infra/session-cost-usage.js";
import type { GatewayRequestHandlers } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { DEFAULT_CRON_STORE_PATH, loadCronStore } from "../../cron/store.js";
import { loadProviderUsageSummary } from "../../infra/provider-usage.js";
import { loadCostUsageSummary, loadCostUsageBySource } from "../../infra/session-cost-usage.js";

const COST_USAGE_CACHE_TTL_MS = 30_000;

type CostUsageCacheEntry = {
  summary?: CostUsageSummary;
  updatedAt?: number;
  inFlight?: Promise<CostUsageSummary>;
};

const costUsageCache = new Map<number, CostUsageCacheEntry>();

const parseDays = (raw: unknown): number => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return 30;
};

async function loadCostUsageSummaryCached(params: {
  days: number;
  config: ReturnType<typeof loadConfig>;
}): Promise<CostUsageSummary> {
  const days = Math.max(1, params.days);
  const now = Date.now();
  const cached = costUsageCache.get(days);
  if (cached?.summary && cached.updatedAt && now - cached.updatedAt < COST_USAGE_CACHE_TTL_MS) {
    return cached.summary;
  }

  if (cached?.inFlight) {
    if (cached.summary) {
      return cached.summary;
    }
    return await cached.inFlight;
  }

  const entry: CostUsageCacheEntry = cached ?? {};
  const inFlight = loadCostUsageSummary({ days, config: params.config })
    .then((summary) => {
      costUsageCache.set(days, { summary, updatedAt: Date.now() });
      return summary;
    })
    .catch((err) => {
      if (entry.summary) {
        return entry.summary;
      }
      throw err;
    })
    .finally(() => {
      const current = costUsageCache.get(days);
      if (current?.inFlight === inFlight) {
        current.inFlight = undefined;
        costUsageCache.set(days, current);
      }
    });

  entry.inFlight = inFlight;
  costUsageCache.set(days, entry);

  if (entry.summary) {
    return entry.summary;
  }
  return await inFlight;
}

let sourceUsageCache: { summary?: SourceUsageSummary; updatedAt?: number } = {};

export const usageHandlers: GatewayRequestHandlers = {
  "usage.status": async ({ respond }) => {
    const summary = await loadProviderUsageSummary();
    respond(true, summary, undefined);
  },
  "usage.cost": async ({ respond, params }) => {
    const config = loadConfig();
    const days = parseDays(params?.days);
    const summary = await loadCostUsageSummaryCached({ days, config });
    respond(true, summary, undefined);
  },
  "usage.by-source": async ({ respond }) => {
    const now = Date.now();
    if (
      sourceUsageCache.summary &&
      sourceUsageCache.updatedAt &&
      now - sourceUsageCache.updatedAt < COST_USAGE_CACHE_TTL_MS
    ) {
      respond(true, sourceUsageCache.summary, undefined);
      return;
    }
    const config = loadConfig();
    // Load cron job names for display
    const cronJobNames: Record<string, string> = {};
    try {
      const store = await loadCronStore(DEFAULT_CRON_STORE_PATH);
      for (const job of store.jobs) {
        if (job.name) {
          cronJobNames[job.id] = job.name;
        }
      }
    } catch {
      // No cron jobs available
    }
    const summary = await loadCostUsageBySource({ config, cronJobNames });
    sourceUsageCache = { summary, updatedAt: Date.now() };
    respond(true, summary, undefined);
  },
};
