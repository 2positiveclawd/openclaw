// ---------------------------------------------------------------------------
// Discord Notification for Automation Events
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AutomationEvent } from "./types.js";

const execFileAsync = promisify(execFile);

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "/home/azureuser/openclaw/openclaw.mjs";
const CONFIG_FILE = path.join(
  process.env.HOME || "/home/azureuser",
  ".openclaw/dashboard/discord-notify.json",
);

interface DiscordNotifyConfig {
  enabled: boolean;
  channelId: string;
  events: string[]; // Which events to notify (empty = all)
  format: "compact" | "detailed";
}

function loadConfig(): DiscordNotifyConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveDiscordConfig(config: DiscordNotifyConfig): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getDiscordConfig(): DiscordNotifyConfig | null {
  return loadConfig();
}

/**
 * Format event for Discord message
 */
function formatMessage(event: AutomationEvent, format: "compact" | "detailed"): string {
  const { type, data } = event;
  const emoji = getEventEmoji(type);
  const title = getEventTitle(type);

  if (format === "compact") {
    const score = data.score !== undefined ? ` (${data.score}/100)` : "";
    const duration = data.duration ? ` in ${formatDuration(data.duration)}` : "";
    const assessment = data.assessment ? `\n> ${truncate(String(data.assessment), 300)}` : "";
    return `${emoji} **${title}**${score}${duration}\n\`${data.id}\`: ${truncate(data.goal || "", 200)}${assessment}`;
  }

  // Detailed format
  const lines = [`${emoji} **${title}**`, `**ID:** \`${data.id}\``];

  if (data.goal) {
    lines.push(`**Goal:** ${truncate(data.goal, 400)}`);
  }
  if (data.score !== undefined) {
    lines.push(`**Score:** ${data.score}/100`);
  }
  if (data.duration) {
    lines.push(`**Duration:** ${formatDuration(data.duration)}`);
  }
  if (data.assessment) {
    lines.push(`**Assessment:** ${truncate(String(data.assessment), 500)}`);
  }
  if (data.error) {
    lines.push(`**Error:** ${truncate(data.error, 200)}`);
  }

  return lines.join("\n");
}

function getEventEmoji(type: string): string {
  const emojis: Record<string, string> = {
    "goal.started": "🎯",
    "goal.completed": "✅",
    "goal.failed": "❌",
    "goal.stalled": "⚠️",
    "plan.started": "📋",
    "plan.completed": "✅",
    "plan.failed": "❌",
    "research.started": "🔬",
    "research.completed": "📄",
    "system.error": "🚨",
  };
  return emojis[type] || "📢";
}

function getEventTitle(type: string): string {
  const titles: Record<string, string> = {
    "goal.started": "Goal Started",
    "goal.completed": "Goal Completed",
    "goal.failed": "Goal Failed",
    "goal.stalled": "Goal Stalled",
    "plan.started": "Plan Started",
    "plan.completed": "Plan Completed",
    "plan.failed": "Plan Failed",
    "research.started": "Research Started",
    "research.completed": "Research Complete",
    "system.error": "System Error",
  };
  return titles[type] || type;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Send Discord notification for an automation event
 */
export async function notifyDiscord(event: AutomationEvent): Promise<boolean> {
  const config = loadConfig();
  if (!config || !config.enabled || !config.channelId) {
    return false;
  }

  // Check if this event type should be notified
  if (config.events.length > 0 && !config.events.includes(event.type)) {
    return false;
  }

  const message = formatMessage(event, config.format);

  try {
    await execFileAsync(
      "node",
      [
        OPENCLAW_BIN,
        "message",
        "send",
        "--channel",
        "discord",
        "--target",
        config.channelId,
        "--message",
        message,
      ],
      {
        timeout: 30000,
        env: { ...process.env, FORCE_COLOR: "0" },
      },
    );

    console.log(`[automation] Discord notification sent for ${event.type}`);
    return true;
  } catch (err) {
    console.error("[automation] Discord notification failed:", err);
    return false;
  }
}
