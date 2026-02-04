// ---------------------------------------------------------------------------
// Soul Loader
// ---------------------------------------------------------------------------
// Loads agent soul/prompt files from the packs directory

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoadedSoul, AgentPacksConfig } from "./types.js";
import { PACKS, findAgentById, getPack } from "./packs-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = resolve(__dirname, "..", "packs");

/**
 * Load a single agent's soul/prompt content
 */
export function loadSoul(agentId: string): LoadedSoul | null {
  const found = findAgentById(agentId);
  if (!found) return null;

  const { pack, agent } = found;
  const soulPath = resolve(PACKS_DIR, agent.soulFile);

  if (!existsSync(soulPath)) {
    return null;
  }

  const content = readFileSync(soulPath, "utf-8");

  return {
    packId: pack.id,
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    content,
    tools: agent.tools,
  };
}

/**
 * Load all souls from a specific pack
 */
export function loadPackSouls(packId: string): LoadedSoul[] {
  const pack = getPack(packId);
  if (!pack) return [];

  const souls: LoadedSoul[] = [];
  for (const agent of pack.agents) {
    const soul = loadSoul(agent.id);
    if (soul) souls.push(soul);
  }
  return souls;
}

/**
 * Load all enabled souls based on config
 */
export function loadEnabledSouls(config: AgentPacksConfig): LoadedSoul[] {
  if (!config.enabled) return [];

  const souls: LoadedSoul[] = [];
  const enabledPacks = config.enabledPacks === "all" ? PACKS.map((p) => p.id) : config.enabledPacks;

  for (const packId of enabledPacks) {
    if (config.disabledPacks.includes(packId)) continue;
    souls.push(...loadPackSouls(packId));
  }

  return souls;
}

/**
 * Get path to a soul file (for direct file access)
 */
export function getSoulPath(agentId: string): string | null {
  const found = findAgentById(agentId);
  if (!found) return null;
  return resolve(PACKS_DIR, found.agent.soulFile);
}

/**
 * List all available agent IDs
 */
export function listAllAgentIds(): string[] {
  return PACKS.flatMap((p) => p.agents.map((a) => a.id));
}

/**
 * List enabled agent IDs based on config
 */
export function listEnabledAgentIds(config: AgentPacksConfig): string[] {
  if (!config.enabled) return [];

  const enabledPacks = config.enabledPacks === "all" ? PACKS.map((p) => p.id) : config.enabledPacks;

  return PACKS.filter(
    (p) => enabledPacks.includes(p.id) && !config.disabledPacks.includes(p.id),
  ).flatMap((p) => p.agents.map((a) => a.id));
}
