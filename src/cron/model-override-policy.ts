import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import { resolveAllowedModelRef, resolveConfiguredModelRef } from "../agents/model-selection.js";
import type { OpenClawConfig } from "../config/config.js";
import type { CronJob } from "./types.js";

type CronJobModelCandidate = Pick<CronJob, "sessionTarget" | "payload"> &
  Partial<Pick<CronJob, "id" | "name">>;

export type CronPayloadModelIssue = {
  model: string;
  reason: "not-allowed" | "invalid";
  message: string;
};

function isIsolatedLikeSessionTarget(sessionTarget: string | undefined): boolean {
  return (
    sessionTarget === "isolated" ||
    sessionTarget === "current" ||
    (typeof sessionTarget === "string" && sessionTarget.startsWith("session:"))
  );
}

function resolvePayloadModelOverride(job: CronJobModelCandidate): string | undefined {
  if (!isIsolatedLikeSessionTarget(job.sessionTarget)) {
    return undefined;
  }
  if (job.payload.kind !== "agentTurn") {
    return undefined;
  }
  const model = typeof job.payload.model === "string" ? job.payload.model.trim() : "";
  return model.length > 0 ? model : undefined;
}

export async function resolveCronPayloadModelIssue(params: {
  cfg: OpenClawConfig;
  job: CronJobModelCandidate;
}): Promise<CronPayloadModelIssue | null> {
  const model = resolvePayloadModelOverride(params.job);
  if (!model) {
    return null;
  }

  const catalog = await loadModelCatalog({ config: params.cfg });
  const resolvedDefault = resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const resolved = resolveAllowedModelRef({
    cfg: params.cfg,
    catalog,
    raw: model,
    defaultProvider: resolvedDefault.provider,
    defaultModel: resolvedDefault.model,
  });

  if (!("error" in resolved)) {
    return null;
  }

  if (resolved.error.startsWith("model not allowed:")) {
    return {
      model,
      reason: "not-allowed",
      message: `cron payload.model '${model}' is not allowed by policy`,
    };
  }

  return {
    model,
    reason: "invalid",
    message: `invalid cron payload.model '${model}': ${resolved.error}`,
  };
}

export async function assertCronPayloadModelAllowed(params: {
  cfg: OpenClawConfig;
  job: CronJobModelCandidate;
}): Promise<void> {
  const issue = await resolveCronPayloadModelIssue(params);
  if (!issue) {
    return;
  }
  throw new Error(`${issue.message}. Remove payload.model to use agent defaults.`);
}
