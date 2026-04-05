import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import type { CronJobCreate } from "./types.js";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function makePaths() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cron-embedded-channel-lint-"));
  tempDirs.push(dir);
  return {
    root: dir,
    cronStorePath: path.join(dir, "cron", "jobs.json"),
    sessionStorePath: path.join(dir, "sessions", "sessions.json"),
  };
}

async function writeSessionStore(
  sessionStorePath: string,
  store: Record<string, Record<string, unknown>>,
) {
  await fs.mkdir(path.dirname(sessionStorePath), { recursive: true });
  await fs.writeFile(sessionStorePath, JSON.stringify(store, null, 2), "utf-8");
}

function createCron(params: { cronStorePath: string; sessionStorePath: string }) {
  return new CronService({
    cronEnabled: true,
    storePath: params.cronStorePath,
    sessionStorePath: params.sessionStorePath,
    defaultAgentId: "main",
    log: noopLogger,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
  });
}

function createMainSystemEventJob(text: string, overrides?: Partial<CronJobCreate>): CronJobCreate {
  return {
    name: "main-system-event",
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "main",
    wakeMode: "now",
    payload: { kind: "systemEvent", text },
    ...overrides,
  };
}

describe("cron main-session embedded discord channelId lint", () => {
  it("rejects add when payload.text embeds an unresolved discord channel id", async () => {
    const { cronStorePath, sessionStorePath } = await makePaths();
    await writeSessionStore(sessionStorePath, {
      "agent:main:discord:channel:1467171219265687807": {
        sessionId: "sess-known",
        updatedAt: Date.parse("2026-04-03T00:00:00.000Z"),
        channel: "discord",
        groupId: "1467171219265687807",
        lastChannel: "discord",
        lastTo: "channel:1467171219265687807",
      },
    });

    const cron = createCron({ cronStorePath, sessionStorePath });
    await expect(
      cron.add(
        createMainSystemEventJob(
          "If there is an alert, post it to #deals-watcher (channelId=1474695764696502282).",
        ),
      ),
    ).rejects.toThrow(
      'cron main-session systemEvent payload for "main-system-event" references unresolved Discord target(s): channelId=1474695764696502282.',
    );
    cron.stop();
  });

  it("allows add when payload.text embeds a known discord channel id from session store", async () => {
    const { cronStorePath, sessionStorePath } = await makePaths();
    await writeSessionStore(sessionStorePath, {
      "agent:main:discord:channel:1467171219265687807": {
        sessionId: "sess-known",
        updatedAt: Date.parse("2026-04-03T00:00:00.000Z"),
        channel: "discord",
        groupId: "1467171219265687807",
        lastChannel: "discord",
        lastTo: "channel:1467171219265687807",
      },
    });

    const cron = createCron({ cronStorePath, sessionStorePath });
    await expect(
      cron.add(
        createMainSystemEventJob(
          "If there is an alert, post it to #theatre-watch (channelId=1467171219265687807).",
        ),
      ),
    ).resolves.toMatchObject({
      payload: {
        kind: "systemEvent",
        text: "If there is an alert, post it to #theatre-watch (channelId=1467171219265687807).",
      },
    });
    cron.stop();
  });

  it("allows add when the embedded channel id matches the current session key", async () => {
    const { cronStorePath, sessionStorePath } = await makePaths();
    await writeSessionStore(sessionStorePath, {});

    const cron = createCron({ cronStorePath, sessionStorePath });
    await expect(
      cron.add(
        createMainSystemEventJob("Post follow-up to channelId=1465018940584362118.", {
          sessionKey: "agent:main:discord:channel:1465018940584362118",
        }),
      ),
    ).resolves.toMatchObject({
      sessionKey: "agent:main:discord:channel:1465018940584362118",
    });
    cron.stop();
  });

  it("rejects update before mutating the stored job", async () => {
    const { cronStorePath, sessionStorePath } = await makePaths();
    await writeSessionStore(sessionStorePath, {
      "agent:main:discord:channel:1467171219265687807": {
        sessionId: "sess-known",
        updatedAt: Date.parse("2026-04-03T00:00:00.000Z"),
        channel: "discord",
        groupId: "1467171219265687807",
        lastChannel: "discord",
        lastTo: "channel:1467171219265687807",
      },
    });

    const cron = createCron({ cronStorePath, sessionStorePath });
    const created = await cron.add(
      createMainSystemEventJob(
        "If there is an alert, post it to #theatre-watch (channelId=1467171219265687807).",
      ),
    );

    await expect(
      cron.update(created.id, {
        payload: {
          kind: "systemEvent",
          text: "Now post to channelId=1474695764696502282 instead.",
        },
      }),
    ).rejects.toThrow(
      'cron main-session systemEvent payload for "main-system-event" references unresolved Discord target(s): channelId=1474695764696502282.',
    );

    const stored = cron.getJob(created.id);
    expect(stored?.payload).toMatchObject({
      kind: "systemEvent",
      text: "If there is an alert, post it to #theatre-watch (channelId=1467171219265687807).",
    });
    cron.stop();
  });
});
