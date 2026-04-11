import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildScoutProposalCustomId,
  readRegistry,
  type ScoutProposalRegistry,
  writeRegistry,
} from "../../scripts/lib/scout-proposals.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-scout-proposals-"));
  tempDirs.push(dir);
  return dir;
}

describe("scripts/lib/scout-proposals", () => {
  it("builds stable button ids", () => {
    expect(buildScoutProposalCustomId("p-123", "approve")).toBe(
      "scoutprop:id=p-123;action=approve",
    );
    expect(buildScoutProposalCustomId("p-123", "reject")).toBe("scoutprop:id=p-123;action=reject");
    expect(buildScoutProposalCustomId("p-123", "info")).toBe("scoutprop:id=p-123;action=info");
  });

  it("reads and writes registry json", () => {
    const root = makeTempDir();
    const registryPath = path.join(root, "registry.json");
    const registry: ScoutProposalRegistry = {
      proposals: [
        {
          id: "p-001",
          title: "A",
          problem: "B",
          solution: "C",
          criteria: ["D"],
          effort: "LOW",
          impact: "HIGH",
          risk: "LOW",
          files: "scripts/scout-notify.ts",
          status: "pending",
          createdAt: "2026-04-06T00:00:00Z",
        },
      ],
    };

    writeRegistry(registry, registryPath);

    expect(readRegistry(registryPath)).toEqual(registry);
  });

  it("returns empty registry when file is missing", () => {
    const root = makeTempDir();
    expect(readRegistry(path.join(root, "missing.json"))).toEqual({ proposals: [] });
  });
});
