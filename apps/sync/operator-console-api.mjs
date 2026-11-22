/**
 * The operator console's server surface (`spec/operator.md` §5, stage 2).
 *
 * One page at `/operator`; the service owns `/operator/...`, nginx strips `/api` like
 * every other route. Stage 2 is read-only: Pulse, Customers and the Journal, plus the
 * password re-entry that later changing actions will require.
 *
 * Every request is answered only for a holder of `instance_operators`. Everyone else —
 * signed in or not — gets `404`, the same answer an unknown path gets: the console's
 * existence is not disclosed (rule 1, §9). The global CSRF check in `server.mjs` already
 * covers the one POST route.
 */
import { emitMetric } from "./metrics-events.mjs";
import { fail, json, readBody, refuseSecondFactor, sessionFromRequest } from "./iam-http.mjs";
import { queueMfaLetter } from "./mfa-mail.mjs";
import { MFA_HOURLY_FAILURES } from "./mfa.mjs";
import { answerMfaChallenge, issueMfaChallenge } from "./mfa-signin.mjs";
import { readOperatorPulse } from "./operator-pulse.mjs";
import { handleOperatorAction, matchOperatorAction } from "./operator-console-actions.mjs";
import { handlePulseExport } from "./pulse-export.mjs";
import { kekFromEnv } from "./secrets.mjs";
import { resolveSupportConfig } from "./support.mjs";

/** A changing action needs a code no older than this (`spec/totp.md` §6). */
export const OPERATOR_STEP_UP_MS = 15 * 60 * 1000;
/** A read needs a code no older than this; twelve hours is the spec's number (§6). */
export const OPERATOR_READ_HOURS = 12;
export const OPERATOR_MFA_READ_MS = OPERATOR_READ_HOURS * 60 * 60 * 1000;

/**
 * True when this session proved a code recently enough for the console to open.
 * Pure, so the screens and the server read the same clock.
 */
export function operatorMfaReadFresh(mfaAt, now = Date.now()) {
  if (!mfaAt) return false;
  const at = new Date(mfaAt).getTime();
  return Number.isFinite(at) && now - at <= OPERATOR_MFA_READ_MS;
}

/**
 * True when the session proved a code recently enough to change something.
 * `spec/totp.md` §6 replaces the password re-entry with this window once a factor exists.
 */
export function operatorStepUpFresh(mfaAt, now = Date.now()) {
  if (!mfaAt) return false;
  const at = new Date(mfaAt).getTime();
  return Number.isFinite(at) && now - at <= OPERATOR_STEP_UP_MS;
}

/**
 * The guard a changing route calls before touching data. Exported now, used by stage 3,
 * and tested here so the refusal has one spelling.
 */
