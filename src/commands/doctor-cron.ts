import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { formatCliCommand } from "../cli/command-format.js";
import type { OpenClawConfig } from "../config/config.js";
import { loadSessionStore } from "../config/sessions.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { normalizeStoredCronJobs } from "../cron/store-migration.js";
import { resolveCronStorePath, loadCronStore, saveCronStore } from "../cron/store.js";
import {
  collectKnownDiscordChannelIdsForSessionKey,
  collectKnownDiscordChannelIdsFromSessionStore,
  extractEmbeddedDiscordChannelIds,
} from "../cron/system-event-channel-id-lint.js";
import type { CronJob } from "../cron/types.js";
import { note } from "../terminal/note.js";
import { shortenHomePath } from "../utils.js";
import type { DoctorPrompter, DoctorOptions } from "./doctor-prompter.js";

type CronDoctorOutcome = {
  changed: boolean;
  warnings: string[];
};

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatLegacyIssuePreview(issues: Partial<Record<string, number>>): string[] {
  const lines: string[] = [];
  if (issues.jobId) {
    lines.push(`- ${pluralize(issues.jobId, "job")} still uses legacy \`jobId\``);
  }
  if (issues.legacyScheduleString) {
    lines.push(
      `- ${pluralize(issues.legacyScheduleString, "job")} stores schedule as a bare string`,
    );
  }
  if (issues.legacyScheduleCron) {
    lines.push(`- ${pluralize(issues.legacyScheduleCron, "job")} still uses \`schedule.cron\``);
  }
  if (issues.legacyPayloadKind) {
    lines.push(`- ${pluralize(issues.legacyPayloadKind, "job")} needs payload kind normalization`);
  }
  if (issues.legacyPayloadProvider) {
    lines.push(
      `- ${pluralize(issues.legacyPayloadProvider, "job")} still uses payload \`provider\` as a delivery alias`,
    );
  }
  if (issues.legacyTopLevelPayloadFields) {
    lines.push(
      `- ${pluralize(issues.legacyTopLevelPayloadFields, "job")} still uses top-level payload fields`,
    );
  }
  if (issues.legacyTopLevelDeliveryFields) {
    lines.push(
      `- ${pluralize(issues.legacyTopLevelDeliveryFields, "job")} still uses top-level delivery fields`,
    );
  }
  if (issues.legacyDeliveryMode) {
    lines.push(
      `- ${pluralize(issues.legacyDeliveryMode, "job")} still uses delivery mode \`deliver\``,
    );
  }
  return lines;
}

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findEmbeddedDiscordChannelLintWarnings(params: {
  cfg: OpenClawConfig;
  jobs: Array<Record<string, unknown>>;
}): string[] {
  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const sessionStorePath = resolveStorePath(params.cfg.session?.store, {
    agentId: defaultAgentId,
  });
  const sessionStore = loadSessionStore(sessionStorePath, { skipCache: true });
  const baseKnownDiscordChannelIds = collectKnownDiscordChannelIdsFromSessionStore(sessionStore);
  const warnings: string[] = [];

  for (const raw of params.jobs) {
    const payload = raw.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    if ((payload as { kind?: unknown }).kind !== "systemEvent") {
      continue;
    }
    const text = trimString((payload as { text?: unknown }).text);
    if (!text) {
      continue;
    }

    const sessionTarget = trimString(raw.sessionTarget)?.toLowerCase() ?? "main";
    if (sessionTarget !== "main") {
      continue;
    }

    const knownDiscordChannelIds = new Set(baseKnownDiscordChannelIds);
    const sessionKey = trimString(raw.sessionKey);
    for (const id of collectKnownDiscordChannelIdsForSessionKey({
      store: sessionStore,
      sessionKey,
    })) {
      knownDiscordChannelIds.add(id);
    }

    const allEmbeddedIds = extractEmbeddedDiscordChannelIds(text);
    if (allEmbeddedIds.length === 0) {
      continue;
    }

    const unresolved = allEmbeddedIds.filter((id) => !knownDiscordChannelIds.has(id));
    const jobName =
      trimString(raw.name) ?? trimString(raw.id) ?? trimString(raw.jobId) ?? "<unnamed>";
    if (unresolved.length > 0) {
      warnings.push(
        `Cron job "${jobName}" embeds unresolved Discord target(s) in payload.text: ${unresolved
          .map((id) => `channelId=${id}`)
          .join(", ")}.`,
      );
      continue;
    }

    const stateRecord =
      raw.state && typeof raw.state === "object" && !Array.isArray(raw.state)
        ? (raw.state as Record<string, unknown>)
        : null;
    const lastError = trimString(stateRecord?.lastError);
    if (lastError && /unknown channel/i.test(lastError)) {
      warnings.push(
        `Cron job "${jobName}" embeds Discord target hint(s) in payload.text (${allEmbeddedIds
          .map((id) => `channelId=${id}`)
          .join(", ")}) and is currently failing with lastError: ${lastError}.`,
      );
    }
  }

  return warnings;
}

