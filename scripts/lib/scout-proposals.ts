import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ScoutProposalAction = "approve" | "reject" | "info";

export type ScoutProposalStatus = "pending" | "notified" | "approved" | "rejected" | (string & {});

export interface ScoutProposal {
  id: string;
  title: string;
  problem: string;
  solution: string;
  criteria: string[];
  effort: string;
  impact: string;
  risk: string;
  files: string;
  status: ScoutProposalStatus;
  createdAt: string;
  fullContent?: string;
  channelId?: string;
  messageId?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface ScoutProposalRegistry {
  proposals: ScoutProposal[];
}

const SCOUT_PROPOSAL_ID_PREFIX = "scoutprop:";
const DEFAULT_REGISTRY_PATH = join(homedir(), ".openclaw", "scout-proposals", "registry.json");

export function buildScoutProposalCustomId(
  proposalId: string,
  action: ScoutProposalAction,
): string {
  return `${SCOUT_PROPOSAL_ID_PREFIX}id=${proposalId};action=${action}`;
}

function isScoutProposal(value: unknown): value is ScoutProposal {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.problem === "string" &&
    typeof candidate.solution === "string" &&
    Array.isArray(candidate.criteria) &&
    typeof candidate.effort === "string" &&
    typeof candidate.impact === "string" &&
    typeof candidate.risk === "string" &&
    typeof candidate.files === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string"
  );
}

export function readRegistry(path = DEFAULT_REGISTRY_PATH): ScoutProposalRegistry {
  if (!existsSync(path)) {
    return { proposals: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { proposals: [] };
  }

  if (!parsed || typeof parsed !== "object") {
    return { proposals: [] };
  }

  const proposals = (parsed as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) {
    return { proposals: [] };
  }

  return {
    proposals: proposals.filter(isScoutProposal),
  };
}

export function writeRegistry(registry: ScoutProposalRegistry, path = DEFAULT_REGISTRY_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}
