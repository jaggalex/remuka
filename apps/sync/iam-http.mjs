/**
 * The IAM surface's plumbing: JSON responses, bodies, cookies, sessions and the one
 * place where a board's effective access is resolved.
 *
 * Shared by the route modules in `iam-api-*.mjs`, and re-exported from `iam-api.mjs` so
 * existing callers keep one import path.
 */
import { randomUUID } from "node:crypto";
import {
  capabilitiesFor,
  effective,
  hashPassword,
  hashToken,
  isEmail,
  newToken,
  normalizeEmail,
  passwordProblem,
  verifyPassword,
} from "./iam.mjs";
import { emitMetric } from "./metrics-events.mjs";
import { MFA_REJECTS_TOTAL } from "./metrics.mjs";
import { appendSetCookie, cookies } from "./http-boundary.mjs";

const SESSION_COOKIE = "remo_session";
export const SESSION_DAYS = 30;
const BODY_LIMIT = 64 * 1024;


/* ---------------------------------------------------------------- helpers -- */

export function json(response, status, body, headers = {}) {
  const { "Set-Cookie": cookie, ...rest } = headers;
  // Append, so a handler's session cookie and the CSRF cookie queued for this request
  // both reach the browser.
  appendSetCookie(response, cookie);
  response.writeHead(status, { "Content-Type": "application/json", ...rest });
  response.end(JSON.stringify(body));
}

export function fail(response, status, code, message) {
  json(response, status, { error: code, message });
}

/**
 * The one refusal for a wrong second-factor answer (`spec/totp.md` §5.3, §6).
 *
 * A dead challenge and a locked account both answer `429 MFA_LOCKED`, because the next
 * move is the same: enter the password again. Only the account lock asks the client to
 * wait an hour; five wrong answers merely end this challenge. The
 * clock-skew counter is incremented here because this is the one place that sees the
 * verifier's reason, and a code that would pass two or three steps away is a server-time
 * problem rather than a wrong code.
 */
export function refuseSecondFactor(response, result, { metrics = null, retryAfter = "3600" } = {}) {
  if (result?.clockSkew) metrics?.inc("remo_mfa_clock_skew_rejects_total");
  metrics?.inc(MFA_REJECTS_TOTAL, { reason: result?.reason ?? "unknown" });
  if (result?.reason === "locked" || result?.reason === "exhausted") {
    const accountLocked = result.reason === "locked";
    json(
      response,
      429,
      {
        error: "MFA_LOCKED",
        message: accountLocked
          ? "too many wrong codes; code sign-in is closed for an hour"
          : "this challenge is finished; enter the password again",
        // The two refusals share a status and a code, so the screen still knows whether
        // waiting will help or the password has to be entered again now.
        reason: accountLocked ? "account" : "challenge",
      },
      accountLocked ? { "Retry-After": retryAfter } : {},
    );
    return;
  }
  fail(response, 401, "MFA_INVALID", "that code did not work");
}

