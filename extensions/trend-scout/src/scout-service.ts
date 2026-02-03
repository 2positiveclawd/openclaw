// ---------------------------------------------------------------------------
// Trend Scout - Main Service
// ---------------------------------------------------------------------------
//
// Orchestrates fetching, analyzing, and storing trend data.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { TrendScoutConfig, TrendDigest, TrendItem } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { fetchAllSources } from "./sources.js";
import {
  filterByRelevance,
  deduplicateItems,
  rankItems,
  buildAnalysisPrompt,
  parseAnalysisResponse,
  createDigest,
  formatDigestAsMarkdown,
} from "./analyzer.js";

const execFileAsync = promisify(execFile);

const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE ||
  path.join(process.env.HOME || "/home/azureuser", ".openclaw/workspace");
const MEMORY_DIR = path.join(WORKSPACE_DIR, "memory");
const CONFIG_FILE = path.join(
  process.env.HOME || "/home/azureuser",
  ".openclaw/dashboard/trend-scout.json"
);
const DIGESTS_DIR = path.join(
  process.env.HOME || "/home/azureuser",
  ".openclaw/dashboard/trend-digests"
);
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "/home/azureuser/openclaw/openclaw.mjs";

// ---------------------------------------------------------------------------
// Config Management
// ---------------------------------------------------------------------------

export function loadConfig(): TrendScoutConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.warn("[trend-scout] Failed to load config, using defaults:", err);
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: TrendScoutConfig): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// LLM Analysis
// ---------------------------------------------------------------------------

interface AzureConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function loadAzureConfig(): AzureConfig | null {
  try {
    const configPath = path.join(process.env.HOME || "", ".openclaw/openclaw.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const azure = config?.models?.providers?.azure;
    if (azure?.baseUrl && azure?.apiKey && azure?.models?.[0]?.id) {
      return {
        baseUrl: azure.baseUrl.replace(/\/v1\/?$/, ""), // Remove /v1 suffix for Azure API
        apiKey: azure.apiKey,
        model: azure.models[0].id,
      };
    }
  } catch (err) {
    console.warn("[trend-scout] Failed to load Azure config:", err);
  }
  return null;
}

async function analyzeWithLLM(prompt: string): Promise<string> {
  const azureConfig = loadAzureConfig();

  if (!azureConfig) {
    console.warn("[trend-scout] No Azure config found, skipping LLM analysis");
    return generateFallbackAnalysis();
  }

  try {
    // Use Azure OpenAI API directly
    const apiUrl = `${azureConfig.baseUrl}/deployments/${azureConfig.model}/chat/completions?api-version=2024-02-15-preview`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": azureConfig.apiKey,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: "You are a tech trend analyst. Analyze the provided trends and provide concise insights. Format your response with **Summary**, **Key Insights** (bullet points), and **Opportunities** (bullet points).",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_completion_tokens: 4000,  // Reasoning models need extra tokens for internal reasoning
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;

    if (content) {
      console.log("[trend-scout] LLM analysis completed");
      return content;
    }

    throw new Error("No content in response");
  } catch (err) {
    console.error("[trend-scout] LLM analysis failed:", err);
    return generateFallbackAnalysis();
  }
}

function generateFallbackAnalysis(): string {
  return `**Summary**
Unable to generate AI analysis. Please review the raw trends below.

**Key Insights**
- Multiple trending items detected across sources
- Manual review recommended

**Opportunities**
- Review the top-scored items for potential relevance`;
}

// ---------------------------------------------------------------------------
// Memory Storage
// ---------------------------------------------------------------------------

function writeToMemory(digest: TrendDigest): string {
  // Ensure memory directory exists
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }

  const filename = `trends-${digest.date}.md`;
  const filepath = path.join(MEMORY_DIR, filename);
  const content = formatDigestAsMarkdown(digest);

  fs.writeFileSync(filepath, content);
  console.log(`[trend-scout] Written to memory: ${filepath}`);

  return filepath;
}

function saveDigestJson(digest: TrendDigest): string {
  if (!fs.existsSync(DIGESTS_DIR)) {
    fs.mkdirSync(DIGESTS_DIR, { recursive: true });
  }

  const filename = `${digest.date}.json`;
  const filepath = path.join(DIGESTS_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(digest, null, 2));
  return filepath;
}

// ---------------------------------------------------------------------------
// Discord Notification
// ---------------------------------------------------------------------------

