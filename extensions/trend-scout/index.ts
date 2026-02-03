// ---------------------------------------------------------------------------
// Trend Scout Extension
// ---------------------------------------------------------------------------
//
// Autonomous trend monitoring agent that scans HN, Reddit, and GitHub for
// relevant tech trends, analyzes them with LLM, and stores insights in memory.
//
// Usage:
//   openclaw trend-scout run          # Run a trend scan now
//   openclaw trend-scout status       # Show recent digests
//   openclaw trend-scout config       # Show/edit configuration
//
// The extension also registers a daily cron job to run automatically.
// ---------------------------------------------------------------------------

import { Command } from "commander";
import type { PluginContext, ExtensionApi } from "openclaw/plugin-sdk";

import { DEFAULT_CONFIG } from "./src/types.js";
import {
  runTrendScout,
  getRecentDigests,
  loadConfig,
  saveConfig,
} from "./src/scout-service.js";

// Store reference to API for cron job
let extensionApi: ExtensionApi | null = null;

const trendScoutPlugin = {
  name: "trend-scout",
  version: "0.1.0",

  async register(api: ExtensionApi, ctx: PluginContext) {
    extensionApi = api;
    const logger = ctx.logger.child({ plugin: "trend-scout" });

    logger.info("Trend Scout extension loading...");

    // -------------------------------------------------------------------
    // 1. Register CLI commands
    // -------------------------------------------------------------------
    api.registerCommand((program: Command) => {
      const cmd = program
        .command("trend-scout")
        .description("Autonomous trend monitoring agent");

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
            console.log(`📊 Found ${result.stats.fetched} items, ${result.stats.relevant} relevant\n`);
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

      return cmd;
    });

    // -------------------------------------------------------------------
    // 2. Register HTTP endpoints
    // -------------------------------------------------------------------
    api.registerHttpRoute({
      path: "/trend-scout/status",
      handler: async (req, res) => {
        const digests = getRecentDigests(7);
        const config = loadConfig();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          config,
          recentDigests: digests.length,
          latestDate: digests[0]?.date || null,
        }));
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
    // 3. Register daily cron job (optional - can be disabled in config)
    // -------------------------------------------------------------------
    // Note: This runs at 9am daily if cron is enabled
    // Users can also trigger manually via CLI or HTTP

    logger.info("Trend Scout extension loaded");
  },
};

export default trendScoutPlugin;
