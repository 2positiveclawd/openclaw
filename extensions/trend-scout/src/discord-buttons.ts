// ---------------------------------------------------------------------------
// Discord Scout Proposal Buttons
// ---------------------------------------------------------------------------
//
// Handles Approve / Reject / More Info buttons on scout proposal messages.
// Follows the ExecApprovalButton pattern: file-based registry, custom ID
// encoding, and interaction handling via @buape/carbon Button class.
//
// Registry lives at ~/.openclaw/scout-proposals/registry.json and is shared
// with scripts/scout-notify.ts which sends the initial messages.

import type { ButtonInteraction, ComponentData } from "@buape/carbon";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logDebug, logError } from "openclaw/extension-bridge";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCOUT_PROPOSAL_KEY = "scoutprop";

const REGISTRY_DIR = join(homedir(), ".openclaw", "scout-proposals");
const REGISTRY_PATH = join(REGISTRY_DIR, "registry.json");

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

export type ScoutProposal = {
  id: string;
  title: string;
  problem: string;
  solution: string;
  criteria: string[];
  effort: string;
  impact: string;
  risk: string;
  files: string;
  fullContent: string;
  channelId: string;
  messageId?: string;
  status: "pending" | "notified" | "approved" | "rejected" | "info-requested";
  createdAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  planId?: string | null;
};

export type ScoutProposalRegistry = {
  proposals: ScoutProposal[];
};

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

export function readRegistry(): ScoutProposalRegistry {
  if (!existsSync(REGISTRY_PATH)) {
    return { proposals: [] };
  }
  try {
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    return JSON.parse(raw) as ScoutProposalRegistry;
  } catch {
    return { proposals: [] };
  }
}

export function writeRegistry(registry: ScoutProposalRegistry): void {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
}

export function findProposal(id: string): ScoutProposal | undefined {
  const registry = readRegistry();
  return registry.proposals.find((p) => p.id === id);
}

export function updateProposalStatus(
  id: string,
  update: Partial<Pick<ScoutProposal, "status" | "resolvedAt" | "resolvedBy" | "planId">>,
): void {
  const registry = readRegistry();
  const proposal = registry.proposals.find((p) => p.id === id);
  if (!proposal) {
    return;
  }
  Object.assign(proposal, update);
  writeRegistry(registry);
}

// ---------------------------------------------------------------------------
// Custom ID encoding (mirrors exec-approvals.ts)
// ---------------------------------------------------------------------------

function encodeCustomIdValue(value: string): string {
  return encodeURIComponent(value);
}

function decodeCustomIdValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export type ScoutProposalAction = "approve" | "reject" | "info";

export function buildScoutProposalCustomId(
  proposalId: string,
  action: ScoutProposalAction,
): string {
  return [`${SCOUT_PROPOSAL_KEY}:id=${encodeCustomIdValue(proposalId)}`, `action=${action}`].join(
    ";",
  );
}

export function parseScoutProposalData(
  data: ComponentData,
): { proposalId: string; action: ScoutProposalAction } | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const coerce = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const rawId = coerce(data.id);
  const rawAction = coerce(data.action);
  if (!rawId || !rawAction) {
    return null;
  }
  if (rawAction !== "approve" && rawAction !== "reject" && rawAction !== "info") {
    return null;
  }
  return {
    proposalId: decodeCustomIdValue(rawId),
    action: rawAction,
  };
}

// ---------------------------------------------------------------------------
// Button component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Button interaction handler
// ---------------------------------------------------------------------------

async function handleScoutProposalInteraction(
  interaction: ButtonInteraction,
  data: Record<string, unknown>,
): Promise<void> {
  const parsed = parseScoutProposalData(data as ComponentData);
  if (!parsed) {
    try {
      await interaction.reply({
        content: "This proposal button is no longer valid.",
        ephemeral: true,
      });
    } catch {
      // Interaction may have expired
    }
    return;
  }

  const proposal = findProposal(parsed.proposalId);
  if (!proposal) {
    try {
      await interaction.reply({
        content: `Proposal ${parsed.proposalId} not found in registry.`,
        ephemeral: true,
      });
    } catch {
      // Interaction may have expired
    }
    return;
  }

  switch (parsed.action) {
    case "approve":
      await handleApprove(interaction, proposal);
      break;
    case "reject":
      await handleReject(interaction, proposal);
      break;
    case "info":
      await handleInfo(interaction, proposal);
      break;
  }
}

