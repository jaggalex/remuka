/**
 * The account-deletion HTTP surface (ADR-257, `spec/account-deletion.md` §2–§2.4).
 *
 * Two routes, one command each: this module only checks what the browser must prove
 * before the command runs — the session, the password and the phrase — and turns the
 * command's refusal into a status. It deliberately does not write state itself.
 *
 * The cancellation accepts the one-time link from the letter as well as a session: the
 * command ends every session at once (§2.3), so the letter is what a person actually has
 * after asking to leave. The link is a bearer token sealed into `mail_outbox`, single use
 * and valid exactly for the fourteen days.
 */
import {
  AccountDeletionError,
  cancelAccountDeletion,
  deleteAccount,
  deletionDueAt,
} from "./account-deletion.mjs";
import { hashAuthToken, issueAuthToken } from "./auth-tokens.mjs";
import { clearFailures, reserveAttempt } from "./attempts.mjs";
import { hashQueue } from "./hash-queue.mjs";
import { clearedSessionCookie, fail, json, readBody } from "./iam-http.mjs";
import { verifyPassword } from "./iam.mjs";
import { enqueueMail, pickLocale } from "./mail.mjs";

/** The phrase is part of the confirmation, like typing a repository name before deleting it. */
const PHRASES = { ru: "удалить", en: "delete" };
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function phraseMatches(given, locale) {
  return String(given ?? "").trim().toLowerCase() === PHRASES[locale];
}

/** `accountDeletionDate` for the letter; the template only substitutes text. */
function formatDueDate(date, locale) {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "long",
  }).format(date);
}

function refusal(response, error) {
  if (!(error instanceof AccountDeletionError)) throw error;
  const body = { error: error.code, message: error.message };
  if (error.details?.orgs) body.orgs = error.details.orgs;
  // The command names the internal condition; the wire uses the shorter public code the
  // settings screen switches on.
  if (body.error === "LAST_ORG_ADMIN") body.error = "LAST_ADMIN";
  json(response, error.status, body);
  return true;
}

export async function handleAccountRoutes(ctx) {
  const { request, response, url, method, store, session, user, mailConfig, log = console } = ctx;
  const requestId = request.headers["x-request-id"] ?? null;

  if (url.pathname === "/account/delete" && method === "POST") {
    if (!session || !user) {
      return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    }
    const body = await readBody(request);
    if (!body || typeof body !== "object") {
      return fail(response, 400, "BAD_JSON", "malformed request"), true;
    }

    // A stolen session must not be able to grind the password: the hash queue bounds the
    // work, this bounds the guesses.
    if (
      !reserveAttempt(`account-delete:${user.id}`, {
        limit: 5,
        windowMs: ATTEMPT_WINDOW_MS,
      })
    ) {
      return fail(response, 429, "RATE_LIMITED", "too many attempts; try again later"), true;
    }

    // `findUserByEmail` is the read that carries the hash; the session deliberately does not.
    const found = await store.findUserByEmail(user.email);
    if (!found) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
    let ok = false;
    try {
      ok = await hashQueue.withSlot(() =>
        verifyPassword(String(body.password ?? ""), found?.password_hash ?? ""),
      );
    } catch (error) {
      if (error?.code === "HASH_BUSY") {
        return fail(response, 503, "SERVER_BUSY", "the server is busy; try again"), true;
      }
      throw error;
    }
    if (!ok) {
      return fail(response, 403, "INVALID_CREDENTIALS", "current password is wrong"), true;
    }

    const locale = pickLocale({
      userLang: found.lang,
      acceptLanguage: request.headers["accept-language"],
    });
    if (!phraseMatches(body.phrase, locale)) {
      return fail(response, 422, "BAD_PHRASE", `type “${PHRASES[locale]}” to confirm`), true;
    }

    let result;
    try {
      result = await deleteAccount({
        store,
        userId: user.id,
        actorId: user.id,
        requestId,
      });
    } catch (error) {
      return refusal(response, error);
    }
    clearFailures(`account-delete:${user.id}`);

    const requestedAt = result.deletionRequestedAt
      ? new Date(result.deletionRequestedAt)
      : new Date();
    const dueAt = deletionDueAt(requestedAt);
    // The token is issued even when mail is off: the settings screen that asked for the
    // deletion keeps it in memory for the banner's "Cancel" button, and the same token is
    // what the letter would carry. It never goes to storage.
    const issued = await issueAuthToken(store, {
      userId: user.id,
      purpose: "account_restore",
      email: found.email,
      now: requestedAt.getTime(),
    });
    if (mailConfig && mailConfig.driver !== "disabled") {
      try {
        await enqueueMail(
          store,
          {
            userId: user.id,
            toEmail: found.email,
            template: "account_deletion",
            locale,
            params: { name: found.name, date: formatDueDate(dueAt, locale) },
            linkParams: { link: `${mailConfig.appOrigin}/?restore=${issued.token}` },
            validUntil: issued.expiresAt,
          },
          { config: mailConfig },
        );
      } catch (error) {
        // The account is already stopped; a letter that could not be queued must not turn
        // that into an error. The in-memory token still lets this screen undo it.
        log.error?.("[account] deletion mail failed:", error.message);
      }
    }

    json(
      response,
      202,
      { deletionAt: dueAt.toISOString(), restoreToken: issued.token },
      { "Set-Cookie": clearedSessionCookie },
    );
    return true;
  }

  if (url.pathname === "/account/delete/cancel" && method === "POST") {
    const body = await readBody(request);
    if (!body || typeof body !== "object") {
      return fail(response, 400, "BAD_JSON", "malformed request"), true;
    }

    let userId = user?.id ?? null;
    let tokenId = null;
    if (!userId) {
      const value = String(body.token ?? "").trim();
      if (!value) return fail(response, 401, "AUTH_REQUIRED", "sign in first"), true;
      const row = await store.findAuthToken(hashAuthToken(value), "account_restore");
      if (!row || row.used_at) {
        return fail(response, 400, "TOKEN_INVALID", "this link is not valid"), true;
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        return fail(response, 400, "TOKEN_EXPIRED", "this link has expired"), true;
      }
      userId = row.user_id;
      tokenId = row.id;
    }

    let result;
    try {
      result = await cancelAccountDeletion({
        store,
        userId,
        actorId: userId,
        requestId,
      });
    } catch (error) {
      return refusal(response, error);
    }
    if (tokenId) await store.consumeAuthToken(tokenId);
    json(response, 200, { ok: true, state: result.state, changed: result.changed });
    return true;
  }

  return false;
}
