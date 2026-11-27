/**
 * The one way `chrome.used` enters the metrics database (`spec/tidy-desk.md` §9,
 * ADR-266, ADR-294).
 *
 * The browser cannot write metrics directly: it sends the id of the command it ran and
 * the organisation it ran it in. The envelope carries the organisation, because the rule
 * is "once per organisation per day", and no person or session: the event's `props` is
 * nothing but the control, so the stream cannot be read as "who did what where". The
 * first click of a control per organisation per UTC day is kept by the partial unique
 * index in `METRICS_SCHEMA`; later clicks are the same fact and the sink drops them.
 *
 * A missing metrics database is not an error: the sink is best-effort and the product
 * must not depend on it. The route still answers `202` so the client never retries into
 * a loop.
 */
import { CHROME_CONTROL_IDS } from "@remo/metrics";
import { fail, json, readBody, sessionFromRequest } from "../iam-http.mjs";
import { emitMetric } from "../metrics-events.mjs";

export async function handleChromeUseRoute({ request, response, url, store } = {}) {
  if (url?.pathname !== "/chrome/used") return false;

  const method = (request.method ?? "GET").toUpperCase();
  if (method !== "POST") {
    fail(response, 405, "METHOD_NOT_ALLOWED", "chrome.used is a POST");
    return true;
  }
  if (!store || typeof store.getOrgBySlug !== "function") {
    fail(response, 501, "IAM_UNAVAILABLE", "accounts need the postgres store");
    return true;
  }

  const session = await sessionFromRequest(request, store);
  if (!session) {
    fail(response, 401, "AUTH_REQUIRED", "sign in first");
    return true;
  }

  // The organisation is addressed by slug, which is what the room and the home already
  // have; the event then names it as an id in the envelope, like every product metric.
  const slug = String(url.searchParams.get("org") ?? "").trim();
  if (!slug) {
    fail(response, 422, "ORG_REQUIRED", "the organisation slug is required");
    return true;
  }
  const org = await store.getOrgBySlug(slug);
  if (!org) {
    fail(response, 404, "RESOURCE_NOT_AVAILABLE", "not found");
    return true;
  }
  const membership = store.withTenant
    ? await store.withTenant(org.id, () => store.getOrgMembership(org.id, session.user.id))
    : await store.getOrgMembership(org.id, session.user.id);
  if (!membership || membership.state !== "active") {
    fail(response, 403, "FORBIDDEN", "this organisation is not yours");
    return true;
  }

  const body = await readBody(request);
  const control = typeof body?.control === "string" ? body.control : null;
  if (!control || !CHROME_CONTROL_IDS.includes(control)) {
    fail(response, 422, "UNKNOWN_CONTROL", "the control is not in the registry");
    return true;
  }

  emitMetric({
    name: "chrome.used",
    orgId: org.id,
    // The event answers "which element", not "who". The organisation is needed to count
    // one fact per day; a person or a session is not, so neither is written (ADR-294).
    actorId: null,
    actorType: "user",
    sessionId: null,
    props: { control },
  });
  json(response, 202, { ok: true });
  return true;
}
