#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Scout Proposal Discord Notifier
// ---------------------------------------------------------------------------
//
// Standalone script that reads ~/.openclaw/scout-proposals/registry.json,
// sends pending proposals to Discord with interactive buttons, and updates
// the registry with message IDs.
//
// Usage: node --import tsx scripts/scout-notify.ts
//    or: bun scripts/scout-notify.ts

import { ButtonStyle, Routes } from "discord-api-types/v10";
import { readBestEffortConfig } from "../src/config/config.js";
import {
  buildScoutProposalCustomId,
  readRegistry,
  type ScoutProposal,
  writeRegistry,
} from "./lib/scout-proposals.js";

// ---------------------------------------------------------------------------
// Config + Discord HTTP helpers
// ---------------------------------------------------------------------------

function readSecretValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.value === "string" && candidate.value.length > 0) {
    return candidate.value;
  }
  if (typeof candidate.plaintext === "string" && candidate.plaintext.length > 0) {
    return candidate.plaintext;
  }
  return undefined;
}

function resolveDiscordToken(cfg: unknown): string | undefined {
  if (!cfg || typeof cfg !== "object") {
    return undefined;
  }

  const root = cfg as Record<string, unknown>;
  const channels = root.channels;
  if (!channels || typeof channels !== "object") {
    return undefined;
  }

  const discord = (channels as Record<string, unknown>).discord;
  if (!discord || typeof discord !== "object") {
    return undefined;
  }

  const discordConfig = discord as Record<string, unknown>;
  const rootToken = readSecretValue(discordConfig.token) ?? readSecretValue(discordConfig.botToken);
  if (rootToken) {
    return rootToken;
  }

  const accounts = discordConfig.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }

  for (const account of Object.values(accounts as Record<string, unknown>)) {
    if (!account || typeof account !== "object") {
      continue;
    }
    const accountConfig = account as Record<string, unknown>;
    const accountToken =
      readSecretValue(accountConfig.token) ?? readSecretValue(accountConfig.botToken);
    if (accountToken) {
      return accountToken;
    }
  }

  return undefined;
}

async function sendDiscordMessage(
  channelId: string,
  token: string,
  body: { content: string; components: ReturnType<typeof buildButtonComponents> },
): Promise<{ id: string } | null> {
  const response = await fetch(`https://discord.com/api/v10${Routes.channelMessages(channelId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")) || "unknown error";
    throw new Error(`Discord API ${response.status}: ${errorText.slice(0, 600)}`);
  }

  return (await response.json()) as { id: string };
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

function isVisionProposal(proposal: ScoutProposal): boolean {
  return proposal.id.includes("vision") || proposal.title.toLowerCase().includes("vision");
}

function formatProposalMessage(proposal: ScoutProposal): string {
  const emoji = isVisionProposal(proposal) ? "\u{1f52d}" : "\u{1f50d}";
  const kind = isVisionProposal(proposal) ? "Vision Proposal" : "Scout Proposal";

  const lines = [
    `${emoji} **${kind}: ${proposal.title}**`,
    "",
    `**Problem:** ${proposal.problem}`,
    `**Solution:** ${proposal.solution}`,
    "",
    `\u{1f4ca} Effort: ${proposal.effort} | Impact: ${proposal.impact} | Risk: ${proposal.risk}`,
    `\u{1f4c1} Files: ${proposal.files}`,
    `\u{1f3f7}\u{fe0f} Verdict: GO`,
  ];
  return lines.join("\n");
}

function buildButtonComponents(proposalId: string) {
  return [
    {
      type: 1, // ACTION_ROW
      components: [
        {
          type: 2, // BUTTON
          style: ButtonStyle.Success,
          label: "Approve",
          emoji: { name: "\u2705" },
          custom_id: buildScoutProposalCustomId(proposalId, "approve"),
        },
        {
          type: 2, // BUTTON
          style: ButtonStyle.Danger,
          label: "Reject",
          emoji: { name: "\u274c" },
          custom_id: buildScoutProposalCustomId(proposalId, "reject"),
        },
        {
          type: 2, // BUTTON
          style: ButtonStyle.Secondary,
          label: "More Info",
          emoji: { name: "\u2139\ufe0f" },
          custom_id: buildScoutProposalCustomId(proposalId, "info"),
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const registry = readRegistry();

  // Find proposals that need sending (pending status, no messageId)
  const toSend = registry.proposals.filter((p) => p.status === "pending" && !p.messageId);

  if (toSend.length === 0) {
    console.log("scout-notify: no pending proposals to send");
    return;
  }

  console.log(`scout-notify: ${toSend.length} proposal(s) to send`);

  const cfg = await readBestEffortConfig();
  const discordToken = resolveDiscordToken(cfg);

  if (!discordToken) {
    throw new Error("Discord token is missing in channels.discord token/botToken config");
  }

  for (const proposal of toSend) {
    const channelId = proposal.channelId;
    if (!channelId) {
      console.error(`scout-notify: proposal ${proposal.id} has no channelId, skipping`);
      continue;
    }

    try {
      const content = formatProposalMessage(proposal);
      const components = buildButtonComponents(proposal.id);

      const message = await sendDiscordMessage(channelId, discordToken, {
        content,
        components,
      });

      if (!message?.id) {
        console.error(`scout-notify: failed to send proposal ${proposal.id} — no message ID`);
        continue;
      }

      // Update registry with message ID and status
      proposal.messageId = message.id;
      proposal.status = "notified";

      console.log(
        `scout-notify: sent proposal ${proposal.id} as message ${message.id} in ${channelId}`,
      );
    } catch (err) {
      console.error(`scout-notify: failed to send proposal ${proposal.id}: ${String(err)}`);
    }
  }

  // Persist updated registry
  writeRegistry(registry);
  console.log("scout-notify: registry updated");
}

main().catch((err) => {
  console.error(`scout-notify: fatal error: ${String(err)}`);
  process.exit(1);
});
