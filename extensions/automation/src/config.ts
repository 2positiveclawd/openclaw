// ---------------------------------------------------------------------------
// Automation Config - reads from dashboard storage
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type { Webhook, Chain, Template } from "./types.js";

const DASHBOARD_DIR = path.join(
  process.env.HOME || "/home/azureuser",
  ".openclaw/dashboard"
);

const WEBHOOKS_FILE = path.join(DASHBOARD_DIR, "webhooks.json");
const CHAINS_FILE = path.join(DASHBOARD_DIR, "chains.json");
const TEMPLATES_FILE = path.join(DASHBOARD_DIR, "templates.json");

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export function loadWebhooks(): Webhook[] {
  try {
    if (!fs.existsSync(WEBHOOKS_FILE)) return [];
    const raw = fs.readFileSync(WEBHOOKS_FILE, "utf-8");
    const webhooks = JSON.parse(raw) as Webhook[];
    return webhooks.filter((w) => w.enabled);
  } catch (err) {
    console.error("[automation] Failed to load webhooks:", err);
    return [];
  }
}

export function updateWebhookStatus(
  id: string,
  lastTriggered: number,
  lastStatus: number
): void {
  try {
    if (!fs.existsSync(WEBHOOKS_FILE)) return;
    const raw = fs.readFileSync(WEBHOOKS_FILE, "utf-8");
    const webhooks = JSON.parse(raw) as Webhook[];
    const webhook = webhooks.find((w) => w.id === id);
    if (webhook) {
      webhook.lastTriggered = lastTriggered;
      webhook.lastStatus = lastStatus;
      fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2));
    }
  } catch (err) {
    console.error("[automation] Failed to update webhook status:", err);
  }
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

export function loadChains(): Chain[] {
  try {
    if (!fs.existsSync(CHAINS_FILE)) return [];
    const raw = fs.readFileSync(CHAINS_FILE, "utf-8");
    const chains = JSON.parse(raw) as Chain[];
    return chains.filter((c) => c.enabled);
  } catch (err) {
    console.error("[automation] Failed to load chains:", err);
    return [];
  }
}

export function updateChainTriggered(id: string): void {
  try {
    if (!fs.existsSync(CHAINS_FILE)) return;
    const raw = fs.readFileSync(CHAINS_FILE, "utf-8");
    const chains = JSON.parse(raw) as Chain[];
    const chain = chains.find((c) => c.id === id);
    if (chain) {
      chain.triggeredCount = (chain.triggeredCount || 0) + 1;
      chain.lastTriggered = Date.now();
      fs.writeFileSync(CHAINS_FILE, JSON.stringify(chains, null, 2));
    }
  } catch (err) {
    console.error("[automation] Failed to update chain triggered:", err);
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function loadTemplates(): Template[] {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) return [];
    const raw = fs.readFileSync(TEMPLATES_FILE, "utf-8");
    return JSON.parse(raw) as Template[];
  } catch (err) {
    console.error("[automation] Failed to load templates:", err);
    return [];
  }
}

export function getTemplate(id: string): Template | undefined {
  const templates = loadTemplates();
  return templates.find((t) => t.id === id);
}
