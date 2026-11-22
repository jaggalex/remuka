import { beforeEach, describe, expect, it } from "vitest";
import { resetFailures } from "./attempts.mjs";
import {
  CLI_MFA_ATTEMPTS,
  assertOperatorCliMfa,
  operatorCliMfaDisabled,
} from "./operator-cli-mfa.mjs";
import { normalizeRecoveryCode, totpCode, totpStep } from "./mfa.mjs";

/**
 * `spec/operator-actions.md` §5: money and measure commands ask the acting operator for a
 * code, five wrong ones close the group for fifteen minutes, and a stand may switch the
 * prompt off — only a stand.
 *
 * The failures are rows (`mfa_cli_attempts`), so `resetFailures()` between attempts stands
 * for a new `pnpm billing:*` process: the in-memory limiter forgets everything, the database
 * does not. That is exactly D1 in `spec/stage-operator-acceptance.md`.
 */
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const actor = { id: "11111111-1111-4111-8111-111111111111", email: "ops@example.test" };
const KEK = { key: Buffer.alloc(32), id: "v1" };

function fakeStore({ enrolled = true, accepted = "123456", recovery = null } = {}) {
  const calls = [];
  // The database stand-in: one row of `mfa_cli_attempts` per wrong answer.
  const failures = [];
  const table = [];
  return {
    calls,
    failures,
    table,
    async mfaStatus() {
      return { enrolled };
    },
    async countCliMfaFailures({ userId, since }) {
      table.push(["count", userId, since]);
      return failures.filter((at) => at > since).length;
    },
    async recordCliMfaFailure({ userId, at }) {
      table.push(["record", userId, at]);
      failures.push(at);
      return { id: failures.length, at };
    },
    async clearCliMfaFailures(userId) {
      table.push(["clear", userId]);
      failures.length = 0;
    },
    async verifyMfaCode({ code, userId }) {
      calls.push(["totp", userId, code]);
      return code === accepted ? { ok: true, step: 1 } : { ok: false, reason: "mismatch" };
    },
    async verifyMfaRecoveryCode({ code, userId }) {
      calls.push(["recovery", userId, code]);
      return recovery && normalizeRecoveryCode(code) === recovery
        ? { ok: true, remaining: 4 }
        : { ok: false, reason: "mismatch" };
    },
  };
}

beforeEach(() => resetFailures());

describe("operatorCliMfaDisabled", () => {
  it("switches the check off only on a stand", () => {
    expect(operatorCliMfaDisabled({ REMO_OPERATOR_CLI_MFA: "0", REMO_STAGE: "1" })).toBe(true);
    expect(operatorCliMfaDisabled({ REMO_OPERATOR_CLI_MFA: "0" })).toBe(false);
    expect(operatorCliMfaDisabled({ REMO_OPERATOR_CLI_MFA: "0", REMO_STAGE: "0" })).toBe(false);
    expect(operatorCliMfaDisabled({ REMO_OPERATOR_CLI_MFA: "1", REMO_STAGE: "1" })).toBe(false);
  });
});

