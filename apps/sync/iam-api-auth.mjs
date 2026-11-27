/**
 * Sign-up, sign-in, sign-out, the current user and a password change.
 */
import {
  DUMMY_PASSWORD_HASH,
  capabilitiesFor,
  hashPassword,
  hashToken,
  isEmail,
  newToken,
  normalizeEmail,
  orgCapabilitiesFor,
  passwordProblem,
  verifyPassword,
} from "./iam.mjs";
import { clearFailures, reserveAttempt } from "./attempts.mjs";
import { hashQueue } from "./hash-queue.mjs";
import { deriveHandle, handleCandidate, handleProblem, normalizeHandle } from "./handle.mjs";
import {
  SESSION_DAYS,
  clearedSessionCookie,
  fail,
  json,
  orgSlugFor,
  readBody,
  refuseSecondFactor,
  sessionCookie,
} from "./iam-http.mjs";
import { csrfToken } from "./csrf.mjs";
import { issueAuthToken } from "./auth-tokens.mjs";
import { hashedClientIp, requestUserAgent } from "./ip-hash.mjs";
import { legalAcceptanceProblem, legalAcceptanceRows, legalIpPolicy } from "./legal.mjs";
import { enqueueMail, pickLocale } from "./mail.mjs";
import { queueMfaLetter } from "./mfa-mail.mjs";
import { issueMfaChallenge, answerMfaChallenge } from "./mfa-signin.mjs";
import { MFA_HOURLY_FAILURES, mfaIssuer } from "./mfa.mjs";
import { MFA_LOGINS_TOTAL } from "./metrics.mjs";
import { kekFromEnv } from "./secrets.mjs";

const THEMES = new Set(["system", "light", "dark"]);
const LANGS = new Set(["ru", "en"]);

/** The one shape of an account's display preferences on the wire (ADR-150). */
function preferencesOf(row) {
  return { theme: row?.theme ?? null, lang: row?.lang ?? null, motion: row?.motion ?? null };
}

