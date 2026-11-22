import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/**
 * The shell refuses an unnamed operator before it asks for anything else (ADR-259
 * amendment).
 *
 * The unit tests prove the command bodies; this one proves the entry points a person
 * actually types: the process exits non-zero, names `--as`, and never reaches the
 * database or the KEK.
 */
const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORG = "2f1a6c3e-5b7d-4c8a-9e0f-1a2b3c4d5e6f";

async function refuse(args) {
  try {
    const result = await run(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, REMO_OPERATOR: "", REMO_KEK: "", DATABASE_URL: "" },
      timeout: 20_000,
    });
    return { code: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    return { code: error.code ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

describe("an unnamed operator is refused by every money command", () => {
  it("billing:grant", async () => {
    const result = await refuse(["scripts/billing-grant.mjs", "--org", ORG, "--end"]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("--as");
  });

  it("billing:prices", async () => {
    const result = await refuse(["scripts/billing-prices.mjs", "publish", "pro-rub-month-v1"]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("--as");
  });

  it("billing:providers", async () => {
    const result = await refuse([
      "scripts/billing-providers.mjs",
      "create",
      "--provider",
      "manual",
      "--mode",
      "test",
      "--currency",
      "RUB",
      "--groups",
      "invoice",
      "--name",
      "Invoice",
    ]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("--as");
  });

  it("billing:mark-paid", async () => {
    const result = await refuse([
      "scripts/billing-mark-paid.mjs",
      ORG,
      "--reason",
      "bank transfer",
    ]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("--as");
  });

  it("pulse:peer:revoke", async () => {
    const result = await refuse([
      "scripts/pulse-peer-revoke.mjs",
      "--origin",
      "https://app.example.test",
      "--reason",
      "zones split",
    ]);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("--as");
  });
});
