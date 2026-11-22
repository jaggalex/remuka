/**
 * Answering a second-factor challenge (`spec/totp.md` §5, §6).
 *
 * One mechanism for the two places a code is asked for: the second step of sign-in and
 * the console's step-up. A challenge row is created when the password (or an active
 * session) proved who is asking; this module spends it — or refuses and counts why.
 *
 * The limits are the spec's numbers and the existing `attempts` limiter, never a second
 * map: five wrong answers end one challenge, ten wrong answers for one account in an hour
 * close code sign-in for an hour. A success clears both counters.
 *
 * A wrong answer never says whether the account has a factor: the caller only calls this
 * with a live challenge, and the challenge exists only after the password was right.
 */
import { clearFailures, isRateLimited, recordFailure, reserveAttempt } from "./attempts.mjs";
import { hashToken, newToken } from "./iam.mjs";
import { MFA_CHALLENGE_ATTEMPTS, MFA_CHALLENGE_TTL_MS, MFA_HOURLY_FAILURES } from "./mfa.mjs";

/** Ten wrong codes close code sign-in for an hour (§5.3). */
export const MFA_LOCK_MS = 60 * 60_000;

/** One live challenge per proof of identity; only its digest is stored (§3). */
export async function issueMfaChallenge(
  store,
  { userId, purpose, ttlMs = MFA_CHALLENGE_TTL_MS, now = Date.now() },
) {
  const token = newToken();
  const expiresAt = new Date(now + ttlMs);
  await store.createMfaChallenge({
    userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return { challenge: token, expiresAt };
}

/** True while this account has spent its ten wrong codes for the hour. */
export function mfaAccountLocked(userId) {
  return isRateLimited(`mfa-lock:${userId}`, { limit: 1 });
}

const challengeKey = (tokenHash) => `mfa-challenge:${Buffer.from(tokenHash).toString("hex")}`;

/**
 * Count one wrong code. The tenth creates the lock bucket at that moment, so "closed for
 * an hour" starts when the limit is reached rather than at the first wrong answer.
 */
function noteWrongCode(userId) {
  const count = recordFailure(`mfa-hour:${userId}`, { windowMs: MFA_LOCK_MS });
  if (count < MFA_HOURLY_FAILURES) return { count, justLocked: false };
  reserveAttempt(`mfa-lock:${userId}`, { limit: 1, windowMs: MFA_LOCK_MS });
  return { count, justLocked: true };
}

/**
 * Check a TOTP or recovery code against a live challenge.
 *
 * @returns {Promise<
 *   | { ok: true, userId: string, recovery: boolean, remaining: number | null }
 *   | { ok: false, reason: "challenge" | "invalid" | "exhausted" | "locked",
 *       userId?: string, attemptsLeft?: number, clockSkew?: boolean, justLocked?: boolean }
 * >}
 */
export async function answerMfaChallenge({
  store,
  token,
  purpose,
  code = null,
  recoveryCode = null,
  kek = null,
  now = new Date(),
}) {
  const presented = String(token ?? "").trim();
  if (!presented) return { ok: false, reason: "challenge" };
  const tokenHash = hashToken(presented);
  const challenge = await store.findMfaChallenge(tokenHash);
  if (!challenge || challenge.purpose !== purpose) return { ok: false, reason: "challenge" };
  const userId = challenge.user_id;

  if (mfaAccountLocked(userId)) return { ok: false, reason: "locked", userId };

  // Counted before the code is checked, so a burst cannot queue parallel guesses against
  // one token; the fifth reservation is the last one.
  if (
    !reserveAttempt(challengeKey(tokenHash), {
      limit: MFA_CHALLENGE_ATTEMPTS,
      windowMs: MFA_CHALLENGE_TTL_MS,
    })
  ) {
    await store.deleteMfaChallenge(tokenHash);
    clearFailures(challengeKey(tokenHash));
    return { ok: false, reason: "exhausted", userId };
  }

  const verified = recoveryCode
    ? await store.verifyMfaRecoveryCode({ userId, code: recoveryCode })
    : await store.verifyMfaCode({ userId, code, kek, now });

  if (verified.ok) {
    clearFailures(challengeKey(tokenHash));
    clearFailures(`mfa-hour:${userId}`);
    await store.deleteMfaChallenge(tokenHash);
    return {
      ok: true,
      userId,
      recovery: Boolean(recoveryCode),
      remaining: verified.remaining ?? null,
    };
  }

  const failed = await store.failMfaChallenge(challenge.id);
  const wrong = noteWrongCode(userId);
  const clockSkew = verified.reason === "clock_skew";
  if (wrong.justLocked) {
    return {
      ok: false,
      reason: "locked",
      userId,
      attemptsLeft: 0,
      clockSkew,
      justLocked: true,
    };
  }
  if (failed.deleted) {
    return {
      ok: false,
      reason: "exhausted",
      userId,
      attemptsLeft: 0,
      clockSkew,
      justLocked: false,
    };
  }
  return {
    ok: false,
    reason: "invalid",
    userId,
    attemptsLeft: Math.max(0, MFA_CHALLENGE_ATTEMPTS - failed.attempts),
    clockSkew,
    justLocked: false,
  };
}
