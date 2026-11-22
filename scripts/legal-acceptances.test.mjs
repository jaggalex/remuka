import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { USAGE, formatAcceptances } from "./legal-acceptances.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(args) {
  return spawnSync(process.execPath, ["scripts/legal-acceptances.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" },
  });
}

describe("pnpm legal:acceptances (ADR-256 §4)", () => {
  it("prints one deterministic line per acceptance", () => {
    const lines = formatAcceptances([
      {
        zone: "ru",
        doc: "offer",
        version: 2,
        sha256: "a".repeat(64),
        accepted_at: new Date("2026-11-22T12:00:00Z"),
        ip_hash: "b".repeat(64),
        user_agent: "Mozilla/5.0",
        event: "accept",
      },
      {
        zone: "ru",
        doc: "consent",
        version: 1,
        sha256: "c".repeat(64),
        accepted_at: new Date("2026-11-22T12:00:01Z"),
        ip_hash: null,
        user_agent: null,
        event: "withdraw",
      },
    ]);
    expect(lines).toEqual([
      `2026-11-22T12:00:00.000Z  ru/offer v2  sha256:${"a".repeat(64)}  accept  ip-digest agent=Mozilla/5.0`,
      `2026-11-22T12:00:01.000Z  ru/consent v1  sha256:${"c".repeat(64)}  withdraw  no-ip`,
    ]);
  });

  it("explains itself instead of touching the database without a user id", () => {
    const result = run([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--user <user-id>");
    expect(result.stderr).toContain(USAGE);
  });

  it("refuses an id that is not a uuid and is read-only", () => {
    const result = run(["--user", "someone"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--user must be a user id (uuid)");
    // No database was opened, so nothing could have been written.
    expect(result.stdout).toBe("");
  });
});
