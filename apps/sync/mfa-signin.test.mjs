import { beforeEach, describe, expect, it } from "vitest";
import { resetFailures } from "./attempts.mjs";
import { hashToken } from "./iam.mjs";
import { MFA_CHALLENGE_ATTEMPTS } from "./mfa.mjs";
import { answerMfaChallenge, issueMfaChallenge, mfaAccountLocked } from "./mfa-signin.mjs";

/**
 * The decision around a second-factor challenge (`spec/totp.md` §5, §6).
 *
 * The code itself is tested where it is computed (`mfa.test.mjs`) and where it is stored
 * (`mfa.db.test.mjs`). Here the subject is the answer around it: which challenge counts,
 * how many wrong answers end it, when the account closes for an hour, and that a success
 * clears the counters instead of leaving a half-spent budget behind.
 */
function challenge({ purpose = "login", userId = "user-1", token = "presented-token" } = {}) {
  return {
    token,
    row: {
      id: "challenge-1",
      user_id: userId,
      purpose,
      attempts: 0,
      expires_at: new Date(Date.now() + 60_000),
      tokenHash: hashToken(token),
    },
  };
}

/** A store stub that answers like the database module does, and records the calls. */
function fakeStore({
  found = challenge(),
  verify = () => ({ ok: false, reason: "mismatch" }),
  recovery = () => ({ ok: false, reason: "mismatch" }),
  failAt = MFA_CHALLENGE_ATTEMPTS,
} = {}) {
  const calls = [];
  let attempts = 0;
  let live = found.row;
  return {
    calls,
    async createMfaChallenge(input) {
      calls.push(["create", input]);
      return { id: "challenge-1", expires_at: input.expiresAt };
    },
    async findMfaChallenge(tokenHash) {
      calls.push(["find", tokenHash]);
      if (!live) return null;
      return Buffer.from(tokenHash).equals(Buffer.from(found.row.tokenHash)) ? live : null;
    },
    async failMfaChallenge() {
      attempts += 1;
      calls.push(["fail", attempts]);
      const deleted = attempts >= failAt;
      if (deleted) live = null;
      return { attempts, deleted };
    },
    async deleteMfaChallenge() {
      calls.push(["delete"]);
      live = null;
    },
    async verifyMfaCode() {
      calls.push(["code"]);
      return verify();
    },
    async verifyMfaRecoveryCode() {
      calls.push(["recovery"]);
      return recovery();
    },
  };
}

const KEK = { key: Buffer.alloc(32, 3), id: "test" };

beforeEach(() => resetFailures());