async function handleApprove(
  interaction: ButtonInteraction,
  proposal: ScoutProposal,
): Promise<void> {
  const user = interaction.user;
  const userName = user?.username ?? user?.id ?? "unknown";

  // Acknowledge immediately
  try {
    await interaction.update({
      content: `Approved by **${userName}** — starting planner...`,
      components: [] as any,
    });
  } catch (err) {
    logError(`scout-proposals: update failed for approve: ${String(err)}`);
  }

  // Update registry
  updateProposalStatus(proposal.id, {
    status: "approved",
    resolvedAt: new Date().toISOString(),
    resolvedBy: userName,
  });

  // Spawn planner
  const criteriaArgs = (proposal.criteria ?? []).flatMap((c) => ["--criteria", c]);
  const args = [
    "/home/azureuser/openclaw/openclaw.mjs",
    "planner",
    "start",
    "--goal",
    proposal.fullContent || `${proposal.title}\n\n${proposal.problem}\n\n${proposal.solution}`,
    ...criteriaArgs,
    "--notify-channel",
    "discord",
    "--notify-to",
    proposal.channelId,
  ];

  logDebug(`scout-proposals: spawning planner for proposal ${proposal.id}`);

  // Fire-and-forget: the planner CLI blocks until plan completes (can take
  // minutes/hours). We detach so the gateway doesn't hold the child process.
  const child = spawn("node", args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  logDebug(`scout-proposals: planner spawned for ${proposal.id} (PID ${child.pid})`);
}

async function handleReject(
  interaction: ButtonInteraction,
  proposal: ScoutProposal,
): Promise<void> {
  const user = interaction.user;
  const userName = user?.username ?? user?.id ?? "unknown";

  try {
    await interaction.update({
      content: `Rejected by **${userName}**.`,
      components: [] as any,
    });
  } catch (err) {
    logError(`scout-proposals: update failed for reject: ${String(err)}`);
  }

  updateProposalStatus(proposal.id, {
    status: "rejected",
    resolvedAt: new Date().toISOString(),
    resolvedBy: userName,
  });
}

async function handleInfo(interaction: ButtonInteraction, proposal: ScoutProposal): Promise<void> {
  // Send full proposal as ephemeral reply (only visible to clicker)
  const content =
    proposal.fullContent ||
    [
      `# ${proposal.title}`,
      "",
      `**Problem:** ${proposal.problem}`,
      `**Solution:** ${proposal.solution}`,
      "",
      `**Criteria:**`,
      ...(proposal.criteria ?? []).map((c) => `- ${c}`),
      "",
      `**Effort:** ${proposal.effort} | **Impact:** ${proposal.impact} | **Risk:** ${proposal.risk}`,
      `**Files:** ${proposal.files}`,
    ].join("\n");

  // Discord limit is 2000 chars; truncate if needed
  const truncated = content.length > 1900 ? `${content.slice(0, 1900)}\n\n*(truncated)*` : content;

  try {
    await interaction.reply({
      content: truncated,
      ephemeral: true,
    });
  } catch (err) {
    logError(`scout-proposals: reply failed for info: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Button spec factory (returns a DiscordButtonSpec, not a Button instance)
// ---------------------------------------------------------------------------

export function createScoutProposalButtonSpec(): import("openclaw/extension-bridge").DiscordButtonSpec {
  return {
    customId: `${SCOUT_PROPOSAL_KEY}:seed=1`,
    label: "scoutprop",
    defer: false,
    ephemeral: false,
    run: handleScoutProposalInteraction,
  };
}
