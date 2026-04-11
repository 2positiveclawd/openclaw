import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempHomes: string[] = [];

afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-scout-notify-"));
  tempHomes.push(dir);
  return dir;
}

describe("scripts/scout-notify.ts smoke", () => {
  it("runs with node + tsx without extension source imports", () => {
    const missingExtensionSource = path.join(
      process.cwd(),
      "extensions",
      "trend-scout",
      "src",
      "discord-buttons.js",
    );

    expect(fs.existsSync(missingExtensionSource)).toBe(false);

    const tempHome = makeTempHome();
    const registryPath = path.join(tempHome, ".openclaw", "scout-proposals", "registry.json");
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, '{"proposals":[]}\n', "utf8");

    const stdout = execFileSync(process.execPath, ["--import", "tsx", "scripts/scout-notify.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: tempHome,
      },
      encoding: "utf8",
    });

    expect(stdout).toContain("scout-notify: no pending proposals to send");
  });

  it("tolerates legacy-invalid config snapshots when Discord token is readable", () => {
    const tempHome = makeTempHome();

    const registryPath = path.join(tempHome, ".openclaw", "scout-proposals", "registry.json");
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        {
          proposals: [
            {
              id: "legacy-config-proposal",
              title: "Legacy config test",
              problem: "test",
              solution: "test",
              criteria: [],
              effort: "low",
              impact: "low",
              risk: "low",
              files: "scripts/scout-notify.ts",
              status: "pending",
              createdAt: "2026-04-08T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const configPath = path.join(tempHome, ".openclaw", "openclaw.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          channels: {
            discord: {
              token: "test-token",
              guilds: {
                "123": {
                  channels: {
                    "456": {
                      allow: true,
                    },
                  },
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/scout-notify.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: tempHome,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("scout-notify: 1 proposal(s) to send");
    expect(result.stdout).toContain("scout-notify: registry updated");
    expect(result.stderr).toContain("has no channelId, skipping");
    expect(result.stderr).not.toContain("fatal error");
  }, 180_000);
});
