/**
 * The consent choice and its journal (ADR-255, `spec/cookies.md` §4).
 *
 * `POST /consent` records what a person chose and gives the browser the `remo_consent`
 * cookie; `GET /consent` reads the same cookie back without writing anything. The cookie
 * is the state of one browser and never names a person, so a forged value only changes
 * the forger's own browser. The journal is the proof for a signed-in account and is
 * written only when the choice actually changes.
 *
 * The zone comes from the installation, not from the request: a browser on an EU server
 * cannot post a Russian choice, or the banner would claim a policy the person never saw.
 * `necessary` and `preferences` are dropped and no unknown category is accepted (§1 rule 2,
 * §4).
 *
 * The policy edition is strict: `POST /consent` accepts only the edition this build
 * publishes (`POLICY_VERSION`) and answers `409 POLICY_OUTDATED` with `current` otherwise
 * (§4, §11 question (в)). A choice therefore always names the text the person actually saw;
 * an older bundle is told to read the current state and ask again.
 *
 * Both answers carry `policyVersion`, so the client reads the edition it stored from the
 * same field in `GET` and `POST` instead of inferring it from its own bundle.
 *
 * A failed journal write is one counter (`consent_journal_failed_total`) and a log line,
 * never a failed choice (§4, §11 question (б)).
 */
import {
  CATEGORIES,
  CONSENT_CHOICE_CATEGORIES,
  CONSENT_COOKIE,
  POLICY_VERSION,
  consentCookieExpiresAt,
  consentCookieMaxAge,
  defaultChoices,
  encodeConsentValue,
  isPolicyVersion,
  normalizeChoices,
  parseConsentValue,
} from "@remo/consent";
import { appendSetCookie, cookies } from "./http-boundary.mjs";
import { readJsonBody } from "./http-body.mjs";
import { sessionFromRequest } from "./iam-http.mjs";
import { hashedClientIp, requestUserAgent } from "./ip-hash.mjs";
import { CONSENT_JOURNAL_FAILED_TOTAL } from "./metrics.mjs";

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    // A choice belongs to this browser and this instant; a cache must not replay it.
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function fail(response, status, code, message, extra = {}) {
  json(response, status, { error: code, message, ...extra });
}

/**
 * Only the two optional tracking categories; the rest of the registry is not asked here.
 * `necessary` and `preferences` are dropped rather than refused: a client that sends them
 * is describing the screen it drew, not asking for something the service may allow.
 */
function readChoices(raw) {
  if (raw === undefined || raw === null) return { choices: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "BAD_CHOICES", message: "choices must be an object" };
  }
  const choices = {};
  for (const [category, value] of Object.entries(raw)) {
    // `necessary` cannot be switched off and `preferences` is necessary-by-choice in both
    // zones (§2), so neither is part of this question.
    if (CATEGORIES.includes(category) && !CONSENT_CHOICE_CATEGORIES.includes(category)) continue;
    if (!CATEGORIES.includes(category)) {
      return {
        error: "UNKNOWN_CATEGORY",
        message: `unknown consent category ${JSON.stringify(category)}`,
      };
    }
    if (typeof value !== "boolean") {
      return { error: "BAD_CHOICES", message: `choices.${category} must be a boolean` };
    }
    choices[category] = value;
  }
  return { choices };
}

/** The two optional categories as stored in the journal and the cookie. */
function optionalChoices(zone, choices) {
  const effective = normalizeChoices(zone, choices);
  return Object.fromEntries(
    CONSENT_CHOICE_CATEGORIES.map((category) => [category, effective[category] === true]),
  );
}

/** Whether two stored choices are the same decision for this zone and policy edition. */
function unchanged(previous, zone, choices, policyVersion) {
  if (!previous) return false;
  if (previous.zone !== zone) return false;
  if (previous.policy_version !== policyVersion) return false;
  const stored = previous.choices ?? {};
  return CONSENT_CHOICE_CATEGORIES.every(
    (category) => (stored[category] === true) === (choices[category] === true),
  );
}

/**
 * The `Set-Cookie` line. `HttpOnly` is deliberately absent: the client reads the choice
 * to decide which optional category may run. The name is written as a literal because
 * `scripts/consent-check.mjs` resolves the name from the serialization (§8 rule 1).
 */