function migrateLegacyNotifyFallback(params: {
  jobs: Array<Record<string, unknown>>;
  legacyWebhook?: string;
}): CronDoctorOutcome {
  let changed = false;
  const warnings: string[] = [];

  for (const raw of params.jobs) {
    if (!("notify" in raw)) {
      continue;
    }

    const jobName = trimString(raw.name) ?? trimString(raw.id) ?? "<unnamed>";
    const notify = raw.notify === true;
    if (!notify) {
      delete raw.notify;
      changed = true;
      continue;
    }

    const delivery =
      raw.delivery && typeof raw.delivery === "object" && !Array.isArray(raw.delivery)
        ? (raw.delivery as Record<string, unknown>)
        : null;
    const mode = trimString(delivery?.mode)?.toLowerCase();
    const to = trimString(delivery?.to);

    if (mode === "webhook" && to) {
      delete raw.notify;
      changed = true;
      continue;
    }

    if ((mode === undefined || mode === "none" || mode === "webhook") && params.legacyWebhook) {
      raw.delivery = {
        ...delivery,
        mode: "webhook",
        to: mode === "none" ? params.legacyWebhook : (to ?? params.legacyWebhook),
      };
      delete raw.notify;
      changed = true;
      continue;
    }

    if (!params.legacyWebhook) {
      warnings.push(
        `Cron job "${jobName}" still uses legacy notify fallback, but cron.webhook is unset so doctor cannot migrate it automatically.`,
      );
      continue;
    }

    warnings.push(
      `Cron job "${jobName}" uses legacy notify fallback alongside delivery mode "${mode}". Migrate it manually so webhook delivery does not replace existing announce behavior.`,
    );
  }

  return { changed, warnings };
}

export async function maybeRepairLegacyCronStore(params: {
  cfg: OpenClawConfig;
  options: DoctorOptions;
  prompter: Pick<DoctorPrompter, "confirm">;
}) {
  const storePath = resolveCronStorePath(params.cfg.cron?.store);
  const store = await loadCronStore(storePath);
  const rawJobs = (store.jobs ?? []) as unknown as Array<Record<string, unknown>>;
  if (rawJobs.length === 0) {
    return;
  }

  const normalized = normalizeStoredCronJobs(rawJobs);
  const legacyWebhook = trimString(params.cfg.cron?.webhook);
  const notifyCount = rawJobs.filter((job) => job.notify === true).length;
  const previewLines = formatLegacyIssuePreview(normalized.issues);
  const embeddedLintWarnings = findEmbeddedDiscordChannelLintWarnings({
    cfg: params.cfg,
    jobs: rawJobs,
  });
  if (notifyCount > 0) {
    previewLines.push(
      `- ${pluralize(notifyCount, "job")} still uses legacy \`notify: true\` webhook fallback`,
    );
  }
  if (previewLines.length === 0) {
    if (embeddedLintWarnings.length > 0) {
      note(embeddedLintWarnings.join("\n"), "Doctor warnings");
    }
    return;
  }

  note(
    [
      `Legacy cron job storage detected at ${shortenHomePath(storePath)}.`,
      ...previewLines,
      `Repair with ${formatCliCommand("openclaw doctor --fix")} to normalize the store before the next scheduler run.`,
    ].join("\n"),
    "Cron",
  );

  const shouldRepair = await params.prompter.confirm({
    message: "Repair legacy cron jobs now?",
    initialValue: true,
  });
  if (!shouldRepair) {
    return;
  }

  const notifyMigration = migrateLegacyNotifyFallback({
    jobs: rawJobs,
    legacyWebhook,
  });
  const changed = normalized.mutated || notifyMigration.changed;
  if (!changed && notifyMigration.warnings.length === 0) {
    return;
  }

  if (changed) {
    await saveCronStore(storePath, {
      version: 1,
      jobs: rawJobs as unknown as CronJob[],
    });
    note(`Cron store normalized at ${shortenHomePath(storePath)}.`, "Doctor changes");
  }

  const doctorWarnings = [...notifyMigration.warnings, ...embeddedLintWarnings];
  if (doctorWarnings.length > 0) {
    note(doctorWarnings.join("\n"), "Doctor warnings");
  }
}
