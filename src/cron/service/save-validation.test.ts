import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { setupCronServiceSuite, writeCronStoreSnapshot } from "../service.test-harness.js";
import type { CronJob } from "../types.js";
import { add, update } from "./ops.js";
import { createCronServiceState } from "./state.js";

const { logger, makeStorePath } = setupCronServiceSuite({
  prefix: "cron-service-save-validation",
});

function createBaseState(params: {
  storePath: string;
  nowMs: number;
  validateJobBeforeSave?: (job: CronJob) => Promise<void> | void;
}) {
  return createCronServiceState({
    storePath: params.storePath,
    cronEnabled: true,
    log: logger,
    nowMs: () => params.nowMs,
    validateJobBeforeSave: params.validateJobBeforeSave,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
  });
}

function createExistingIsolatedJob(nowMs: number): CronJob {
  return {
    id: "job-existing",
    name: "Existing job",
    enabled: true,
    createdAtMs: nowMs - 60_000,
    updatedAtMs: nowMs - 60_000,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: nowMs - 60_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "before" },
    state: { nextRunAtMs: nowMs + 60_000 },
  };
}

describe("cron save-time model validation hook", () => {
  it("rejects add before persisting the new job", async () => {
    const { storePath } = await makeStorePath();
    const nowMs = Date.parse("2026-04-07T17:00:00.000Z");
    await writeCronStoreSnapshot({ storePath, jobs: [] });

    const validateJobBeforeSave = vi.fn(async (job: CronJob) => {
      if (job.payload.kind === "agentTurn" && job.payload.model === "anthropic/claude-sonnet-4-6") {
        throw new Error(
          "cron payload.model 'anthropic/claude-sonnet-4-6' is not allowed by policy. Remove payload.model to use agent defaults.",
        );
      }
    });

    const state = createBaseState({
      storePath,
      nowMs,
      validateJobBeforeSave,
    });

    await expect(
      add(state, {
        name: "Blocked add",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: {
          kind: "agentTurn",
          message: "test",
          model: "anthropic/claude-sonnet-4-6",
        },
      }),
    ).rejects.toThrow("payload.model 'anthropic/claude-sonnet-4-6' is not allowed");

    expect(validateJobBeforeSave).toHaveBeenCalledOnce();
    expect(validateJobBeforeSave.mock.calls[0]?.[0]).toMatchObject({
      sessionTarget: "isolated",
      payload: {
        kind: "agentTurn",
        model: "anthropic/claude-sonnet-4-6",
      },
    });

    const persisted = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(persisted.jobs).toHaveLength(0);
  });

  it("rejects update without mutating the stored or in-memory job", async () => {
    const { storePath } = await makeStorePath();
    const nowMs = Date.parse("2026-04-07T17:00:00.000Z");
    const existingJob = createExistingIsolatedJob(nowMs);
    await writeCronStoreSnapshot({ storePath, jobs: [existingJob] });

    const validateJobBeforeSave = vi.fn(async (job: CronJob) => {
      if (job.payload.kind === "agentTurn" && job.payload.model === "anthropic/claude-sonnet-4-6") {
        throw new Error(
          "cron payload.model 'anthropic/claude-sonnet-4-6' is not allowed by policy. Remove payload.model to use agent defaults.",
        );
      }
    });

    const state = createBaseState({
      storePath,
      nowMs,
      validateJobBeforeSave,
    });

    await expect(
      update(state, "job-existing", {
        payload: {
          kind: "agentTurn",
          model: "anthropic/claude-sonnet-4-6",
        },
      }),
    ).rejects.toThrow("payload.model 'anthropic/claude-sonnet-4-6' is not allowed");

    expect(validateJobBeforeSave).toHaveBeenCalledOnce();
    expect(validateJobBeforeSave.mock.calls[0]?.[0]).toMatchObject({
      id: "job-existing",
      payload: {
        kind: "agentTurn",
        message: "before",
        model: "anthropic/claude-sonnet-4-6",
      },
    });

    const loadedJob = state.store?.jobs[0];
    expect(loadedJob?.payload).toEqual({ kind: "agentTurn", message: "before" });
    expect(loadedJob?.updatedAtMs).toBe(existingJob.updatedAtMs);

    const persisted = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
      jobs: Array<{ payload?: Record<string, unknown>; updatedAtMs?: number }>;
    };
    expect(persisted.jobs[0]?.payload).toEqual({ kind: "agentTurn", message: "before" });
    expect(persisted.jobs[0]?.updatedAtMs).toBe(existingJob.updatedAtMs);
  });
});
