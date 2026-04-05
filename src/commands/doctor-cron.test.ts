import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import * as noteModule from "../terminal/note.js";
import { maybeRepairLegacyCronStore } from "./doctor-cron.js";

let tempRoot: string | null = null;

async function makeTempStorePath() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-doctor-cron-"));
  return path.join(tempRoot, "cron", "jobs.json");
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function makePrompter(confirmResult = true) {
  return {
    confirm: vi.fn().mockResolvedValue(confirmResult),
  };
}

describe("maybeRepairLegacyCronStore", () => {
  it("repairs legacy cron store fields and migrates notify fallback to webhook delivery", async () => {
    const storePath = await makeTempStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              jobId: "legacy-job",
              name: "Legacy job",
              notify: true,
              createdAtMs: Date.parse("2026-02-01T00:00:00.000Z"),
              updatedAtMs: Date.parse("2026-02-02T00:00:00.000Z"),
              schedule: { kind: "cron", cron: "0 7 * * *", tz: "UTC" },
              payload: {
                kind: "systemEvent",
                text: "Morning brief",
              },
              state: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    const cfg: OpenClawConfig = {
      cron: {
        store: storePath,
        webhook: "https://example.invalid/cron-finished",
      },
    };

    await maybeRepairLegacyCronStore({
      cfg,
      options: {},
      prompter: makePrompter(true),
    });

    const persisted = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
      jobs: Array<Record<string, unknown>>;
    };
    const [job] = persisted.jobs;
    expect(job?.jobId).toBeUndefined();
    expect(job?.id).toBe("legacy-job");
    expect(job?.notify).toBeUndefined();
    expect(job?.schedule).toMatchObject({
      kind: "cron",
      expr: "0 7 * * *",
      tz: "UTC",
    });
    expect(job?.delivery).toMatchObject({
      mode: "webhook",
      to: "https://example.invalid/cron-finished",
    });
    expect(job?.payload).toMatchObject({
      kind: "systemEvent",
      text: "Morning brief",
    });

    expect(noteSpy).toHaveBeenCalledWith(
      expect.stringContaining("Legacy cron job storage detected"),
      "Cron",
    );
    expect(noteSpy).toHaveBeenCalledWith(
      expect.stringContaining("Cron store normalized"),
      "Doctor changes",
    );
  });

  it("warns instead of replacing announce delivery for notify fallback jobs", async () => {
    const storePath = await makeTempStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "notify-and-announce",
              name: "Notify and announce",
              notify: true,
              createdAtMs: Date.parse("2026-02-01T00:00:00.000Z"),
              updatedAtMs: Date.parse("2026-02-02T00:00:00.000Z"),
              schedule: { kind: "every", everyMs: 60_000 },
              sessionTarget: "isolated",
              wakeMode: "now",
              payload: { kind: "agentTurn", message: "Status" },
              delivery: { mode: "announce", channel: "telegram", to: "123" },
              state: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});

    await maybeRepairLegacyCronStore({
      cfg: {
        cron: {
          store: storePath,
          webhook: "https://example.invalid/cron-finished",
        },
      },
      options: { nonInteractive: true },
      prompter: makePrompter(true),
    });

    const persisted = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(persisted.jobs[0]?.notify).toBe(true);
    expect(noteSpy).toHaveBeenCalledWith(
      expect.stringContaining('uses legacy notify fallback alongside delivery mode "announce"'),
      "Doctor warnings",
    );
  });

  it("does not auto-repair in non-interactive mode without explicit repair approval", async () => {
    const storePath = await makeTempStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              jobId: "legacy-job",
              name: "Legacy job",
              notify: true,
              createdAtMs: Date.parse("2026-02-01T00:00:00.000Z"),
              updatedAtMs: Date.parse("2026-02-02T00:00:00.000Z"),
              schedule: { kind: "cron", cron: "0 7 * * *", tz: "UTC" },
              payload: {
                kind: "systemEvent",
                text: "Morning brief",
              },
              state: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    const prompter = makePrompter(false);

    await maybeRepairLegacyCronStore({
      cfg: {
        cron: {
          store: storePath,
          webhook: "https://example.invalid/cron-finished",
        },
      },
      options: { nonInteractive: true },
      prompter,
    });

    const persisted = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(prompter.confirm).toHaveBeenCalledWith({
      message: "Repair legacy cron jobs now?",
      initialValue: true,
    });
    expect(persisted.jobs[0]?.jobId).toBe("legacy-job");
    expect(persisted.jobs[0]?.notify).toBe(true);
    expect(noteSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Cron store normalized"),
      "Doctor changes",
    );
  });

  it("migrates notify fallback none delivery jobs to cron.webhook", async () => {
    const storePath = await makeTempStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "notify-none",
              name: "Notify none",
              notify: true,
              createdAtMs: Date.parse("2026-02-01T00:00:00.000Z"),
              updatedAtMs: Date.parse("2026-02-02T00:00:00.000Z"),
              schedule: { kind: "every", everyMs: 60_000 },
              payload: {
                kind: "systemEvent",
                text: "Status",
              },
              delivery: { mode: "none", to: "123456789" },
              state: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    await maybeRepairLegacyCronStore({
      cfg: {
        cron: {
          store: storePath,
          webhook: "https://example.invalid/cron-finished",
        },
      },
      options: {},
      prompter: makePrompter(true),
    });

    const persisted = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(persisted.jobs[0]?.notify).toBeUndefined();
    expect(persisted.jobs[0]?.delivery).toMatchObject({
      mode: "webhook",
      to: "https://example.invalid/cron-finished",
    });
  });

  it("warns about unresolved embedded discord channel ids even without legacy issues", async () => {
    const storePath = await makeTempStorePath();
    const sessionStorePath = path.join(tempRoot!, "sessions", "sessions.json");
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.mkdir(path.dirname(sessionStorePath), { recursive: true });
    await fs.writeFile(
      sessionStorePath,
      JSON.stringify(
        {
          "agent:main:discord:channel:1467171219265687807": {
            sessionId: "sess-known",
            updatedAt: Date.parse("2026-02-02T00:00:00.000Z"),
            channel: "discord",
            groupId: "1467171219265687807",
            lastChannel: "discord",
            lastTo: "channel:1467171219265687807",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "bad-main-job",
              name: "Bad main job",
              createdAtMs: Date.parse("2026-02-01T00:00:00.000Z"),
              updatedAtMs: Date.parse("2026-02-02T00:00:00.000Z"),
              schedule: { kind: "every", everyMs: 60_000 },
              sessionTarget: "main",
              wakeMode: "now",
              sessionKey: "agent:main:discord:channel:1465018940584362118",
              payload: {
                kind: "systemEvent",
                text: "If alert, post to #deals-watcher (channelId=1474695764696502282).",
              },
              state: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    const prompter = makePrompter(true);

    await maybeRepairLegacyCronStore({
      cfg: {
        cron: {
          store: storePath,
        },
        session: {
          store: sessionStorePath,
        },
      },
      options: {},
      prompter,
    });

    expect(prompter.confirm).toHaveBeenCalledTimes(1);
    expect(noteSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cron job "Bad main job" embeds unresolved Discord target(s) in payload.text: channelId=1474695764696502282.',
      ),
      "Doctor warnings",
    );
  });

  it("warns when a known embedded discord channel id is paired with Unknown Channel runtime errors", async () => {
    const storePath = await makeTempStorePath();
    const sessionStorePath = path.join(tempRoot!, "sessions", "sessions.json");
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.mkdir(path.dirname(sessionStorePath), { recursive: true });
    await fs.writeFile(
      sessionStorePath,
      JSON.stringify(
        {
          "agent:main:discord:channel:1474695764696502282": {
            sessionId: "sess-known",
            updatedAt: Date.parse("2026-02-02T00:00:00.000Z"),
            channel: "discord",
            groupId: "1474695764696502282",
            lastChannel: "discord",
            lastTo: "channel:1474695764696502282",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    await fs.writeFile(
      storePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              id: "failing-main-job",
              name: "Failing main job",
              createdAtMs: Date.parse("2026-02-01T00:00:00.000Z"),
              updatedAtMs: Date.parse("2026-02-02T00:00:00.000Z"),
              schedule: { kind: "every", everyMs: 60_000 },
              sessionTarget: "main",
              wakeMode: "now",
              sessionKey: "agent:main:discord:channel:1465018940584362118",
              payload: {
                kind: "systemEvent",
                text: "If alert, post to #deals-watcher (channelId=1474695764696502282).",
              },
              state: {
                lastError: "Unknown Channel",
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});

    await maybeRepairLegacyCronStore({
      cfg: {
        cron: {
          store: storePath,
        },
        session: {
          store: sessionStorePath,
        },
      },
      options: {},
      prompter: makePrompter(true),
    });

    expect(noteSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cron job "Failing main job" embeds Discord target hint(s) in payload.text (channelId=1474695764696502282) and is currently failing with lastError: Unknown Channel.',
      ),
      "Doctor warnings",
    );
  });
});