export async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export function sessionCookie(token, secure) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    secure ? "; Secure" : ""
  }`;
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

/** A slug that is unique enough to be a room name and readable in a URL. */
export function boardIdFor(title) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = randomUUID().slice(0, 8);
  return slug ? `${slug}-${suffix}` : `board-${suffix}`;
}

export function orgSlugFor(name) {
  const base = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "workspace";
  return `${base}-${randomUUID().slice(0, 6)}`;
}

/** The session behind a request cookie, or null. */
export async function sessionFromRequest(request, store) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = await store.findSession(tokenHash);
  if (!row) return null;
  // `last_seen_at` is what the active-sessions screen shows; a successful request is the
  // cheapest place to renew it (ADR-153). It must not add latency to the request.
  store.touchSession?.(tokenHash).catch(() => {});
  return {
    tokenHash,
    sessionId: row.id,
    /** Step-up for the operator console; `null` until the password is re-entered. */
    operatorConfirmedAt: row.operator_confirmed_at ?? null,
    /** When this session last proved a TOTP code; `null` before the second step. */
    mfaAt: row.mfa_at ?? null,
    /** What proved it — `totp` or `recovery` — so a console action can name it (schema 37). */
    mfaFactor: row.mfa_factor ?? null,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      handle: row.handle,
      emailVerified: Boolean(row.email_verified_at),
      preferences: { theme: row.theme ?? null, lang: row.lang ?? null },
    },
  };
}

export function linkUnlockToken(request) {
  return cookies(request)["remo_link_unlock"] ?? null;
}

export function linkUnlockCookie(token, secure) {
  const maxAge = 12 * 60 * 60;
  return `remo_link_unlock=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    secure ? "; Secure" : ""
  }`;
}

/**
 * Board plus the decision for one viewer.
 *
 * One function for the HTTP routes and the WebSocket upgrade: two call sites that
 * computed access on their own is exactly how a socket ends up open after the API said
 * no (ADR-062).
 *
 * The public link is a board property, not a token (ADR-069): `visibility = link`
 * plus an enabled, unexpired link row is enough. A password gate is a server-side
 * unlock row keyed to `password_version`, so changing the password closes every
 * browser at once.
 */
export async function accessForBoard({ store, boardId, userId, unlockToken }) {
  const facts = await store.accessFacts(boardId, userId ?? null);
  if (!facts) return null;

  let link = null;
  let passwordRequired = false;
  let linkState = null;
  const operator = facts.operator ?? {};
  // The row is read even when the board is private: a disabled or expired link gets a
  // specific "link is not active" answer instead of the generic sign-in prompt, and
  // still discloses no title (B3).
  linkState = await store.getBoardLink(boardId);
  const linkExpired =
    linkState?.expires_at && new Date(linkState.expires_at).getTime() <= Date.now();
  if (
    facts.board.visibility === "link" &&
    !facts.board.archivedAt &&
    !operator.linkDisabled &&
    !operator.boardHidden
  ) {
    if (linkState?.enabled && !linkExpired) {
      if (linkState.has_password) {
        const unlocked = unlockToken
          ? await store.validLinkUnlock({
              boardId,
              tokenHash: hashToken(unlockToken),
              passwordVersion: linkState.password_version,
            })
          : false;
        if (unlocked) link = { role: "viewer" };
        else passwordRequired = true;
      } else {
        link = { role: "viewer" };
      }
    }
  }

  const access = effective({
    ...facts,
    policy: { canShare: facts.policy.canShare },
    link,
    operator,
  });

  return {
    facts,
    unclaimed: !facts.board.ownerId,
    link: linkState,
    // A signed-in member with a grant is not stopped by the link password.
    passwordRequired: passwordRequired && !access.allowed,
    // An operator's measure and a disabled or expired link look the same to a visitor: the
    // address is not active, and the answer is 404 (ADR-259 §4). A signed-in person gets
    // the generic refusal, because there may be a grant behind it that the measure does
    // not close.
    linkInactive:
      !access.allowed &&
      ((!facts.viewer?.userId &&
        (Boolean(operator.linkDisabled) || Boolean(operator.boardHidden))) ||
        (Boolean(linkState) && (!linkState.enabled || Boolean(linkExpired)))),
    // The decision the export route needs to honour "export stays available for the
    // organisation's administrators" without widening `effective` (ADR-259 §4).
    orgSuspended: Boolean(facts.board.orgSuspendedAt),
    isOrgAdmin: Boolean(facts.viewer?.isOrgAdmin),
    // v1 has no organisation settings screen, so an org-wide ban on public links has
    // nobody to set it; access follows the board's own link switch. The policy column
    // stays for the admin stage (spec/IAM-v1.md §13).
    access,
  };
}

/** The shape the Share dialog reads; it never includes a secret. */
export function publicLinkView(link, { operatorDisabled = false } = {}) {
  if (!link) {
    return {
      enabled: false,
      role: "viewer",
      hasPassword: false,
      expiresAt: null,
      expired: false,
      version: 0,
    };
  }
  const expired = Boolean(link.expires_at && new Date(link.expires_at).getTime() <= Date.now());
  return {
    // The share dialog must not offer a link an operator measure has suspended; the row
    // itself is untouched, so a revert restores the owner's own setting (ADR-259 §4).
    enabled: Boolean(link.enabled) && !operatorDisabled,
    role: link.role ?? "viewer",
    hasPassword: Boolean(link.has_password),
    expiresAt: link.expires_at ?? null,
    expired,
    version: link.version ?? 0,
  };
}
