/**
 * The peer collector (`spec/pulse.md` §5.3).
 *
 * Only the EU installation initiates: it asks the Russian one for its aggregates once an
 * hour and stores them with `provenance = 'peer'`. The Russian installation never makes an
 * outbound call. A collection is a window of at most thirty days; the first one reaches
 * back 200 days, later ones resume two days before the last stored day so a late correction
 * is carried over. The body is verified by its signature before JSON is parsed, and only
 * rows and one state row survive: no second copy of the payload exists.
 */
import { isPrivateHost, safeFetch } from "@remo/outbound";
import { PULSE_EXPORT_MAX_DAYS, pulseSignatureMatches } from "../pulse-export.mjs";
import { DIMS, normalizeDims } from "./catalog.mjs";
import { addDays, dayOf, daysBetween, fromDay, maxDay } from "./time.mjs";
import { peerStates, recordPeerFailure, savePeerWindow } from "./store.mjs";

/** A zone older than this is shown as "no data since …" and left out of "All" (§5.3). */
export const PULSE_PEER_FRESH_HOURS = 72;
export const PULSE_PEER_WINDOW_DAYS = 30;
export const PULSE_PEER_FIRST_DAYS = 200;
const MAX_BODY = 8 * 1024 * 1024;
const RETRY_DELAY_MS = 30_000;

/** A peer is a scheme and a host only: no path, no credentials, no private host. */
export function parsePeerOrigins(raw) {
  const values = String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origins = [];
  for (const value of values) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`REMO_PULSE_PEERS: ${value} is not an address`);
    }
    if (url.protocol !== "https:") {
      throw new Error(`REMO_PULSE_PEERS: ${value} must use https`);
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`REMO_PULSE_PEERS: ${value} must be a scheme and a host only`);
    }
    if (isPrivateHost(url.hostname)) {
      throw new Error(`REMO_PULSE_PEERS: ${value} is a private address`);
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}

/** Thirty-day windows, oldest first, covering `from`–`to` inclusively. */
export function exportWindows(from, to, size = PULSE_PEER_WINDOW_DAYS) {
  const windows = [];
  for (let start = from; start <= to; start = addDays(start, size)) {
    windows.push({ from: start, to: addDays(start, size - 1) > to ? to : addDays(start, size - 1) });
  }
  return windows;
}

const METRIC_NAME = /^[a-z][a-z0-9._-]{0,79}$/;
const STATUSES = new Set(["ok", "suppressed", "unavailable"]);
const BASES = new Set(["derived", "snapshot", "rebuilt"]);

function rejectRow(index, reason) {
  throw new Error(`row ${index}: ${reason}`);
}

/**
 * Check a peer's payload before it touches the database. The schema already refuses an
 * identifier-shaped dimension; this is the earlier, clearer refusal (§5.5).
 */
export function validateExportPayload(payload, { zone, rememberedZone = null }) {
  if (!payload || typeof payload !== "object") throw new Error("the body is not an object");
  if (payload.version !== 1) throw new Error("unsupported export version");
  if (payload.zone !== "eu" && payload.zone !== "ru") throw new Error("the body has no known zone");
  if (payload.zone === zone) throw new Error("this installation's own zone cannot be a peer");
  if (rememberedZone && payload.zone !== rememberedZone) {
    throw new Error(`the source changed its zone from ${rememberedZone} to ${payload.zone}`);
  }
  if (typeof payload.from !== "string" || typeof payload.to !== "string") {
    throw new Error("the body has no window");
  }
  try {
    fromDay(payload.from);
    fromDay(payload.to);
  } catch {
    throw new Error("the body's window is not made of UTC days");
  }
  if (payload.from > payload.to) throw new Error("the body's window is reversed");
  if (daysBetween(payload.from, payload.to) > PULSE_EXPORT_MAX_DAYS) {
    throw new Error("the body's window is longer than a year");
  }
  if (!Array.isArray(payload.rows)) throw new Error("the body has no rows");

  const rows = payload.rows.map((row, index) => {
    if (!row || typeof row !== "object") rejectRow(index, "is not an object");
    if (!METRIC_NAME.test(String(row.metric ?? ""))) rejectRow(index, "has an unknown metric name");
    let day;
    try {
      day = fromDay(row.day) && row.day;
    } catch {
      rejectRow(index, "has no UTC day");
    }
    if (!row.dims || typeof row.dims !== "object" || Array.isArray(row.dims)) {
      rejectRow(index, "has no dimensions object");
    }
    for (const [key, value] of Object.entries(row.dims)) {
      if (!DIMS.includes(key)) rejectRow(index, `carries an unknown dimension ${key}`);
      if (typeof value === "string" && value.includes("@")) rejectRow(index, "may not carry an address");
      if (key === "period" && !["week", "month"].includes(value)) rejectRow(index, "has a bad period");
      if (key === "offset" && (!Number.isInteger(value) || value < 0 || value > 52)) {
        rejectRow(index, "has a bad offset");
      }
    }
    if (!STATUSES.has(row.status)) rejectRow(index, "has an unknown status");
    if (!BASES.has(row.basis)) rejectRow(index, "has an unknown basis");
    const value = row.value === null || row.value === undefined ? null : Number(row.value);
    if (row.status === "ok") {
      if (!Number.isInteger(value) || value < 0) rejectRow(index, "is ok without a non-negative integer");
    } else if (value !== null) {
      rejectRow(index, "carries a value it must not have");
    }
    return {
      day,
      metric: row.metric,
      dims: normalizeDims(row.dims),
      value: row.status === "ok" ? value : null,
      status: row.status,
      basis: row.basis,
    };
  });
  return { zone: payload.zone, from: payload.from, to: payload.to, rows };
}