describe("assertOperatorCliMfa", () => {
  it("accepts the current code and names the factor", async () => {
    const code = totpCode(SECRET, totpStep());
    const store = fakeStore({ accepted: code });
    const proof = await assertOperatorCliMfa({
      store,
      actor,
      code,
      env: {},
      kek: KEK,
    });
    expect(proof).toEqual({ mfa: "totp", remaining: null, skipped: false });
  });

  it("refuses an operator without a confirmed factor", async () => {
    const store = fakeStore({ enrolled: false });
    await expect(
      assertOperatorCliMfa({ store, actor, code: "123456", env: {} }),
    ).rejects.toThrow(/second factor/);
    expect(store.calls).toEqual([]);
  });

  it("needs --code when there is no terminal", async () => {
    const store = fakeStore();
    await expect(
      assertOperatorCliMfa({ store, actor, env: {}, stdin: { isTTY: false } }),
    ).rejects.toThrow(/--code/);
    expect(store.calls).toEqual([]);
  });

  it("asks interactively in a terminal", async () => {
    const store = fakeStore({ accepted: "123456" });
    const proof = await assertOperatorCliMfa({
      store,
      actor,
      env: {},
      kek: KEK,
      stdin: { isTTY: true },
      ask: async () => "123456",
    });
    expect(proof.mfa).toBe("totp");
    expect(store.calls).toEqual([["totp", actor.id, "123456"]]);
  });

  it("takes a recovery code and spends it", async () => {
    const store = fakeStore({ recovery: "ABCDE-FGHJK" });
    const proof = await assertOperatorCliMfa({
      store,
      actor,
      code: "abcde fghjk",
      env: {},
    });
    expect(proof).toMatchObject({ mfa: "recovery", remaining: 4 });
    expect(store.calls).toEqual([["recovery", actor.id, "abcde fghjk"]]);
  });

  it("writes one row per wrong code and closes the group on the fifth", async () => {
    const store = fakeStore();
    const now = () => new Date("2026-11-23T10:00:00Z");
    for (let attempt = 1; attempt < CLI_MFA_ATTEMPTS; attempt += 1) {
      await expect(
        assertOperatorCliMfa({ store, actor, code: "000000", env: {}, kek: KEK, now }),
      ).rejects.toThrow(/attempts? left/);
    }
    expect(store.failures).toHaveLength(CLI_MFA_ATTEMPTS - 1);
    await expect(
      assertOperatorCliMfa({ store, actor, code: "000000", env: {}, kek: KEK, now }),
    ).rejects.toMatchObject({ code: "MFA_LOCKED" });
    expect(store.failures).toHaveLength(CLI_MFA_ATTEMPTS);
    // The next attempt is refused before the code is even checked.
    const checked = store.calls.length;
    await expect(
      assertOperatorCliMfa({ store, actor, code: "000000", env: {}, kek: KEK, now }),
    ).rejects.toMatchObject({ code: "MFA_LOCKED" });
    expect(store.calls).toHaveLength(checked);
  });

  it("keeps the lock across processes and lets go after fifteen minutes", async () => {
    const store = fakeStore({ accepted: "123456" });
    let clock = new Date("2026-11-23T10:00:00Z");
    const now = () => clock;

    for (let attempt = 0; attempt < CLI_MFA_ATTEMPTS; attempt += 1) {
      // A new `pnpm billing:*` process: the in-memory limiter starts empty.
      resetFailures();
      const error = await assertOperatorCliMfa({
        store,
        actor,
        code: "000000",
        env: {},
        kek: KEK,
        now,
      }).catch((failure) => failure);
      if (attempt < CLI_MFA_ATTEMPTS - 1) {
        expect(error.message).toMatch(/attempts? left/);
      } else {
        expect(error.code).toBe("MFA_LOCKED");
      }
    }

    // A new process with the right code is still refused, and the code is not checked.
    resetFailures();
    const verified = store.calls.length;
    const locked = await assertOperatorCliMfa({
      store,
      actor,
      code: "123456",
      env: {},
      kek: KEK,
      now,
    }).catch((failure) => failure);
    expect(locked.code).toBe("MFA_LOCKED");
    expect(store.calls).toHaveLength(verified);

    // Sixteen minutes after the fifth row the window has passed; the right code works and
    // clears the operator's rows.
    clock = new Date(clock.getTime() + 16 * 60_000);
    resetFailures();
    const proof = await assertOperatorCliMfa({
      store,
      actor,
      code: "123456",
      env: {},
      kek: KEK,
      now,
    });
    expect(proof.mfa).toBe("totp");
    expect(store.failures).toEqual([]);
  });

  it("does not ask for a code on a stand that switched it off", async () => {
    const store = fakeStore({ enrolled: false });
    const proof = await assertOperatorCliMfa({
      store,
      actor,
      env: { REMO_OPERATOR_CLI_MFA: "0", REMO_STAGE: "1" },
      stdin: { isTTY: false },
    });
    expect(proof).toEqual({ mfa: null, skipped: true });
    // Neither the code nor `mfa_cli_attempts` is touched when the stand switched it off.
    expect(store.table).toEqual([]);
    expect(store.calls).toEqual([]);
  });
});
