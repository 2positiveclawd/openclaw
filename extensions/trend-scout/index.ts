// ---------------------------------------------------------------------------
// Trend Scout Extension
// ---------------------------------------------------------------------------
//
// Autonomous trend monitoring agent that scans HN, Reddit, and GitHub for
// relevant tech trends, analyzes them with LLM, and stores insights in memory.
//
// Features:
//   - Daily automated scans (9am by default)
//   - Heartbeat integration (agent checks trends periodically)
//   - Memory integration (trends stored in workspace/memory/)
//
// Usage:
//   openclaw trend-scout run          # Run a trend scan now
//   openclaw trend-scout status       # Show recent digests
//   openclaw trend-scout config       # Show/edit configuration
//
// ---------------------------------------------------------------------------

import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { registerDiscordComponentFactory } from "openclaw/plugin-sdk";
import { createScoutProposalButton } from "./src/discord-buttons.js";
import { runTrendScout, getRecentDigests, loadConfig, saveConfig } from "./src/scout-service.js";
import { DEFAULT_CONFIG } from "./src/types.js";

// Store reference for cleanup
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let dailyInterval: ReturnType<typeof setInterval> | null = null;

// Plugin API type (matches OpenClaw plugin interface)
type PluginApi = {
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  logger: {
    debug?: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  registerService: (service: {
    id: string;
    start: (ctx: unknown) => void | Promise<void>;
    stop?: (ctx: unknown) => void | Promise<void>;
  }) => void;
  registerCli: (
    registrar: (ctx: { program: Command }) => void | Promise<void>,
    opts?: { commands?: string[] },
  ) => void;
  registerHttpRoute: (params: {
    path: string;
    handler: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => Promise<void> | void;
  }) => void;
};

const trendScoutPlugin = {
  id: "trend-scout",
  name: "Trend Scout",
  description: "Autonomous trend monitoring - scans HN, Reddit, GitHub for tech trends",
  version: "0.1.0",

  register(api: PluginApi) {
    const logger = api.logger;

    logger.info("Trend Scout extension loading...");

    // -------------------------------------------------------------------
    // 1. Register CLI commands
    // -------------------------------------------------------------------
    api.registerCli(
      ({ program }) => {
        const cmd = program.command("trend-scout").description("Autonomous trend monitoring agent");

        // Run a scan
        cmd
          .command("run")
          .description("Run a trend scan now")
          .option("--notify", "Send Discord notification", false)
          .option("--skip-llm", "Skip LLM analysis (faster, less insightful)", false)
          .option("--topics <topics>", "Override topics (comma-separated)")
          .action(async (opts) => {
            console.log("🔍 Starting Trend Scout scan...\n");

            const overrides: Record<string, unknown> = {};
            if (opts.topics) {
              overrides.topics = opts.topics.split(",").map((t: string) => t.trim());
            }

            const result = await runTrendScout(overrides, {
              notify: opts.notify,
              skipLLM: opts.skipLlm,
            });

            if (result.success && result.digest) {
              console.log("\n✅ Scan complete!\n");
              console.log(
                `📊 Found ${result.stats.fetched} items, ${result.stats.relevant} relevant\n`,
              );
              console.log("📝 Summary:");
              console.log(result.digest.summary);
              console.log("\n💡 Key Insights:");
              result.digest.insights.forEach((i) => console.log(`  • ${i}`));
              console.log("\n🎯 Opportunities:");
              result.digest.opportunities.forEach((o) => console.log(`  • ${o}`));
              console.log(`\n📁 Saved to: ${result.memoryPath}`);
            } else {
              console.error("❌ Scan failed:", result.error);
              process.exit(1);
            }
          });

        // Show status
        cmd
          .command("status")
          .description("Show recent trend digests")
          .option("-n, --days <n>", "Number of days to show", "7")
          .action((opts) => {
            const digests = getRecentDigests(parseInt(opts.days, 10));

            if (digests.length === 0) {
              console.log("No trend digests found. Run 'openclaw trend-scout run' to create one.");
              return;
            }

            console.log(`📊 Recent Trend Digests (last ${opts.days} days)\n`);
            console.log("─".repeat(60));

            for (const digest of digests) {
              console.log(`\n📅 ${digest.date}`);
              console.log(`   Items: ${digest.items.length} | Topics: ${digest.topics.length}`);
              console.log(`   Summary: ${digest.summary.slice(0, 100)}...`);
            }
          });

        // Show/edit config
        cmd
          .command("config")
          .description("Show or update configuration")
          .option("--topics <topics>", "Set topics (comma-separated)")
          .option("--subreddits <subs>", "Set subreddits (comma-separated)")
          .option("--languages <langs>", "Set GitHub languages (comma-separated)")
          .option("--reset", "Reset to default configuration")
          .action((opts) => {
            if (opts.reset) {
              saveConfig(DEFAULT_CONFIG);
              console.log("✅ Configuration reset to defaults");
              return;
            }

            const config = loadConfig();

            if (opts.topics) {
              config.topics = opts.topics.split(",").map((t: string) => t.trim());
            }
            if (opts.subreddits) {
              config.subreddits = opts.subreddits.split(",").map((s: string) => s.trim());
            }
            if (opts.languages) {
              config.languages = opts.languages.split(",").map((l: string) => l.trim());
            }

            if (opts.topics || opts.subreddits || opts.languages) {
              saveConfig(config);
              console.log("✅ Configuration updated");
            }

            console.log("\n📋 Current Configuration:\n");
            console.log(`Topics: ${config.topics.join(", ")}`);
            console.log(`Subreddits: ${config.subreddits.join(", ")}`);
            console.log(`Languages: ${config.languages.join(", ")}`);
            console.log(`Items per source: ${config.itemsPerSource}`);
            console.log(`Min score: ${config.minScore}`);
            console.log(`Hours back: ${config.hoursBack}`);
          });
      },
      { commands: ["trend-scout"] },
    );

    // -------------------------------------------------------------------
    // 2. Register HTTP endpoints
    // -------------------------------------------------------------------
    api.registerHttpRoute({
      path: "/trend-scout/status",
      handler: async (req, res) => {
        const digests = getRecentDigests(7);
        const config = loadConfig();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            config,
            recentDigests: digests.length,
            latestDate: digests[0]?.date || null,
          }),
        );
      },
    });

    api.registerHttpRoute({
      path: "/trend-scout/run",
      handler: async (req, res) => {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
          return;
        }

        // Run in background
        runTrendScout({}, { notify: true }).then((result) => {
          logger.info(`Trend scan completed: ${result.success ? "success" : "failed"}`);
        });

        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "Trend scan started" }));
      },
    });

    api.registerHttpRoute({
      path: "/trend-scout/latest",
      handler: async (req, res) => {
        const digests = getRecentDigests(1);

        if (digests.length === 0) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "No digests found" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, digest: digests[0] }));
      },
    });

    // -------------------------------------------------------------------
    // 3. Register scheduler service (daily scans)
    // -------------------------------------------------------------------
    api.registerService({
      id: "trend-scout-scheduler",

      start: async (ctx: { stateDir: string; logger: typeof logger }) => {
        const serviceLogger = ctx.logger || logger;
        serviceLogger.info("Trend Scout scheduler starting...");

        // Configuration for scheduler
        const SCAN_HOUR = 9; // Run at 9am local time
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        // Calculate time until next 9am
        const now = new Date();
        const next9am = new Date(now);
        next9am.setHours(SCAN_HOUR, 0, 0, 0);
        if (now.getTime() >= next9am.getTime()) {
          next9am.setDate(next9am.getDate() + 1);
        }
        const msUntilNext = next9am.getTime() - now.getTime();

        serviceLogger.info(
          `Next scheduled scan at ${next9am.toISOString()} (in ${Math.round(msUntilNext / 60000)} minutes)`,
        );

        // Schedule first run
        schedulerTimer = setTimeout(async () => {
          serviceLogger.info("Running scheduled trend scan...");
          try {
            const result = await runTrendScout({}, { notify: true });
            serviceLogger.info(`Scheduled scan complete: ${result.success ? "success" : "failed"}`);

            // Update HEARTBEAT.md with latest trends summary
            await updateHeartbeatFile(result);
          } catch (err) {
            serviceLogger.error("Scheduled scan failed:", err);
          }

          // Then run daily
          dailyInterval = setInterval(async () => {
            serviceLogger.info("Running daily trend scan...");
            try {
              const result = await runTrendScout({}, { notify: true });
              serviceLogger.info(`Daily scan complete: ${result.success ? "success" : "failed"}`);
              await updateHeartbeatFile(result);
            } catch (err) {
              serviceLogger.error("Daily scan failed:", err);
            }
          }, ONE_DAY_MS);
        }, msUntilNext);

        // Also check if we should run now (no scan today yet)
        const today = now.toISOString().split("T")[0];
        const digests = getRecentDigests(1);
        if (digests.length === 0 || digests[0].date !== today) {
          serviceLogger.info("No scan for today yet, running initial scan...");
          setTimeout(async () => {
            try {
              const result = await runTrendScout({}, { notify: false });
              serviceLogger.info(`Initial scan complete: ${result.success ? "success" : "failed"}`);
              await updateHeartbeatFile(result);
            } catch (err) {
              serviceLogger.error("Initial scan failed:", err);
            }
          }, 5000); // Small delay to let gateway fully start
        }
      },

      stop: async () => {
        logger.info("Trend Scout scheduler stopping...");
        if (schedulerTimer) {
          clearTimeout(schedulerTimer);
          schedulerTimer = null;
        }
        if (dailyInterval) {
          clearInterval(dailyInterval);
          dailyInterval = null;
        }
      },
    });

    // Register Discord button component for scout proposal approval
    registerDiscordComponentFactory(() => createScoutProposalButton());

    logger.info("Trend Scout extension loaded");
  },
};

