import { fail, json, readBody } from "../iam-http.mjs";
import { emitMetric } from "../metrics-events.mjs";
import { catalogSlot, entityTag, languages, slots } from "./catalog.mjs";
import { publishedWords, saveWords, slotState } from "./store.mjs";

export async function handlePublicHints({ request, response, url, store }) {
  if (url.pathname === "/hints" && request.method === "GET") {
    const lang = url.searchParams.get("lang");
    if (!languages.includes(lang)) return fail(response, 422, "LANG_REQUIRED", "use ru or en"), true;
    let words = {};
    if (store.pool) {
      try { words = await publishedWords(store.pool, lang); }
      catch (error) { if (error.code !== "42P01") throw error; }
    }
    const etag = entityTag(words);
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (request.headers["if-none-match"] === etag) { response.writeHead(304, headers); response.end(); }
    else json(response, 200, { words }, headers);
    return true;
  }
  if (url.pathname === "/hints/event" && request.method === "POST") {
    const body = await readBody(request);
    const slot = catalogSlot(body?.slot);
    if (!slot || !["hint.shown","hint.acted"].includes(body.name) || !slot.defaults.en.some(v => v.key === body.variant)) {
      return fail(response, 422, "UNKNOWN_HINT", "unknown slot, action or variant"), true;
    }
    emitMetric({ name: body.name, actorType: "visitor", props: { slot: slot.id, variant: body.variant } });
    json(response, 202, { ok: true });
    return true;
  }
  return false;
}

export async function operatorWords({ request, response, store, session, url, metricsStore }, action) {
  if (action === "index") {
    const counts = await metricsStore?.pool?.query(
      `select slot,variant,sum(shown)::int as shown,sum(acted)::int as acted from hint_daily
        where day >= (now() at time zone 'UTC')::date-27 group by slot,variant`).catch(() => null);
    return json(response, 200, { slots, counts: counts?.rows ?? [], metricsAvailable: Boolean(counts) });
  }
  const id = url.searchParams.get("slot");
  const lang = url.searchParams.get("lang");
  const slot = catalogSlot(id);
  if (!slot || !languages.includes(lang)) return fail(response, 422, "UNKNOWN_HINT", "choose a slot and language");
  if (action === "read") return json(response, 200, await slotState(store.pool, slot, lang));
  const body = await readBody(request);
  try {
    const result = await saveWords(store.pool, { id, lang, action, body, operator: session.user.id,
      sessionId: session.sessionId, mfa: session.mfaFactor });
    return json(response, 200, result);
  } catch (error) {
    const invalid = ["conflict","unknown","fields","length","html","link","placeholder","emoji","voice","bold","enabled","reason"];
    if (!invalid.includes(error.code)) throw error;
    return json(response, error.code === "conflict" ? 409 : 422, { error: error.code, field: error.field, message: error.message });
  }
}