async function notifyDiscord(digest: TrendDigest, channelId?: string): Promise<boolean> {
  if (!channelId) {
    // Try to load from discord-notify config
    try {
      const discordConfig = JSON.parse(
        fs.readFileSync(
          path.join(process.env.HOME || "", ".openclaw/dashboard/discord-notify.json"),
          "utf-8"
        )
      );
      channelId = discordConfig.channelId;
    } catch {
      return false;
    }
  }

  if (!channelId) return false;

  const message = [
    `📊 **Trend Scout - ${digest.date}**`,
    "",
    digest.summary.slice(0, 300) + (digest.summary.length > 300 ? "..." : ""),
    "",
    "**Top Insights:**",
    ...digest.insights.slice(0, 3).map((i) => `• ${i.slice(0, 100)}`),
    "",
    `_Found ${digest.items.length} trending items across HN, Reddit, GitHub_`,
  ].join("\n");

  try {
    await execFileAsync(
      "node",
      [OPENCLAW_BIN, "message", "send", "--channel", "discord", "--target", channelId, "--message", message],
      { timeout: 30000, env: { ...process.env, FORCE_COLOR: "0" } }
    );
    console.log("[trend-scout] Discord notification sent");
    return true;
  } catch (err) {
    console.error("[trend-scout] Discord notification failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main Scout Function
// ---------------------------------------------------------------------------

export interface ScoutResult {
  success: boolean;
  digest?: TrendDigest;
  memoryPath?: string;
  error?: string;
  stats: {
    fetched: number;
    relevant: number;
    analyzed: number;
  };
}

export async function runTrendScout(
  configOverrides?: Partial<TrendScoutConfig>,
  options?: { notify?: boolean; skipLLM?: boolean }
): Promise<ScoutResult> {
  const config = { ...loadConfig(), ...configOverrides };
  const stats = { fetched: 0, relevant: 0, analyzed: 0 };

  console.log("[trend-scout] Starting trend scan...");
  console.log(`[trend-scout] Topics: ${config.topics.join(", ")}`);

  try {
    // 1. Fetch from all sources
    const rawItems = await fetchAllSources(config);
    stats.fetched = rawItems.length;

    if (rawItems.length === 0) {
      return {
        success: false,
        error: "No items fetched from any source",
        stats,
      };
    }

    // 2. Filter by relevance
    const relevant = filterByRelevance(rawItems, config);
    stats.relevant = relevant.length;

    // 3. Deduplicate and rank
    const deduped = deduplicateItems(relevant.length > 0 ? relevant : rawItems);
    const ranked = rankItems(deduped);
    stats.analyzed = ranked.length;

    // 4. Analyze with LLM (unless skipped)
    let analysis = {
      summary: "Trend analysis pending.",
      insights: ["Review trending items manually"],
      opportunities: ["Check top-scored items for relevance"],
    };

    if (!options?.skipLLM && ranked.length > 0) {
      console.log("[trend-scout] Running LLM analysis...");
      const prompt = buildAnalysisPrompt(ranked, config);
      const response = await analyzeWithLLM(prompt);
      const parsed = parseAnalysisResponse(response);

      if (parsed.summary) {
        analysis = {
          summary: parsed.summary,
          insights: parsed.insights.length > 0 ? parsed.insights : analysis.insights,
          opportunities: parsed.opportunities.length > 0 ? parsed.opportunities : analysis.opportunities,
        };
      }
    }

    // 5. Create digest
    const digest = createDigest(ranked, analysis, config);

    // 6. Write to memory
    const memoryPath = writeToMemory(digest);

    // 7. Save JSON digest
    saveDigestJson(digest);

    // 8. Notify (if requested)
    if (options?.notify) {
      await notifyDiscord(digest);
    }

    console.log("[trend-scout] Scan complete!");
    console.log(`[trend-scout] Stats: fetched=${stats.fetched}, relevant=${stats.relevant}, analyzed=${stats.analyzed}`);

    return {
      success: true,
      digest,
      memoryPath,
      stats,
    };
  } catch (err) {
    console.error("[trend-scout] Scout failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stats,
    };
  }
}

// ---------------------------------------------------------------------------
// Get Recent Digests
// ---------------------------------------------------------------------------

export function getRecentDigests(days = 7): TrendDigest[] {
  const digests: TrendDigest[] = [];

  if (!fs.existsSync(DIGESTS_DIR)) return digests;

  const files = fs.readdirSync(DIGESTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, days);

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(DIGESTS_DIR, file), "utf-8");
      digests.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }

  return digests;
}