// ---------------------------------------------------------------------------
// Heartbeat Integration
// ---------------------------------------------------------------------------
// Updates HEARTBEAT.md in workspace with trend-related tasks for the agent

async function updateHeartbeatFile(result: Awaited<ReturnType<typeof runTrendScout>>) {
  const workspaceDir =
    process.env.OPENCLAW_WORKSPACE ||
    path.join(process.env.HOME || "/home/azureuser", ".openclaw/workspace");
  const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");

  // Read existing HEARTBEAT.md or create new
  let content = "";
  try {
    if (fs.existsSync(heartbeatPath)) {
      content = fs.readFileSync(heartbeatPath, "utf-8");
    }
  } catch {
    // File doesn't exist, will create
  }

  // Remove old trend-scout section if present
  const trendSectionStart = "<!-- trend-scout-start -->";
  const trendSectionEnd = "<!-- trend-scout-end -->";
  const startIdx = content.indexOf(trendSectionStart);
  const endIdx = content.indexOf(trendSectionEnd);
  if (startIdx !== -1 && endIdx !== -1) {
    content = content.slice(0, startIdx) + content.slice(endIdx + trendSectionEnd.length);
  }

  // Build new trend section
  const trendSection = buildTrendHeartbeatSection(result);

  // Append to content
  content = content.trim() + "\n\n" + trendSection;

  // Write back
  fs.writeFileSync(heartbeatPath, content.trim() + "\n");
}

