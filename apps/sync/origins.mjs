/**
 * The addresses this installation answers on during the move to a new origin
 * (ADR-254, `spec/rebrand.md` §6).
 *
 * A move cannot be a single switch. Bookmarks, invitations, integration tokens, MCP
 * clients and open tabs still name the old address while the new one already exists.
 * The old addresses therefore stay *allowed* — `REMO_APP_ORIGIN_ALIASES` — while
 * `REMO_APP_ORIGIN` remains the one canonical address that is written into mail, links
 * and exports. Nothing here extends a cookie domain: a cookie belongs to the host that
 * set it, and the old host only ever redirects or proxies.
 *
 * Three decisions follow from the list and live here, so the HTTP server and the socket
 * upgrade cannot disagree:
 *
 * - `allowedOrigins` in `csrf.mjs` accepts the primary origin, the aliases and the move
 *   target (the browser is sent there by us, so it must be able to connect at once);
 * - CORS echoes the alias that actually called, because one response carries one value;
 * - a request on an alias origin or an alias host is marked deprecated in its headers.
 */
/** The methods and request headers the read API answers CORS preflights for. */
export const CORS_METHODS = "GET, POST, DELETE, OPTIONS";
export const CORS_HEADERS = "Content-Type, If-Match, Idempotency-Key, Authorization, X-CSRF-Token";

/** An origin is scheme, host and port. Anything else in the value is not part of it. */
export function normalizeOrigin(raw) {
  const value = String(raw ?? "").trim();
  if (!value || value === "*") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    // A malformed setting is ignored, never a reason to allow everything.
    return null;
  }
}

/** A comma-separated list of origins, normalised and de-duplicated; bad entries dropped. */
export function originList(raw) {
  const out = [];
  for (const entry of String(raw ?? "").split(",")) {
    const origin = normalizeOrigin(entry);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/** The old addresses that still answer: `REMO_APP_ORIGIN_ALIASES`. */
export function appOriginAliases(env = process.env) {
  return originList(env.REMO_APP_ORIGIN_ALIASES);
}

/** Where the browser is sent after a `4001 moved` close or a redirect. */
export function movedOrigin(env = process.env) {
  return normalizeOrigin(env.REMO_APP_ORIGIN_MOVED);
}

/** The one address that goes into mail and links. */
export function canonicalAppOrigin(env = process.env) {
  return normalizeOrigin(env.REMO_APP_ORIGIN);
}

/** True when the header value is one of the old addresses. */
export function isAliasOrigin(header, env = process.env) {
  const origin = normalizeOrigin(header);
  return origin !== null && appOriginAliases(env).includes(origin);
}

/** Trust `X-Forwarded-*` only when the operator says a proxy sits in front. */
export function proxyTrusted(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.REMO_TRUST_PROXY ?? ""));
}

/**
 * The host the request was addressed to.
 *
 * nginx sends `Host $host`, so the plain header is enough for the shipped setup. A
 * proxy that preserves the original host in `X-Forwarded-Host` is read too, but only
 * under `REMO_TRUST_PROXY=1`: on a direct connection the header is client-controlled.
 */
export function requestHost(request, env = process.env) {
  if (proxyTrusted(env)) {
    const forwarded = String(request.headers["x-forwarded-host"] ?? "")
      .split(",")[0]
      .trim();
    if (forwarded) return forwarded.toLowerCase();
  }
  return String(request.headers.host ?? "").trim().toLowerCase();
}

/** True when the request was addressed to one of the old hosts. */
export function isAliasHost(host, env = process.env) {
  const name = String(host ?? "").trim().toLowerCase();
  if (!name) return false;
  return appOriginAliases(env).some((origin) => new URL(origin).host.toLowerCase() === name);
}

/**
 * The CORS headers for one response.
 *
 * A named `REMO_CORS_ORIGIN` used to be echoed blindly. With aliases in play the
 * caller may be any of several allowed origins, and a browser only accepts the header
 * that equals its own origin — so the matching caller is echoed and `Vary: Origin` keeps
 * a cache from handing one caller another's header. A request from outside the list
 * still gets the canonical value, which the browser then refuses, exactly as before.
 */
export function corsHeadersFor(request, env = process.env) {
  const configured = String(env.REMO_CORS_ORIGIN ?? "*");
  if (configured === "*") {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": CORS_METHODS,
      "Access-Control-Allow-Headers": CORS_HEADERS,
    };
  }

  const allowed = new Set(
    [
      canonicalAppOrigin(env),
      movedOrigin(env),
      ...appOriginAliases(env),
      normalizeOrigin(configured),
    ].filter(Boolean),
  );
  const caller = normalizeOrigin(request.headers.origin);
  return {
    // Sessions travel in a cookie, so a named origin is required for credentials.
    "Access-Control-Allow-Origin": caller && allowed.has(caller) ? caller : configured,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_HEADERS,
    Vary: "Origin",
  };
}

/**
 * The successor address an old request points at.
 *
 * The move target wins: during the transition `REMO_APP_ORIGIN` may still name the old
 * host (stage 6 of the plan), and a `Deprecation` header must point at the new one.
 */
export function successorOrigin(env = process.env) {
  return movedOrigin(env) ?? canonicalAppOrigin(env);
}

/**
 * `Deprecation` and `Link` for a request that still uses an old address.
 *
 * The decision is made from the `Origin` header first (a browser request) and from the
 * host second (an integration token, a CLI, a webhook sender — no Origin at all).
 * The response itself does not change: the proxy or the service keeps answering, and
 * the headers tell the caller to move before the old address is switched off.
 *
 * `Link` names the successor origin only. The sync service sees the path with the
 * public prefix already stripped by the proxy (`/api` → `/`), so a full path here would
 * be the wrong one; nginx adds its own `Link` with `$request_uri` where it knows it.
 */
export function deprecationHeaders(request, env = process.env) {
  const origin = normalizeOrigin(request.headers.origin);
  const aliased =
    (origin !== null && appOriginAliases(env).includes(origin)) ||
    isAliasHost(requestHost(request, env), env);
  if (!aliased) return {};

  const headers = { Deprecation: "true" };
  const successor = successorOrigin(env);
  if (successor) headers.Link = `<${successor}>; rel="successor-version"`;
  return headers;
}
