/**
 * The peer export endpoint (`spec/pulse.md` §5.2).
 *
 * `GET /operator/pulse/export` answers an installation that collects aggregates: the
 * local rows of this zone, in a stable order, signed with an HMAC over the exact bytes of
 * the body. The token is the whole access rule — no session, no cookie, no CSRF: this is a
 * machine route, and the token check stands before the console's session check (the one
 * exception of §5.2).
 *
 * The body is built once and signed once. Compression would change the bytes and break
 * the signature, and the row count and the origin are the only things logged: the body,
 * the caller's address and the user agent are not kept anywhere.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { dayOf, addDays, daysBetween, fromDay } from "./pulse/time.mjs";
import { metricEntry, suppressesSmallCell } from "./pulse/catalog.mjs";
import { readExportRows } from "./pulse/store.mjs";

export const PULSE_EXPORT_PATH = "/operator/pulse/export";
export const PULSE_EXPORT_VERSION = 1;
/** One answer is at most a year and a day, and the collector asks for thirty days (§5.1). */
export const PULSE_EXPORT_MAX_DAYS = 366;

/** Constant-time token comparison on the SHA-256 of both sides. */
export function pulseTokenMatches(given, expected) {
  if (!expected) return false;
  const a = createHash("sha256").update(String(given ?? "")).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

/** The signature over the bytes of the body, as the sender computes it. */
export function signPulseBody(token, body) {
  return `sha256=${createHmac("sha256", String(token)).update(body, "utf8").digest("hex")}`;
}

/** True when a signature is the one this token makes for these bytes. */
export function pulseSignatureMatches(token, body, header) {
  const expected = signPulseBody(token, body);
  const given = String(header ?? "");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** Dims sorted by key: two equal cells always produce the same text and sort position. */
function stableDims(dims) {
  const out = {};
  for (const key of Object.keys(dims ?? {}).sort()) out[key] = dims[key];
  return out;
}

function sortKey(row) {
  return `${row.day}\u0000${row.metric}\u0000${JSON.stringify(stableDims(row.dims))}`;
}

/**
 * What a peer may see: local rows only, small externally observable cells suppressed.
 *
 * Suppression belongs to the export, not to storage (§5.1): this installation still sees
 * its own true numbers. The row keeps its status so the receiver draws "—"/"<5" instead of
 * a hole.
 */
export function prepareExportRows(rows) {
  return rows
    // Only aggregates of §1.2–1.3 travel. An operator metric written into the table later
    // must not leave the installation just because it is a row (§5.1).
    .filter((row) => metricEntry(row.metric) !== null)
    .map((row) => {
      const dims = stableDims(row.dims);
      const hide = row.status === "ok" && suppressesSmallCell(dims, row.value);
      return {
        day: row.day,
        metric: row.metric,
        dims,
        value: hide ? null : row.value,
        status: hide ? "suppressed" : row.status,
        basis: row.basis,
      };
    })
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
}

/** JSON in the shape §5.1 documents; `value` is omitted when there is none. */
export function exportPayload({ zone, from, to, generatedAt, rows }) {
  const wire = rows.map((row) => {
    const out = { day: row.day, metric: row.metric, dims: row.dims };
    if (row.value !== null && row.value !== undefined) out.value = row.value;
    out.status = row.status;
    out.basis = row.basis;
    return out;
  });
  return {
    version: PULSE_EXPORT_VERSION,
    zone,
    generatedAt,
    from,
    to,
    rows: wire,
  };
}

/** Date validation with a refusal, never a silent clamp (§5.2). */
export function parseExportWindow({ from, to, now = new Date() }) {
  const yesterday = addDays(dayOf(now), -1);
  for (const [name, value] of [["from", from], ["to", to]]) {
    if (!value) throw new Error(`--${name} is required`);
    try {
      fromDay(value);
    } catch {
      throw new Error(`${name} must be a UTC day (YYYY-MM-DD)`);
    }
  }
  if (from > to) throw new Error("from must not be after to");
  if (to > yesterday) throw new Error("to must not be in the future; the last full day is yesterday");
  if (daysBetween(from, to) > PULSE_EXPORT_MAX_DAYS) {
    throw new Error(`the window is longer than ${PULSE_EXPORT_MAX_DAYS} days`);
  }
  return { from, to, yesterday };
}

function notFound(response) {
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "RESOURCE_NOT_AVAILABLE", message: "not found" }));
}

function badRequest(response, message) {
  response.writeHead(400, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "BAD_WINDOW", message }));
}

/**
 * @returns {Promise<boolean>} true when this request belonged to the route.
 */
export async function handlePulseExport({
  request,
  response,
  url,
  env = process.env,
  metricsPool = null,
  metrics = null,
  log = console,
  now = () => new Date(),
} = {}) {
  if (url.pathname !== PULSE_EXPORT_PATH) return false;
  const token = String(env.REMO_PULSE_TOKEN ?? "");
  const zone = String(env.REMO_COMPLIANCE_ZONE ?? "none");
  // Without a token or a zone the route does not exist: the console's 404 is the answer,
  // exactly as if this module were absent (§5.1, §5.2).
  if (!token || (zone !== "eu" && zone !== "ru")) return false;
  if ((request.method ?? "GET").toUpperCase() !== "GET") {
    notFound(response);
    return true;
  }

  const header = String(request.headers.authorization ?? "");
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!pulseTokenMatches(given, token)) {
    notFound(response);
    return true;
  }
  if (!metricsPool) {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "PULSE_UNAVAILABLE", message: "the metrics database is not configured" }));
    return true;
  }

  let window;
  try {
    window = parseExportWindow({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      now: now(),
    });
  } catch (error) {
    badRequest(response, error.message);
    return true;
  }

  const read = await readExportRows(metricsPool, { zone, from: window.from, to: window.to });
  const rows = prepareExportRows(read);
  const body = JSON.stringify(
    exportPayload({
      zone,
      from: window.from,
      to: window.to,
      generatedAt: now().toISOString(),
      rows,
    }),
  );

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Pulse-Signature": signPulseBody(token, body),
  });
  response.end(body);

  metrics?.inc?.("remo_pulse_export_rows_total", {}, rows.length);
  // One line, no body: the collector's address and user agent are not stored (§5.2).
  log.log(
    `[pulse] export ${request.headers.origin ?? request.headers.host ?? "-"} ${window.from}..${window.to} rows ${rows.length}`,
  );
  return true;
}
