/**
 * The second factor's own screen (`spec/totp.md` §4, §7; ADR-260).
 *
 * Enrolment, recovery codes and turning the factor off. Every route needs a signed-in
 * session, and every route that changes the factor asks for a password or a code first:
 * a stolen session alone must not replace the secret or print a new set of recovery codes.
 *
 * The secret and `otpauth://` leave the server exactly once, in the answer to `begin` and
 * `confirm`; `mfaStatus` is the only read that exists afterwards. An operator may not turn
 * the factor off while the role is held — the role is what makes the console dangerous, so
 * the role comes off first (§7, rule 1).
 */
import { clearFailures, reserveAttempt } from "./attempts.mjs";
import { hashQueue } from "./hash-queue.mjs";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./iam.mjs";
import { fail, json, readBody } from "./iam-http.mjs";
import { queueMfaLetter } from "./mfa-mail.mjs";
import { MFA_CHALLENGE_ATTEMPTS, MFA_CHALLENGE_TTL_MS, mfaIssuer } from "./mfa.mjs";
import { MFA_DISABLED_TOTAL, MFA_ENABLED_TOTAL, MFA_REJECTS_TOTAL } from "./metrics.mjs";
import { kekFromEnv } from "./secrets.mjs";

/** How many wrong codes a screen may try before it has to ask for the password again. */
export const MFA_ENROLL_ATTEMPTS = MFA_CHALLENGE_ATTEMPTS;

/**
 * @returns {Promise<boolean>} true when the request was one of these routes.
 */