export function assertOperatorStepUp(session, now = Date.now()) {
  if (!operatorStepUpFresh(session?.mfaAt, now)) {
    const error = new Error("confirm with a code from the app before this action");
    error.code = "MFA_REQUIRED";
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The support conversation link, when this installation uses Chatwoot (§3). */
function supportLink(env) {
  try {
    const config = resolveSupportConfig(env);
    return config.provider === "chatwoot" ? config.origin : null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<boolean>} true when the request was an operator route.
 */
export async function handleOperatorConsole({
  request,
  response,
  url,
  store,
  env = process.env,
  metricsStore = null,
  metrics = null,
  log = console,
  now = () => new Date(),
} = {}) {
  if (url.pathname !== "/operator" && !url.pathname.startsWith("/operator/")) return false;

  // The peer export is the one `/operator` route whose access rule is a bearer token, not a
  // session (`spec/pulse.md` §5.2). It is answered here, before the session is read, so the
  // token check really does stand first; without a token or a zone it answers `false`.
  if (
    await handlePulseExport({
      request,
      response,
      url,
      env,
      metricsPool: metricsStore?.pool ?? null,
      metrics,
      log,
      now,
    })
  ) {
    return true;
  }

  const notFound = () => {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return true;
  };

  if (!store || typeof store.isInstanceOperator !== "function") return notFound();
  const session = await sessionFromRequest(request, store);
  if (!session) return notFound();
  const operator = await store.isInstanceOperator(session.user.id);
  if (!operator) return notFound();

  const method = (request.method ?? "GET").toUpperCase();
  const path = url.pathname.replace(/\/+$/, "") || "/operator";
  const action = matchOperatorAction(path, method);
  const confirmRoute = path === "/operator/session/confirm" && method === "POST";
  const known =
    confirmRoute ||
    action !== null ||
    (path === "/operator/session" && method === "GET") ||
    (path === "/operator/pulse" && method === "GET") ||
    (path === "/operator/customers" && method === "GET") ||
    (path.startsWith("/operator/customers/") && method === "GET") ||
    (path === "/operator/money" && method === "GET") ||
    (path === "/operator/measures" && method === "GET") ||
    (path === "/operator/journal" && method === "GET");
  // An unknown path stays a 404 even for an operator: the second factor changes what is
  // answered, not which paths exist.
  if (!known) return notFound();

  // Every row the console writes names its surface, so the journal can tell a console
  // step-up from a shell command (`spec/operator-actions.md` §3.1 rule 5).
  const record = (action, extra = {}) =>
    store
      .recordAudit({
        actorId: session.user.id,
        sessionId: session.sessionId,
        action,
        subject: session.user.id,
        channel: "console",
        ...extra,
      })
      .catch((error) => log.error?.("[operator] audit failed:", error?.message));

  const mfa = await store.mfaStatus(session.user.id);

  // A changing route is a different window from a read: fifteen minutes, not twelve hours
  // (`spec/totp.md` §6). The refusal is the same prompt the console already knows, so an
  // action after a timeout simply raises the code dialog and repeats itself.
  if (action) {
    try {
      assertOperatorStepUp(session, now().getTime());
    } catch {
      const operatorView = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      };
      if (!mfa.enrolled) {
        json(response, 403, {
          error: "MFA_REQUIRED",
          message: "enrol a second factor before taking this action",
          mfaRequired: true,
          enrollmentRequired: true,
          operator: operatorView,
        });
        return true;
      }
      const kek = kekFromEnv(env);
      if (!kek) {
        fail(response, 503, "MFA_UNAVAILABLE", "the key-encryption key is not configured");
        return true;
      }
      const issued = await issueMfaChallenge(store, {
        userId: session.user.id,
        purpose: "step_up",
      });
      json(response, 403, {
        error: "MFA_REQUIRED",
        message: "confirm with a code from the app before this action",
        mfaRequired: true,
        operator: operatorView,
        challenge: issued.challenge,
        expiresAt: issued.expiresAt.toISOString(),
        stepUpMs: OPERATOR_STEP_UP_MS,
        readHours: OPERATOR_READ_HOURS,
      });
      return true;
    }
    await handleOperatorAction({
      request,
      response,
      store,
      session,
      action,
      env,
      log,
    });
    return true;
  }

  /**
   * Reading needs a code no older than twelve hours (`spec/totp.md` §6). The refusal is
   * the console's own prompt: it names the challenge the step-up answer will spend, and
   * an operator who has not enrolled is sent to enrolment instead of being asked for a
   * code that cannot exist. A non-operator never reaches this line — 404 above.
   */
  if (!confirmRoute && !operatorMfaReadFresh(session.mfaAt, now().getTime())) {
    const operatorView = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
    if (!mfa.enrolled) {
      json(response, 403, {
        error: "MFA_REQUIRED",
        message: "enrol a second factor before opening the console",
        mfaRequired: true,
        enrollmentRequired: true,
        operator: operatorView,
      });
      return true;
    }
    const kek = kekFromEnv(env);
    if (!kek) {
      fail(response, 503, "MFA_UNAVAILABLE", "the key-encryption key is not configured");
      return true;
    }
    const issued = await issueMfaChallenge(store, {
      userId: session.user.id,
      purpose: "step_up",
    });
    json(response, 403, {
      error: "MFA_REQUIRED",
      message: "enter a code from the app to open the console",
      mfaRequired: true,
      operator: operatorView,
      challenge: issued.challenge,
      expiresAt: issued.expiresAt.toISOString(),
      stepUpMs: OPERATOR_STEP_UP_MS,
      readHours: OPERATOR_READ_HOURS,
    });
    return true;
  }

  if (path === "/operator/session" && method === "GET") {
    json(response, 200, {
      operator: { id: session.user.id, email: session.user.email, name: session.user.name },
      confirmedAt: session.operatorConfirmedAt ?? null,
      mfaAt: session.mfaAt ?? null,
      enrolled: mfa.enrolled,
      recoveryLeft: mfa.recoveryLeft,
      stepUpMs: OPERATOR_STEP_UP_MS,
      readHours: OPERATOR_READ_HOURS,
      readMs: OPERATOR_MFA_READ_MS,
      zone: env.REMO_COMPLIANCE_ZONE ?? "none",
    });
    return true;
  }

  if (confirmRoute) {
    const kek = kekFromEnv(env);
    if (!kek) {
      fail(response, 503, "MFA_UNAVAILABLE", "the key-encryption key is not configured");
      return true;
    }
    const body = await readBody(request);
    if (!body) {
      fail(response, 400, "BAD_JSON", "malformed request");
      return true;
    }
    // One mechanism with sign-in (`mfa-signin.mjs`): the same challenge, the same five
    // answers, the same ten-an-hour account lock. Only the outcome differs.
    const result = await answerMfaChallenge({
      store,
      token: body.challenge,
      purpose: "step_up",
      code: body.code,
      recoveryCode: body.recoveryCode,
      kek,
    });
    if (!result.ok) {
      if (result.justLocked) {
        await record("mfa.locked", { after: { wrongCodes: MFA_HOURLY_FAILURES } });
      }
      refuseSecondFactor(response, result, { metrics });
      return true;
    }
    const at = new Date();
    await store.setSessionMfaAt(
      session.sessionId,
      at,
      result.recovery ? "recovery" : "totp",
    );
    // The old column keeps its meaning — a person confirmed identity in this session —
    // but the factor is the lock now, so a code entry refreshes both windows together.
    await store.confirmOperatorSession(session.sessionId);
    await record("mfa.step_up", {
      after: { recovery: result.recovery },
      mfa: result.recovery ? "recovery" : "totp",
    });
    if (result.recovery) {
      await record("mfa.recovery_used", {
        after: { remaining: result.remaining },
        mfa: "recovery",
      });
      await queueMfaLetter({
        store,
        userId: session.user.id,
        toEmail: session.user.email,
        locale: session.user.lang,
        template: "mfa_recovery_used",
        params: { remaining: result.remaining ?? 0 },
      });
    }
    json(response, 200, {
      confirmedAt: at.toISOString(),
      mfaAt: at.toISOString(),
      stepUpMs: OPERATOR_STEP_UP_MS,
      readHours: OPERATOR_READ_HOURS,
    });
    return true;
  }

  if (path === "/operator/pulse" && method === "GET") {
    const weeks = Number(url.searchParams.get("weeks") ?? 12);
    const currency = url.searchParams.get("currency");
    const zoneFilter = String(url.searchParams.get("zone") ?? "all");
    const breakeven = Number(env.REMO_PULSE_BREAKEVEN ?? 43);
    emitMetric({
      name: "pulse.viewed",
      actorId: session.user.id,
      actorType: "user",
      sessionId: session.sessionId,
    });
    const pulse = await readOperatorPulse({
      store,
      metricsPool: metricsStore?.pool ?? null,
      weeks,
      currency,
      preferredCurrency:
        String(env.REMO_BILLING_CURRENCIES ?? "")
          .split(",")
          .map((value) => value.trim().toUpperCase())
          .find(Boolean) ?? null,
      breakeven: Number.isFinite(breakeven) && breakeven > 0 ? breakeven : 43,
      zone: env.REMO_COMPLIANCE_ZONE ?? "none",
      zoneFilter,
      now: now(),
      health: {
        storeWriteErrors: metrics?.total?.("remo_store_write_errors_total") ?? null,
        storeWrites: metrics?.total?.("remo_store_writes_total") ?? null,
        aiUnavailable: metrics?.total?.("remo_ai_gateway_unavailable_total") ?? null,
        wsRejected: metrics?.total?.("remo_ws_rejected_total") ?? null,
      },
      log,
    });
    json(response, 200, pulse);
    return true;
  }

  if (path === "/operator/customers" && method === "GET") {
    const query = String(url.searchParams.get("q") ?? "").trim();
    const matches = query.length < 2 ? [] : await store.searchOperatorCustomers(query);
    json(response, 200, { query, matches, supportUrl: supportLink(env) });
    return true;
  }

  const card = /^\/operator\/customers\/(user|org)\/([^/]+)$/.exec(path);
  if (card && method === "GET") {
    const [, kind, rawId] = card;
    const id = decodeURIComponent(rawId);
    if (!UUID.test(id) && kind === "user") {
      fail(response, 400, "BAD_ID", "the account id must be a uuid");
      return true;
    }
    const data =
      kind === "user"
        ? await store.operatorCustomerByEmail(
            (await store.findUserById?.(id))?.email ?? id,
          )
        : await store.operatorCustomerByOrg(id);
    if (!data) {
      fail(response, 404, "CUSTOMER_NOT_FOUND", "no such customer");
      return true;
    }
    json(response, 200, { ...data, supportUrl: supportLink(env), zone: env.REMO_COMPLIANCE_ZONE ?? "none" });
    return true;
  }

  if (path === "/operator/money" && method === "GET") {
    const overview = await store.operatorMoneyOverview({
      limit: Number(url.searchParams.get("limit") ?? 50),
    });
    json(response, 200, overview);
    return true;
  }

  if (path === "/operator/measures" && method === "GET") {
    const actions = await store.listOperatorActions({ openOnly: true, limit: 200 });
    json(response, 200, { actions });
    return true;
  }

  if (path === "/operator/journal" && method === "GET") {
    const action = url.searchParams.get("action");
    const actor = url.searchParams.get("actor");
    const org = url.searchParams.get("org");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    for (const [name, value] of [["actor", actor], ["org", org]]) {
      if (value && !UUID.test(value)) {
        fail(response, 400, "BAD_FILTER", `--${name} filter must be a uuid`);
        return true;
      }
    }
    const events = await store.operatorJournal({
      action: action ? `${action.replace(/[%_]/g, "")}%` : null,
      actor: actor || null,
      org: org || null,
      from: from && !Number.isNaN(new Date(from).getTime()) ? new Date(from) : null,
      to: to && !Number.isNaN(new Date(to).getTime()) ? new Date(to) : null,
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    json(response, 200, { events });
    return true;
  }

  return notFound();
}
