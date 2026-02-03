// ---------------------------------------------------------------------------
// Goal Loop – Core Bridge
// ---------------------------------------------------------------------------
//
// Dynamic imports from the OpenClaw core dist directory. Extensions cannot
// statically import from core (no `openclaw/...` path alias for arbitrary
// modules). Instead we resolve the core root at runtime and import from dist/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Core type stubs (minimal surface we use)
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

export type CoreRunCronAgentTurnResult = {
  status: "ok" | "error" | "skipped";
  summary?: string;
  outputText?: string;
  error?: string;
};

export type CoreUsageSummary = {
  updatedAt: number;
  providers: Array<{
    provider: string;
    displayName: string;
    windows: Array<{ label: string; usedPercent: number; resetAt?: number }>;
    error?: string;
  }>;
};

export type CoreOutboundDeliveryResult = {
  channel: string;
  messageId: string;
  [key: string]: unknown;
};

export type CoreCliDeps = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Core module resolution
// ---------------------------------------------------------------------------

let coreRootCache: string | null = null;

function findPackageRoot(startDir: string, name: string): string | null {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    try {
      if (fs.existsSync(pkgPath)) {
        const raw = fs.readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name === name) return dir;
      }
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveOpenClawRoot(): string {
  if (coreRootCache) return coreRootCache;

  const override = process.env.OPENCLAW_ROOT?.trim();
  if (override) {
    coreRootCache = override;
    return override;
  }

  const candidates = new Set<string>();
  if (process.argv[1]) candidates.add(path.dirname(process.argv[1]));
  candidates.add(process.cwd());
  try {
    const urlPath = fileURLToPath(import.meta.url);
    candidates.add(path.dirname(urlPath));
  } catch {
    // ignore
  }

  for (const start of candidates) {
    const found = findPackageRoot(start, "openclaw");
    if (found) {
      coreRootCache = found;
      return found;
    }
  }

  throw new Error("Unable to resolve OpenClaw core root. Set OPENCLAW_ROOT.");
}

async function importCoreModule<T>(relativePath: string): Promise<T> {
  const root = resolveOpenClawRoot();
  const distPath = path.join(root, "dist", relativePath);
  if (!fs.existsSync(distPath)) {
    throw new Error(`Missing core module at ${distPath}. Run \`pnpm build\`.`);
  }
  return (await import(pathToFileURL(distPath).href)) as T;
}

// ---------------------------------------------------------------------------
// Lazy-loaded core deps
// ---------------------------------------------------------------------------

export type CoreDeps = {
  runCronIsolatedAgentTurn: (params: {
    cfg: CoreConfig;
    deps: CoreCliDeps;
    job: CoreCronJob;
    message: string;
    sessionKey: string;
    agentId?: string;
    lane?: string;
  }) => Promise<CoreRunCronAgentTurnResult>;

  loadProviderUsageSummary: (opts?: Record<string, unknown>) => Promise<CoreUsageSummary>;

  deliverOutboundPayloads: (params: {
    cfg: CoreConfig;
    channel: string;
    to: string;
    accountId?: string;
    payloads: Array<{ text?: string; mediaUrl?: string }>;
    bestEffort?: boolean;
    deps?: CoreCliDeps;
  }) => Promise<CoreOutboundDeliveryResult[]>;

  createDefaultDeps: () => CoreCliDeps;
};

let coreDepsPromise: Promise<CoreDeps> | null = null;

export async function loadCoreDeps(): Promise<CoreDeps> {
  if (coreDepsPromise) return coreDepsPromise;

  coreDepsPromise = (async () => {
    const [cronRun, providerUsage, outbound, cliDeps] = await Promise.all([
      importCoreModule<{
        runCronIsolatedAgentTurn: CoreDeps["runCronIsolatedAgentTurn"];
      }>("cron/isolated-agent/run.js"),
      importCoreModule<{
        loadProviderUsageSummary: CoreDeps["loadProviderUsageSummary"];
      }>("infra/provider-usage.js"),
      importCoreModule<{
        deliverOutboundPayloads: CoreDeps["deliverOutboundPayloads"];
      }>("infra/outbound/deliver.js"),
      importCoreModule<{
        createDefaultDeps: CoreDeps["createDefaultDeps"];
      }>("cli/deps.js"),
    ]);

    return {
      runCronIsolatedAgentTurn: cronRun.runCronIsolatedAgentTurn,
      loadProviderUsageSummary: providerUsage.loadProviderUsageSummary,
      deliverOutboundPayloads: outbound.deliverOutboundPayloads,
      createDefaultDeps: cliDeps.createDefaultDeps,
    };
  })();

  return coreDepsPromise;
}