function consentCookie(value, maxAge, secure) {
  return `remo_consent=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${
    secure ? "; Secure" : ""
  }`;
}

/**
 * @param {{
 *   request: import("node:http").IncomingMessage,
 *   response: import("node:http").ServerResponse,
 *   url: URL,
 *   store: any,
 *   zone?: "eu" | "ru" | "none",
 *   secure?: boolean,
 *   metrics?: { inc?: (name: string, labels?: Record<string, string>) => void } | null,
 *   log?: { error?: (...args: unknown[]) => void },
 * }} input
 * @returns {Promise<boolean>} true when this was a `/consent` request.
 */
export async function handleConsentRoutes({
  request,
  response,
  url,
  store,
  zone = "none",
  secure = process.env.NODE_ENV === "production",
  metrics = null,
  log = console,
}) {
  if (url.pathname !== "/consent") return false;

  const method = request.method ?? "GET";
  if (method === "GET") {
    const raw = cookies(request)[CONSENT_COOKIE];
    const parsed = raw ? parseConsentValue(raw) : null;
    // A cookie from another zone or another format is not a choice here.
    if (!parsed || parsed.zone !== zone) {
      json(response, 200, null);
      return true;
    }
    json(response, 200, {
      zone,
      choices: normalizeChoices(zone, parsed.choices),
      policyVersion: parsed.policyVersion,
    });
    return true;
  }

  if (method !== "POST") {
    json(
      response,
      405,
      { error: "METHOD_NOT_ALLOWED", message: "GET or POST" },
      { Allow: "GET, POST" },
    );
    return true;
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(response, 400, "BAD_JSON", "malformed request");
    return true;
  }

  if (body.zone !== zone) {
    fail(response, 409, "ZONE_MISMATCH", "this installation follows another zone", {
      zone,
    });
    return true;
  }

  const read = readChoices(body.choices);
  if (read.error) {
    fail(response, 422, read.error, read.message);
    return true;
  }

  const policyVersion = typeof body.policyVersion === "string" ? body.policyVersion.trim() : "";
  if (!isPolicyVersion(policyVersion)) {
    fail(response, 422, "BAD_POLICY_VERSION", "policyVersion is required");
    return true;
  }
  // Strict match (§4): a choice belongs to the text the person read. A stale edition is
  // not stored under a policy it never saw, and `current` tells the client which one to
  // read instead.
  if (policyVersion !== POLICY_VERSION) {
    fail(
      response,
      409,
      "POLICY_OUTDATED",
      "the cookie policy changed; read the current choice and confirm again",
      { current: POLICY_VERSION },
    );
    return true;
  }

  // The `none` zone has no banner, no optional category and no cookie (§3). A caller that
  // still posts gets the safe defaults so it can stop asking, but nothing is stored.
  if (zone === "none") {
    json(response, 200, {
      zone,
      policyVersion: POLICY_VERSION,
      choices: defaultChoices(zone),
      expiresAt: null,
    });
    return true;
  }

  const choices = optionalChoices(zone, read.choices);
  const maxAge = consentCookieMaxAge(zone);
  appendSetCookie(
    response,
    consentCookie(encodeConsentValue({ zone, policyVersion, choices }), maxAge, secure),
  );

  const session =
    typeof store.findSession === "function" ? await sessionFromRequest(request, store) : null;
  const userId = session?.user?.id ?? null;
  if (userId && typeof store.recordConsentEvent === "function") {
    const previous =
      typeof store.latestConsentEvent === "function"
        ? await store.latestConsentEvent(userId).catch(() => null)
        : null;
    if (!unchanged(previous, zone, choices, policyVersion)) {
      await store
        .recordConsentEvent({
          userId,
          zone,
          choices,
          policyVersion,
          userAgent: requestUserAgent(request),
          ipHash: hashedClientIp(request),
        })
        .catch((error) => {
          // The person's choice must not fail because the proof could not be written; the
          // counter makes the lost row visible (§4, question (б) of §11).
          metrics?.inc?.(CONSENT_JOURNAL_FAILED_TOTAL);
          log.error?.("[consent] journal write failed:", error?.message ?? error);
          return null;
        });
    }
  }

  json(response, 200, {
    zone,
    policyVersion: POLICY_VERSION,
    choices: normalizeChoices(zone, choices),
    expiresAt: consentCookieExpiresAt(zone),
  });
  return true;
}
