import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseProviderArgs, readSecretFromTerminal, webhookUrlFor } from "./billing-providers.mjs";

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The address printed for the provider's dashboard (`spec/payment-providers.md` §2.2).
 *
 * The application origin is the public host; the service's own route is `/billing/...`,
 * and the web container proxies `/api/` to it. Without the prefix the provider's POST
 * lands in the app's fallback page, gets 200 and changes nothing — the silent failure
 * this test exists for.
 */
describe("billing:providers webhook-url", () => {
  it("prints the public address under /api", () => {
    expect(webhookUrlFor("https://app.stage.remuka.ru", { id: "conn-1", webhookToken: "tok" })).toBe(
      "https://app.stage.remuka.ru/api/billing/webhooks/conn-1/tok",
    );
  });

  it("drops a trailing slash and falls back to the dev origin", () => {
    expect(webhookUrlFor("https://app.example.test/", { id: "c", webhookToken: "t" })).toBe(
      "https://app.example.test/api/billing/webhooks/c/t",
    );
    expect(webhookUrlFor(undefined, { id: "c", webhookToken: "t" })).toBe(
      "http://localhost:5173/api/billing/webhooks/c/t",
    );
  });
});

/**
 * `verify` and `secret` are the operator's only way to test and rotate a shop key on the
 * server. Both are pure parses: a typo stops before a database connection, and a key can
 * never be typed as an argument.
 */
describe("billing:providers verify and secret", () => {
  const id = "2f1a6c3e-5b7d-4c8a-9e0f-1a2b3c4d5e6f";

  it("parses verify as a read: one id, no actor", () => {
    expect(parseProviderArgs(["verify", id])).toEqual({ command: "verify", id });
    expect(() => parseProviderArgs(["verify", id, "--reason", "x"])).toThrow(/does not take --reason/);
  });

  it("parses secret with a file and an optional reason", () => {
    expect(parseProviderArgs(["secret", id, "--secret-file", "/tmp/k.json", "--reason", "rotation", "--as", "ops@example.com"]))
      .toEqual({
        command: "secret",
        id,
        secretFile: "/tmp/k.json",
        reason: "rotation",
        as: "ops@example.com",
      });
    expect(parseProviderArgs(["secret", id]).secretFile).toBeNull();
  });

  it("refuses a key typed on the command line", () => {
    expect(() => parseProviderArgs(["secret", id, '{"shopId":"1"}'])).toThrow(
      /the key comes from --secret-file or a prompt/,
    );
    expect(() => parseProviderArgs(["secret", id, "--secret", "value"])).toThrow(/does not take --secret/);
  });

  it("will not read a hidden key from a pipeline", async () => {
    await expect(readSecretFromTerminal({ input: { isTTY: false } })).rejects.toThrow(
      /secret needs a terminal/,
    );
  });

  /**
   * Reading the table is not a secret operation. The KEK used to be demanded before the
   * database was even opened, which made `list` impossible on a host that had none; this
   * pins the lazy rule: the first missing thing is DATABASE_URL, never REMO_KEK.
   */
  it("lets list fail on the database, not on the KEK", async () => {
    const result = await run(process.execPath, ["scripts/billing-providers.mjs", "list"], {
      cwd: ROOT,
      env: { ...process.env, REMO_KEK: "", DATABASE_URL: "" },
    }).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("DATABASE_URL is required");
    expect(output).not.toContain("REMO_KEK is required");
  });
});