function buildTrendHeartbeatSection(result: Awaited<ReturnType<typeof runTrendScout>>): string {
  const lines: string[] = ["<!-- trend-scout-start -->", "## Trend Scout", ""];

  if (result.success && result.digest) {
    const digest = result.digest;
    lines.push(`**Last scan:** ${digest.date} | **Items:** ${digest.items.length}`);
    lines.push("");
    lines.push("### Today's Key Insights");
    lines.push("");
    digest.insights.slice(0, 3).forEach((insight) => {
      lines.push(`- ${insight}`);
    });
    lines.push("");
    lines.push("### Opportunities to Consider");
    lines.push("");
    digest.opportunities.slice(0, 2).forEach((opp) => {
      lines.push(`- [ ] ${opp}`);
    });
    lines.push("");
    lines.push("### Action Items");
    lines.push("");
    lines.push("- [ ] Review today's trends in `memory/trends-" + digest.date + ".md`");
    lines.push("- [ ] Consider if any opportunities align with current projects");
    lines.push("- [ ] Flag any security-related trends for immediate attention");
  } else {
    lines.push("⚠️ Last trend scan failed. Run `openclaw trend-scout run` to retry.");
  }

  lines.push("");
  lines.push("<!-- trend-scout-end -->");

  return lines.join("\n");
}

export default trendScoutPlugin;