export async function handleMfaRoutes({
  request,
  response,
  url,
  method,
  store,
  user,
  session,
  audit,
  kek = null,
  metrics = null,
}) {
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "/account/mfa" && !path.startsWith("/account/mfa/")) return false;
  if (!session || !user) {
    fail(response, 401, "AUTH_REQUIRED", "sign in first");
    return true;
  }

  const key = kek ?? kekFromEnv();
  const status = () => store.mfaStatus(user.id);
  // A code that would pass two or three steps away is a server-clock signal here too, not
  // only on sign-in; the one metric counts every verifier (`spec/totp.md` §2).
  const noteSkew = (result) => {
    if (result?.reason === "clock_skew") metrics?.inc("remo_mfa_clock_skew_rejects_total");
    if (result?.reason) metrics?.inc(MFA_REJECTS_TOTAL, { reason: result.reason });
  };

  if (path === "/account/mfa" && method === "GET") {
    const current = await status();
    json(response, 200, { ...current, issuer: mfaIssuer(process.env) });
    return true;
  }

  if (path === "/account/mfa/begin" && method === "POST") {
    if (!key) {
      fail(response, 503, "MFA_UNAVAILABLE", "the key-encryption key is not configured");
      return true;
    }
    const limitKey = `mfa-begin:${user.id}`;
    if (!reserveAttempt(limitKey)) {
      fail(response, 429, "RATE_LIMITED", "too many attempts; try again later");
      return true;
    }
    const body = await readBody(request);
    if (!body) {
      fail(response, 400, "BAD_JSON", "malformed request");
      return true;
    }
    const found = await store.findUserByEmail(user.email);
    let ok;
    try {
      ok = await hashQueue.withSlot(() =>
        verifyPassword(String(body.password ?? ""), found?.password_hash ?? DUMMY_PASSWORD_HASH),
      );
    } catch (error) {
      if (error?.code === "HASH_BUSY") {
        fail(response, 503, "SERVER_BUSY", "the server is busy; try again");
        return true;
      }
      throw error;
    }
    if (!ok) {
      fail(response, 403, "INVALID_CREDENTIALS", "the password is wrong");
      return true;
    }
    clearFailures(limitKey);
    const started = await store.beginMfaEnrollment({
      userId: user.id,
      kek: key,
      issuer: mfaIssuer(process.env),
      account: user.email,
    });
    if (!started.started) {
      fail(response, 409, "MFA_ALREADY_ENABLED", "the second factor is already on");
      return true;
    }
    // The only answer that ever carries a secret: it must not be cached anywhere.
    json(response, 200, { secret: started.secret, uri: started.uri }, { "Cache-Control": "no-store" });
    return true;
  }

  if (path === "/account/mfa/confirm" && method === "POST") {
    if (!key) {
      fail(response, 503, "MFA_UNAVAILABLE", "the key-encryption key is not configured");
      return true;
    }
    const limitKey = `mfa-enroll:${user.id}`;
    if (!reserveAttempt(limitKey, { limit: MFA_ENROLL_ATTEMPTS, windowMs: MFA_CHALLENGE_TTL_MS })) {
      fail(response, 429, "RATE_LIMITED", "too many attempts; try again in five minutes");
      return true;
    }
    const body = await readBody(request);
    if (!body) {
      fail(response, 400, "BAD_JSON", "malformed request");
      return true;
    }
    const confirmed = await store.confirmMfaEnrollment({
      userId: user.id,
      code: body.code,
      kek: key,
    });
    if (!confirmed.ok) {
      noteSkew(confirmed);
      if (confirmed.reason === "already_enabled") {
        fail(response, 409, "MFA_ALREADY_ENABLED", "the second factor is already on");
      } else if (confirmed.reason === "not_started") {
        fail(response, 409, "MFA_NOT_STARTED", "start the enrolment first");
      } else {
        fail(response, 401, "MFA_INVALID", "that code did not work");
      }
      return true;
    }
    clearFailures(limitKey);
    // Every other session of the account ends here: it was opened without the new factor
    // and cannot be trusted with it (§4.5). This one proved the code and stays.
    await store.revokeUserSessions(user.id, { except: session.sessionId });
    await store.setSessionMfaAt(session.sessionId, new Date(), "totp");
    await audit({
      actorId: user.id,
      action: "mfa.enabled",
      subject: user.id,
      after: { recoveryCodes: confirmed.recoveryCodes.length },
    });
    metrics?.inc(MFA_ENABLED_TOTAL);
    const notified = await queueMfaLetter({
      store,
      userId: user.id,
      toEmail: user.email,
      locale: user.lang,
      template: "mfa_enabled",
    });
    const answer = {
      confirmedAt: new Date().toISOString(),
      recoveryCodes: confirmed.recoveryCodes,
    };
    if (!notified.queued) answer.mailQueued = false;
    // Recovery codes are secrets; the answer must not be stored by a proxy or the browser.
    json(response, 201, answer, { "Cache-Control": "no-store" });
    return true;
  }

  if (path === "/account/mfa/recovery" && method === "POST") {
    if (!key) {
      fail(response, 503, "MFA_UNAVAILABLE", "the key-encryption key is not configured");
      return true;
    }
    const limitKey = `mfa-recovery:${user.id}`;
    if (!reserveAttempt(limitKey, { limit: MFA_ENROLL_ATTEMPTS, windowMs: MFA_CHALLENGE_TTL_MS })) {
      fail(response, 429, "RATE_LIMITED", "too many attempts; try again in five minutes");
      return true;
    }
    const body = await readBody(request);
    if (!body) {
      fail(response, 400, "BAD_JSON", "malformed request");
      return true;
    }
    const verified = await store.verifyMfaCode({ userId: user.id, code: body.code, kek: key });
    if (!verified.ok) {
      noteSkew(verified);
      fail(response, 401, "MFA_INVALID", "that code did not work");
      return true;
    }
    clearFailures(limitKey);
    const codes = await store.issueRecoveryCodes({ userId: user.id });
    await audit({
      actorId: user.id,
      action: "mfa.recovery_regenerated",
      subject: user.id,
      after: { recoveryCodes: codes.length },
    });
    const notified = await queueMfaLetter({
      store,
      userId: user.id,
      toEmail: user.email,
      locale: user.lang,
      template: "mfa_recovery_regenerated",
      params: { count: codes.length },
    });
    const answer = { recoveryCodes: codes };
    if (!notified.queued) answer.mailQueued = false;
    json(response, 201, answer, { "Cache-Control": "no-store" });
    return true;
  }

  if (path === "/account/mfa/disable" && method === "POST") {
    if (!key) {
      fail(response, 503, "MFA_UNAVAILABLE", "the key-encryption key is not configured");
      return true;
    }
    // Rule 1: the role opens with the factor, so it cannot be closed while the role is held.
    if (typeof store.isInstanceOperator === "function" && (await store.isInstanceOperator(user.id))) {
      fail(
        response,
        409,
        "MFA_OPERATOR_ROLE",
        "revoke the operator role on the server before turning the second factor off",
      );
      return true;
    }
    const limitKey = `mfa-disable:${user.id}`;
    if (!reserveAttempt(limitKey, { limit: MFA_ENROLL_ATTEMPTS, windowMs: MFA_CHALLENGE_TTL_MS })) {
      fail(response, 429, "RATE_LIMITED", "too many attempts; try again in five minutes");
      return true;
    }
    const body = await readBody(request);
    if (!body) {
      fail(response, 400, "BAD_JSON", "malformed request");
      return true;
    }
    const verified = await store.verifyMfaCode({ userId: user.id, code: body.code, kek: key });
    if (!verified.ok) {
      noteSkew(verified);
      fail(response, 401, "MFA_INVALID", "that code did not work");
      return true;
    }
    clearFailures(limitKey);
    await store.resetMfa(user.id);
    await audit({ actorId: user.id, action: "mfa.disabled", subject: user.id });
    metrics?.inc(MFA_DISABLED_TOTAL);
    const notified = await queueMfaLetter({
      store,
      userId: user.id,
      toEmail: user.email,
      locale: user.lang,
      template: "mfa_disabled",
    });
    json(response, 200, notified.queued ? { ok: true } : { ok: true, mailQueued: false });
    return true;
  }

  fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
  return true;
}