export async function handleAuthRoutes(ctx) {
  const { request, response, url, parts, store, method, user, session, secure, audit, legal } = ctx;

  if (url.pathname === "/auth/register" && method === "POST") {
    const body = await readBody(request);
    if (!body) {
      fail(response, 400, "BAD_JSON", "malformed request");
      return true;
    }
    const email = normalizeEmail(body.email);
    const name = String(body.name ?? "").trim() || email.split("@")[0];
    if (!isEmail(email)) return fail(response, 422, "BAD_EMAIL", "enter a valid email"), true;
    const weak = passwordProblem(body.password);
    if (weak) return fail(response, 422, weak.code, weak.message), true;

    // The server decides, not the form (ADR-256 §1). A sign-up without the documents its
    // zone requires is refused before the rate limiter spends an attempt and before scrypt
    // runs: an incomplete request must not cost an address its registration budget.
    const legalProblem = legalAcceptanceProblem(legal, body.acceptances);
    if (legalProblem) {
      const { code, ...details } = legalProblem;
      return json(response, 400, { error: code, ...details }), true;
    }
    const acceptances = legalAcceptanceRows(legal);
    const ipPolicy = legal?.ipPolicy ?? legalIpPolicy(process.env, legal?.zone ?? "none");
    const ipHash = ipPolicy.storeIp ? hashedClientIp(request) : null;
    const userAgent = requestUserAgent(request);

    // Registration is a second expensive hash and an account factory. Reserve one
    // attempt per address before hashing, so a burst cannot queue scrypt work.
    const registerIp = ctx.ip ?? "unknown";
    if (
      !reserveAttempt(`register:${registerIp}`, {
        limit: Number(process.env.REMO_REGISTER_LIMIT ?? 20),
        windowMs: 60 * 60_000,
      })
    ) {
      return json(
        response,
        429,
        { error: "RATE_LIMITED", message: "too many accounts from this address" },
        { "Retry-After": "3600" },
      ), true;
    }

    if (await store.findUserByEmail(email)) {
      return fail(response, 409, "EMAIL_TAKEN", "this email already has an account"), true;
    }

    const requestedHandle = normalizeHandle(body.handle);
    let handle;
    if (requestedHandle) {
      const problem = handleProblem(requestedHandle);
      if (problem) return fail(response, 422, problem.code, problem.message), true;
      if (await store.findUserByHandle(requestedHandle)) {
        return fail(response, 409, "HANDLE_TAKEN", "this handle is already taken"), true;
      }
      handle = requestedHandle;
    } else {
      const base = deriveHandle(email);
      handle = base;
      for (let attempt = 2; await store.findUserByHandle(handle); attempt += 1) {
        handle = handleCandidate(base, attempt);
      }
    }

    let passwordHash;
    try {
      passwordHash = await hashQueue.withSlot(() => hashPassword(body.password));
    } catch (error) {
      if (error?.code === "HASH_BUSY") {
        return fail(response, 503, "SERVER_BUSY", "the server is busy; try again"), true;
      }
      throw error;
    }
    const legalRows = acceptances.map((acceptance) => ({ ...acceptance, ipHash, userAgent }));
    let created;
    try {
      // One transaction: an account without the acceptances it just promised must never
      // exist (ADR-256 §4). A zone with no required document keeps the plain insert.
      if (legalRows.length) {
        if (typeof store.createUserWithAcceptances !== "function") {
          throw new Error("this store cannot write legal acceptances with the account");
        }
        created = await store.createUserWithAcceptances({
          email,
          passwordHash,
          name,
          handle,
          acceptances: legalRows,
        });
      } else {
        created = await store.createUser({ email, passwordHash, name, handle });
      }
    } catch (error) {
      if (error?.code === "23505") {
        return fail(response, 409, "HANDLE_TAKEN", "this handle is already taken"), true;
      }
      throw error;
    }
    const { org, team } = await store.createOrgWithOwner({
      name,
      slug: orgSlugFor(name),
      userId: created.id,
      kind: "personal",
    });
    const sessionToken = newToken();
    await store.createSession({
      userId: created.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
      userAgent: request.headers["user-agent"] ?? null,
    });
    await audit({
      actorId: created.id,
      orgId: org.id,
      action: "auth.register",
      subject: email,
    });
    // The address is unproven until the link is used; with mail off nothing changes.
    if (ctx.mailConfig && ctx.mailConfig.driver !== "disabled") {
      try {
        const issued = await issueAuthToken(store, {
          userId: created.id,
          purpose: "email_verify",
          email: created.email,
        });
        await enqueueMail(
          store,
          {
            userId: created.id,
            toEmail: created.email,
            template: "verify_email",
            locale: pickLocale({
              userLang: created.lang,
              acceptLanguage: request.headers["accept-language"],
            }),
            params: { name: created.name },
            linkParams: { link: `${ctx.mailConfig.appOrigin}/?verify=${issued.token}` },
            validUntil: issued.expiresAt,
          },
          { config: ctx.mailConfig },
        );
      } catch (error) {
        // Signing up must not fail because the letter could not be queued.
        ctx.log?.error?.("[auth] verify mail failed:", error.message);
      }
    }
    json(
      response,
      201,
      {
        user: {
          id: created.id,
          email: created.email,
          name: created.name,
          handle: created.handle,
          emailVerified: false,
          preferences: preferencesOf(created),
        },
        org,
        team,
        capabilities: capabilitiesFor("owner"),
      },
      { "Set-Cookie": sessionCookie(sessionToken, secure) },
    );
    return true;
  }

  if (url.pathname === "/auth/login" && method === "POST") {
    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    const email = normalizeEmail(body.email);
    const ip = ctx.ip ?? "unknown";
    const key = `login:${ip}:${email}`;
    const ipKey = `login-ip:${ip}`;
    // Reserve before the database lookup and scrypt: two parallel requests that both
    // read a count of nine must not both reach the hash.
    if (
      !reserveAttempt(ipKey, {
        limit: Number(process.env.REMO_LOGIN_IP_LIMIT ?? 100),
      })
    ) {
      return json(
        response,
        429,
        { error: "RATE_LIMITED", message: "too many attempts; try again later" },
        { "Retry-After": "900" },
      ), true;
    }
    if (
      !reserveAttempt(key, {
        limit: Number(process.env.REMO_LOGIN_LIMIT ?? 10),
      })
    ) {
      return json(
        response,
        429,
        { error: "RATE_LIMITED", message: "too many attempts; try again later" },
        { "Retry-After": "900" },
      ), true;
    }
    const found = await store.findUserByEmail(email);
    // Verify against a hash no account owns when the email is unknown: both failures
    // then cost the same scrypt work, so the answer does not reveal an account.
    let ok;
    try {
      ok = await hashQueue.withSlot(() =>
        verifyPassword(
          String(body.password ?? ""),
          found?.password_hash ?? DUMMY_PASSWORD_HASH,
        ),
      );
    } catch (error) {
      if (error?.code === "HASH_BUSY") {
        return fail(response, 503, "SERVER_BUSY", "the server is busy; try again"), true;
      }
      throw error;
    }
    if (!ok || found?.state !== "active") {
      // The attempt is already reserved; a failure leaves it counted.
      return fail(response, 401, "INVALID_CREDENTIALS", "wrong email or password"), true;
    }
    clearFailures(key);
    // The password is right; the second factor, when the account has one, is the next
    // step. Nothing before this line reads `user_mfa`, so a wrong password costs and
    // answers exactly what it did for an account without a factor (§5.5).
    const second = await store.mfaStatus(found.id);
    if (second.enrolled) {
      const kek = kekFromEnv();
      if (!kek) {
        return fail(
          response,
          503,
          "MFA_UNAVAILABLE",
          "the key-encryption key is not configured",
        ), true;
      }
      const issued = await issueMfaChallenge(store, { userId: found.id, purpose: "login" });
      json(response, 202, {
        mfaRequired: true,
        issuer: mfaIssuer(),
        challenge: issued.challenge,
        expiresAt: issued.expiresAt.toISOString(),
      });
      return true;
    }
    const sessionToken = newToken();
    await store.createSession({
      userId: found.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
      userAgent: request.headers["user-agent"] ?? null,
    });
    await audit({ actorId: found.id, action: "auth.login", subject: found.email });
    json(
      response,
      200,
      {
        user: {
          id: found.id,
          email: found.email,
          name: found.name,
          handle: found.handle,
          emailVerified: Boolean(found.email_verified_at),
          preferences: preferencesOf(found),
        },
      },
      { "Set-Cookie": sessionCookie(sessionToken, secure) },
    );
    return true;
  }

  if (url.pathname === "/auth/login/mfa" && method === "POST") {
    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    const kek = kekFromEnv();
    if (!kek) {
      return fail(
        response,
        503,
        "MFA_UNAVAILABLE",
        "the key-encryption key is not configured",
      ), true;
    }
    const result = await answerMfaChallenge({
      store,
      token: body.challenge,
      purpose: "login",
      code: body.code,
      recoveryCode: body.recoveryCode,
      kek,
    });
    if (!result.ok) {
      // The tenth wrong code is the audit event and the letter's trigger (§7); a dead
      // challenge on its own is ordinary noise.
      if (result.justLocked) {
        await audit({
          actorId: result.userId,
          action: "mfa.locked",
          subject: result.userId,
          after: { wrongCodes: MFA_HOURLY_FAILURES },
        });
      }
      refuseSecondFactor(response, result, { metrics: ctx.metrics });
      return true;
    }
    const found = await store.findUserById(result.userId);
    if (!found || found.state !== "active") {
      return fail(response, 401, "INVALID_CREDENTIALS", "wrong email or password"), true;
    }
    const sessionToken = newToken();
    const created = await store.createSession({
      userId: found.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
      userAgent: request.headers["user-agent"] ?? null,
    });
    await store.setSessionMfaAt(created.id, new Date(), result.recovery ? "recovery" : "totp");
    await audit({
      actorId: found.id,
      action: result.recovery ? "mfa.recovery_used" : "mfa.login",
      subject: found.email,
      ...(result.recovery ? { after: { remaining: result.remaining } } : {}),
    });
    ctx.metrics?.inc(MFA_LOGINS_TOTAL);
    if (result.recovery) {
      // A recovery code is a fallback, not a routine: the owner is told it was spent and
      // how many are left (`spec/totp.md` §5.4).
      await queueMfaLetter({
        store,
        userId: found.id,
        toEmail: found.email,
        locale: found.lang,
        template: "mfa_recovery_used",
        params: { remaining: result.remaining ?? 0 },
      });
    }
    json(
      response,
      200,
      {
        user: {
          id: found.id,
          email: found.email,
          name: found.name,
          handle: found.handle,
          emailVerified: Boolean(found.email_verified_at),
          preferences: preferencesOf(found),
        },
        ...(result.recovery ? { recoveryLeft: result.remaining } : {}),
      },
      { "Set-Cookie": sessionCookie(sessionToken, secure) },
    );
    return true;
  }

  if (url.pathname === "/auth/logout" && method === "POST") {
    if (session) await store.revokeSession(session.tokenHash);
    if (user) await audit({ actorId: user.id, action: "auth.logout", subject: user.email });
    json(response, 200, { ok: true }, { "Set-Cookie": clearedSessionCookie });
    return true;
  }

  if (url.pathname === "/auth/me" && method === "GET") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const orgs = (await store.listOrgsForUser(user.id)).map((org) => ({
      ...org,
      capabilities: orgCapabilitiesFor(org),
    }));
    // The app reads the cookie directly; the field is the documented place a client
    // looks (spec/IAM-v1.md §6) and keeps the double-submit pair discoverable.
    json(response, 200, { user, orgs, csrfToken: csrfToken(request) });
    return true;
  }

  if (url.pathname === "/auth/me" && method === "PATCH") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    const name = body.name === undefined ? null : String(body.name).trim();
    if (name !== null && !name) {
      return fail(response, 422, "NAME_REQUIRED", "a name is required"), true;
    }
    if (name !== null && name.length > 80) {
      return fail(response, 422, "NAME_TOO_LONG", "the name must be at most 80 characters"), true;
    }
    const requestedHandle = body.handle === undefined ? null : normalizeHandle(body.handle);
    if (requestedHandle !== null) {
      const problem = handleProblem(requestedHandle);
      if (problem) return fail(response, 422, problem.code, problem.message), true;
      const owner = await store.findUserByHandle(requestedHandle);
      if (owner && owner.id !== user.id) {
        return fail(response, 409, "HANDLE_TAKEN", "this handle is already taken"), true;
      }
    }
    let updated;
    try {
      updated = await store.renameUser({ userId: user.id, name, handle: requestedHandle });
    } catch (error) {
      if (error?.code === "23505") {
        return fail(response, 409, "HANDLE_TAKEN", "this handle is already taken"), true;
      }
      throw error;
    }
    if (!updated) return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found"), true;
    await audit({
      actorId: user.id,
      action: "auth.profile_changed",
      subject: updated.handle,
    });
    json(response, 200, {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        handle: updated.handle,
        preferences: user.preferences,
      },
    });
    return true;
  }

  if (url.pathname === "/auth/sessions" && method === "DELETE" && url.searchParams.get("others") === "1") {
    if (!session?.sessionId) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const revoked = await store.revokeOtherSessions(user.id, session.sessionId, request.headers["x-request-id"] ?? null);
    json(response, 200, { revoked });
    return true;
  }

  if (url.pathname === "/auth/sessions" && method === "GET") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const rows = await store.listSessionsForUser(user.id);
    json(response, 200, {
      sessionId: session.sessionId ?? null,
      sessions: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
        userAgent: row.user_agent ?? null,
        current: row.id === session.sessionId,
      })),
    });
    return true;
  }

  if (
    parts[0] === "auth" &&
    parts[1] === "sessions" &&
    parts.length === 3 &&
    method === "DELETE"
  ) {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const id = parts[2];
    const removed = await store.revokeSessionById(user.id, id);
    if (!removed) {
      return fail(response, 404, "RESOURCE_NOT_AVAILABLE", "session not found"), true;
    }
    const current = id === session.sessionId;
    await audit({ actorId: user.id, action: "auth.session_revoked", subject: id });
    json(
      response,
      200,
      { ok: true, current },
      current ? { "Set-Cookie": clearedSessionCookie } : {},
    );
    return true;
  }

  if (url.pathname === "/auth/preferences" && method === "PATCH") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const body = await readBody(request);
    if (!body || typeof body !== "object") {
      return fail(response, 400, "BAD_JSON", "malformed request"), true;
    }
    // A field left out stays as it is: an older client that sends theme and language
    // must not clear the motion choice (ADR-289).
    const theme = body.theme === undefined ? undefined : (body.theme ?? null);
    const lang = body.lang === undefined ? undefined : (body.lang ?? null);
    const motion = body.motion === undefined ? undefined : body.motion;
    if (theme !== undefined && theme !== null && !THEMES.has(theme)) {
      return fail(response, 422, "BAD_THEME", "theme must be system, light or dark"), true;
    }
    if (lang !== undefined && lang !== null && !LANGS.has(lang)) {
      return fail(response, 422, "BAD_LANG", "language must be ru or en"), true;
    }
    if (motion !== undefined && motion !== null && typeof motion !== "boolean") {
      return fail(response, 422, "BAD_MOTION", "motion must be true, false or null"), true;
    }
    const preferences = await store.updateUserPreferences(user.id, { theme, lang, motion });
    json(response, 200, { preferences });
    return true;
  }

  if (url.pathname === "/auth/password" && method === "POST") {
    if (!session) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    const body = await readBody(request);
    if (!body) return fail(response, 400, "BAD_JSON", "malformed request"), true;
    const found = await store.findUserByEmail(user.email);
    if (!found || !(await verifyPassword(String(body.currentPassword ?? ""), found.password_hash))) {
      return fail(response, 403, "INVALID_CREDENTIALS", "current password is wrong"), true;
    }
    const weak = passwordProblem(body.newPassword);
    if (weak) return fail(response, 422, weak.code, weak.message), true;
    // One hashing mechanism: the queue is what keeps a burst from exhausting the pool.
    let passwordHash;
    try {
      passwordHash = await hashQueue.withSlot(() => hashPassword(body.newPassword));
    } catch (error) {
      if (error?.code === "HASH_BUSY") {
        return fail(response, 503, "SERVER_BUSY", "the server is busy; try again"), true;
      }
      throw error;
    }
    await store.updatePassword(user.id, passwordHash);
    // Changing a password ends every other session, the way people expect.
    await store.revokeUserSessions(user.id);
    await audit({ actorId: user.id, action: "auth.password_changed", subject: user.email });
    if (ctx.mailConfig && ctx.mailConfig.driver !== "disabled") {
      try {
        await enqueueMail(
          store,
          {
            userId: user.id,
            toEmail: user.email,
            template: "password_changed",
            locale: pickLocale({
              userLang: found.lang,
              acceptLanguage: request.headers["accept-language"],
            }),
            params: { email: user.email, forgotLink: `${ctx.mailConfig.appOrigin}/?forgot=1` },
          },
          { config: ctx.mailConfig },
        );
      } catch (error) {
        // The password changed; a failed notice must not turn that into an error.
        ctx.log?.error?.("[auth] password_changed mail failed:", error.message);
      }
    }
    json(response, 200, { ok: true }, { "Set-Cookie": clearedSessionCookie });
    return true;
  }

  return false;
}