describe("answering a second-factor challenge", () => {
  it("refuses an unknown or expired token without touching a code", async () => {
    const store = fakeStore();
    const result = await answerMfaChallenge({
      store,
      token: "other-token",
      purpose: "login",
      code: "123456",
      kek: KEK,
    });
    expect(result).toEqual({ ok: false, reason: "challenge" });
    expect(store.calls.some(([name]) => name === "code")).toBe(false);
  });

  it("does not let a login challenge be spent as a step-up", async () => {
    const store = fakeStore();
    const result = await answerMfaChallenge({
      store,
      token: "presented-token",
      purpose: "step_up",
      code: "123456",
      kek: KEK,
    });
    expect(result).toEqual({ ok: false, reason: "challenge" });
  });

  it("counts a wrong code, reports what is left and keeps the challenge alive", async () => {
    const store = fakeStore();
    const result = await answerMfaChallenge({
      store,
      token: "presented-token",
      purpose: "login",
      code: "000000",
      kek: KEK,
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid", attemptsLeft: 4 });
    expect(store.calls.filter(([name]) => name === "fail")).toHaveLength(1);
  });

  it("ends the challenge on the fifth wrong code", async () => {
    const store = fakeStore();
    let result;
    for (let attempt = 0; attempt < MFA_CHALLENGE_ATTEMPTS; attempt += 1) {
      result = await answerMfaChallenge({
        store,
        token: "presented-token",
        purpose: "login",
        code: "000000",
        kek: KEK,
      });
    }
    expect(result).toMatchObject({ ok: false, reason: "exhausted", attemptsLeft: 0 });
    // The row is gone; a sixth answer cannot even find the challenge.
    const sixth = await answerMfaChallenge({
      store,
      token: "presented-token",
      purpose: "login",
      code: "000000",
      kek: KEK,
    });
    expect(sixth).toEqual({ ok: false, reason: "challenge" });
  });

  it("closes code sign-in for the account after ten wrong codes", async () => {
    let result;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      // Each attempt gets a live challenge: the five-a-challenge rule would otherwise
      // stop this test before the hourly rule is reached.
      const token = `token-${attempt}`;
      const store = fakeStore({ found: challenge({ token }) });
      result = await answerMfaChallenge({
        store,
        token,
        purpose: "login",
        code: "000000",
        kek: KEK,
      });
    }
    expect(result).toMatchObject({ ok: false, reason: "locked", justLocked: true });
    expect(mfaAccountLocked("user-1")).toBe(true);

    // A fresh challenge is refused before a code is looked at.
    const store = fakeStore();
    const blocked = await answerMfaChallenge({
      store,
      token: "presented-token",
      purpose: "login",
      code: "123456",
      kek: KEK,
    });
    expect(blocked).toEqual({ ok: false, reason: "locked", userId: "user-1" });
    expect(store.calls.some(([name]) => name === "code")).toBe(false);
  });

  it("accepts a code, deletes the challenge and forgets the failures", async () => {
    const store = fakeStore({ verify: () => ({ ok: true, step: 10 }) });
    const result = await answerMfaChallenge({
      store,
      token: "presented-token",
      purpose: "login",
      code: "123456",
      kek: KEK,
    });
    expect(result).toEqual({ ok: true, userId: "user-1", recovery: false, remaining: null });
    expect(store.calls.at(-1)).toEqual(["delete"]);

    // Nine wrong answers after a success do not lock: the counter started again.
    let last;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const token = `after-success-${attempt}`;
      last = await answerMfaChallenge({
        store: fakeStore({ found: challenge({ token }) }),
        token,
        purpose: "login",
        code: "000000",
        kek: KEK,
      });
    }
    expect(last).toMatchObject({ ok: false, reason: "invalid" });
    expect(mfaAccountLocked("user-1")).toBe(false);
  });

  it("accepts a recovery code and says how many are left", async () => {
    const store = fakeStore({ recovery: () => ({ ok: true, remaining: 7 }) });
    const result = await answerMfaChallenge({
      store,
      token: "presented-token",
      purpose: "login",
      recoveryCode: "ABCDE-FGHJK",
      kek: KEK,
    });
    expect(result).toEqual({ ok: true, userId: "user-1", recovery: true, remaining: 7 });
    expect(store.calls.some(([name]) => name === "code")).toBe(false);
  });

  it("reports a clock-skew refusal so the metric can see it", async () => {
    const store = fakeStore({
      found: challenge({ purpose: "step_up" }),
      verify: () => ({ ok: false, reason: "clock_skew", step: 13 }),
    });
    const result = await answerMfaChallenge({
      store,
      token: "presented-token",
      purpose: "step_up",
      code: "123456",
      kek: KEK,
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid", clockSkew: true });
  });
});

describe("issuing a challenge", () => {
  it("stores only the digest and returns the token once", async () => {
    const store = fakeStore();
    const issued = await issueMfaChallenge(store, {
      userId: "user-1",
      purpose: "login",
      ttlMs: 60_000,
      now: 1_000_000,
    });
    expect(issued.challenge).toHaveLength(43);
    const [, input] = store.calls[0];
    expect(input.userId).toBe("user-1");
    expect(input.purpose).toBe("login");
    expect(input.expiresAt.getTime()).toBe(1_060_000);
    expect(Buffer.from(input.tokenHash).equals(hashToken(issued.challenge))).toBe(true);
    expect(JSON.stringify(input)).not.toContain(issued.challenge);
  });
});
