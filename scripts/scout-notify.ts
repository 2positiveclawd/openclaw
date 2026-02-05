#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Scout Proposal Discord Notifier
// ---------------------------------------------------------------------------
//
// Standalone script that reads ~/.openclaw/scout-proposals/registry.json,
// sends pending proposals to Discord with interactive buttons, and updates
// the registry with message IDs.
//
// Usage: bun scripts/scout-notify.ts
//    or: node --import tsx scripts/scout-notify.ts

import { ButtonStyle, Routes } from "discord-api-types/v10";
import {
  buildScoutProposalCustomId,
  readRegistry,
  writeRegistry,
  type ScoutProposal,
} from "../extensions/trend-scout/src/discord-buttons.js";
import { loadConfig } from "../src/config/config.js";
import { createDiscordClient } from "../src/discord/send.shared.js";

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

  const cfg = loadConfig();
  const { rest, request } = createDiscordClient({}, cfg);

  for (const proposal of toSend) {
    const channelId = proposal.channelId;
    if (!channelId) {
      console.error(`scout-notify: proposal ${proposal.id} has no channelId, skipping`);
      continue;
    }

    try {
      const content = formatProposalMessage(proposal);
      const components = buildButtonComponents(proposal.id);

      const message = (await request(
        () =>
          rest.post(Routes.channelMessages(channelId), {
            body: { content, components },
          }) as Promise<{ id: string }>,
        "scout-notify",
      )) as { id: string } | null;

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