async function fetchWindow({ origin, token, window, fetchImpl }) {
  const url = `${origin}/api/operator/pulse/export?from=${window.from}&to=${window.to}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "error",
    timeoutMs: 30_000,
    maxBody: MAX_BODY,
    signal: null,
  });
  if (!response?.ok) throw new Error(`the peer answered ${response?.status ?? "nothing"}`);
  // The signature covers the bytes, so it is checked before the bytes are interpreted.
  const text = typeof response.text === "function" ? await response.text() : "";
  if (!pulseSignatureMatches(token, text, response.headers?.["x-pulse-signature"])) {
    throw new Error("the peer's signature does not match the body");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("the peer answered with malformed JSON");
  }
  return payload;
}

/**
 * One collector run for one origin. Returns the number of rows written.
 *
 * A failure is retried once after a delay; after that the row's `last_error` is updated
 * and the next hour tries again. There is no unbounded retry ladder here (§5.3).
 */
export async function collectPeer({
  origin,
  token,
  zone,
  pool,
  fetchImpl = safeFetch,
  metrics = null,
  log = console,
  now = () => new Date(),
  retryDelayMs = RETRY_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const today = dayOf(now());
  const yesterday = addDays(today, -1);
  const states = await peerStates(pool);
  const state = states.find((row) => row.origin === origin) ?? null;
  const from = state?.lastDay
    ? addDays(state.lastDay, -2)
    : addDays(yesterday, -(PULSE_PEER_FIRST_DAYS - 1));
  if (from > yesterday) return { rows: 0, skipped: "already current" };

  const attempt = async () => {
    const collected = [];
    let lastDay = state?.lastDay ?? null;
    let payloadZone = state?.zone ?? null;
    for (const window of exportWindows(from, yesterday)) {
      const payload = await fetchWindow({ origin, token, window, fetchImpl });
      const checked = validateExportPayload(payload, {
        zone,
        rememberedZone: payloadZone,
      });
      payloadZone = checked.zone;
      collected.push(...checked.rows);
      lastDay = maxDay(lastDay, ...checked.rows.map((row) => row.day), checked.to);
    }
    return { rows: collected, lastDay, zone: payloadZone };
  };

  try {
    let result;
    try {
      result = await attempt();
    } catch (first) {
      log.log(`[pulse] peer ${origin} failed (${first.message}); retrying once`);
      await sleep(retryDelayMs);
      result = await attempt();
    }
    const client = await pool.connect();
    try {
      await savePeerWindow(client, {
        origin,
        zone: result.zone ?? state?.zone,
        rows: result.rows,
        lastDay: result.lastDay,
        lastRows: result.rows.length,
      });
    } catch (error) {
      if (error.code === "23505") {
        throw new Error(`another installation already owns the ${result.zone} zone`);
      }
      throw error;
    } finally {
      client.release();
    }
    metrics?.inc?.("remo_pulse_peer_rows_total", { origin }, result.rows.length);
    metrics?.inc?.("remo_pulse_peer_collect_total", { result: "ok" });
    log.log(`[pulse] peer ${origin} rows ${result.rows.length}`);
    return { rows: result.rows.length, lastDay: result.lastDay };
  } catch (error) {
    metrics?.inc?.("remo_pulse_peer_collect_total", { result: "failed" });
    log.error?.(`[pulse] peer ${origin} failed: ${error.message ?? error}`);
    await recordPeerFailure(pool, { origin, error: error.message ?? String(error) }).catch(() => {});
    throw error;
  }
}

/**
 * The hourly loop at :20 (§5.3). One failure per origin per hour; no endless retries.
 */
export function createPeerCollector({
  peers = [],
  token = "",
  zone = "none",
  pool = null,
  fetchImpl = safeFetch,
  metrics = null,
  log = console,
  now = () => new Date(),
  retryDelayMs = RETRY_DELAY_MS,
  sleep,
} = {}) {
  let timer = null;
  let running = false;

  async function collectAll() {
    if (running) return 0;
    running = true;
    let total = 0;
    try {
      for (const origin of peers) {
        try {
          const result = await collectPeer({
            origin,
            token,
            zone,
            pool,
            fetchImpl,
            metrics,
            log,
            now,
            retryDelayMs,
            sleep,
          });
          total += result.rows ?? 0;
        } catch {
          // `collectPeer` has recorded the error; one origin must not stop the other.
        }
      }
      return total;
    } finally {
      running = false;
    }
  }

  function schedule() {
    const current = now();
    const next = new Date(current);
    next.setUTCMinutes(20, 0, 0);
    if (next.getTime() <= current.getTime()) next.setUTCHours(next.getUTCHours() + 1);
    timer = setTimeout(async () => {
      await collectAll();
      schedule();
    }, next.getTime() - current.getTime());
    timer.unref?.();
  }

  function start() {
    if (!pool || !peers.length || !token) return;
    schedule();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { start, stop, collectAll };
}

