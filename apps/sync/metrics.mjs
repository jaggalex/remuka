/**
 * Prometheus metrics for the sync service.
 *
 * Deliberately tiny: a counter and a gauge registry plus one text renderer, in the
 * exposition format Prometheus scrapes. No dependency, because the service is the
 * thing that must stay up when everything else is broken.
 *
 * Naming follows Prometheus conventions — `<namespace>_<thing>_<unit>`, counters end
 * in `_total`, gauges describe a value that goes up and down.
 */

import { timingSafeEqual } from "node:crypto";

function labelKey(name, labels) {
  const entries = Object.entries(labels ?? {}).filter(([, value]) => value !== undefined);
  if (!entries.length) return name;
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${name}{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export class Metrics {
  constructor() {
    /** Counter values keyed by name and labels; counters only ever increase. */
    this.counters = new Map();
    /** Gauge values keyed by name and labels; set, not accumulated. */
    this.gauges = new Map();
    /** Human-readable help text, one line per metric family. */
    this.help = new Map();
  }

  describe(name, text, type = "counter") {
    this.help.set(name, { text, type });
  }

  /** Add to a counter. `labels` distinguishes series of the same metric. */
  inc(name, labels, value = 1) {
    const key = labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  /** Set a gauge to an absolute value. */
  set(name, value, labels) {
    this.gauges.set(labelKey(name, labels), value);
  }

  /** The sum of every label series of one counter; 0 when it was never incremented. */
  total(name) {
    let sum = 0;
    for (const [key, value] of this.counters) {
      if (key.split("{")[0] === name) sum += value;
    }
    return sum;
  }

  /**
   * Render the registry in the Prometheus text exposition format.
   *
   * One `# TYPE` line per metric family, then one sample line per label set.
   */
  render() {
    const lines = [];
    const counters = [...this.counters.entries()];
    const gauges = [...this.gauges.entries()];
    const nameOf = (key) => key.split("{")[0];
    const names = new Set([
      ...counters.map(([key]) => nameOf(key)),
      ...gauges.map(([key]) => nameOf(key)),
    ]);

    for (const name of names) {
      const isCounter = counters.some(([key]) => nameOf(key) === name);
      const meta = this.help.get(name);
      if (meta?.text) lines.push(`# HELP ${name} ${meta.text}`);
      lines.push(`# TYPE ${name} ${meta?.type ?? (isCounter ? "counter" : "gauge")}`);
      for (const [key, value] of counters) {
        if (nameOf(key) === name) lines.push(`${key} ${formatValue(value)}`);
      }
      for (const [key, value] of gauges) {
        if (nameOf(key) === name) lines.push(`${key} ${formatValue(value)}`);
      }
    }

    return lines.join("\n");
  }
}

function formatValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

/**
 * Process-level metrics.
 *
 * Rendered on demand rather than registered as gauges: they are read from the
 * runtime at scrape time, so nothing has to keep them fresh.
 */
export function processMetrics(startedAt) {
  const memory = process.memoryUsage();
  const uptime = Math.max(0, (Date.now() - startedAt) / 1000);
  return [
    "# HELP remo_process_uptime_seconds Seconds since the service started",
    "# TYPE remo_process_uptime_seconds gauge",
    `remo_process_uptime_seconds ${uptime.toFixed(3)}`,
    "# HELP remo_process_resident_memory_bytes Resident memory size",
    "# TYPE remo_process_resident_memory_bytes gauge",
    `remo_process_resident_memory_bytes ${memory.rss}`,
    "# HELP remo_process_heap_used_bytes Heap in use",
    "# TYPE remo_process_heap_used_bytes gauge",
    `remo_process_heap_used_bytes ${memory.heapUsed}`,
    "# HELP remo_process_nodejs_eventloop_lag_seconds Event loop lag, measured now",
    "# TYPE remo_process_nodejs_eventloop_lag_seconds gauge",
    `remo_process_nodejs_eventloop_lag_seconds ${eventLoopLagSeconds().toFixed(6)}`,
  ].join("\n");
}

/**
 * Event loop lag.
 *
 * Measured by scheduling a timer for "now" and timing how late it fires — the same
 * trick `prom-client` uses, without the dependency.
 */
let lastLag = 0;
export function eventLoopLagSeconds() {
  return lastLag / 1000;
}

export function watchEventLoop(resolutionMs = 500) {
  let expected = Date.now() + resolutionMs;
  const timer = setInterval(() => {
    const now = Date.now();
    lastLag = Math.max(0, now - expected);
    expected = now + resolutionMs;
  }, resolutionMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * The consent journal is proof, not a condition of the answer (ADR-255 §4, question (б) of
 * `spec/cookies.md` §11): a failed `consent_events` write still answers 200, because the
 * person's choice is what matters, and this counter is how the lost proof becomes visible
 * instead of disappearing into one log line.
 */
export const CONSENT_JOURNAL_FAILED_TOTAL = "consent_journal_failed_total";

/** Register the consent counters; `consent-api.mjs` owns the increment. */
export function describeConsentMetrics(metrics) {
  metrics.describe(
    CONSENT_JOURNAL_FAILED_TOTAL,
    "Consent choices served without a journal row because the write failed",
  );
}

/**
 * A second-factor code that would have passed two or three steps away (`spec/totp.md` §2).
 *
 * The person's app and the connection are fine, so a rising counter is a signal about the
 * installation's own clock — not about the person. The increment lives with the refusal
 * (`iam-http.refuseSecondFactor`), the family is registered here with every other metric.
 */
export const MFA_CLOCK_SKEW_REJECTS_TOTAL = "remo_mfa_clock_skew_rejects_total";
/** The factor's own counters (`spec/operator-actions.md` §6): what changed and what failed. */
export const MFA_ENABLED_TOTAL = "remo_mfa_enabled_total";
export const MFA_DISABLED_TOTAL = "remo_mfa_disabled_total";
export const MFA_RESET_TOTAL = "remo_mfa_reset_total";
export const MFA_LOGINS_TOTAL = "remo_mfa_logins_total";
export const MFA_REJECTS_TOTAL = "remo_mfa_rejects_total";

export function describeMfaMetrics(metrics) {
  metrics.describe(
    MFA_CLOCK_SKEW_REJECTS_TOTAL,
    "Second-factor codes refused because the server clock is off by two or three steps",
  );
  metrics.describe(MFA_ENABLED_TOTAL, "Second factors turned on");
  metrics.describe(MFA_DISABLED_TOTAL, "Second factors turned off by their owner");
  metrics.describe(MFA_RESET_TOTAL, "Second factors reset from the server");
  metrics.describe(MFA_LOGINS_TOTAL, "Sign-ins completed with a second-factor code");
  metrics.describe(MFA_REJECTS_TOTAL, "Second-factor answers refused, by reason");
}

/** Prometheus exposition content type, with the version it speaks. */
export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** Constant-time comparison for the one shared secret the service accepts. */
function safeEqual(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `GET /metrics`: the Prometheus scrape, with the cheap gauges refreshed first.
 *
 * It lives here rather than in the composition root because a scrape has one job —
 * answer the scraper or 404 — and the root stays a wiring file (ADR-093).
 */
export async function serveMetrics({
  request,
  response,
  metrics,
  store,
  startedAt,
  connections = 0,
  roomsFallback = 0,
  mailConfig = null,
}) {
  // Metrics name boards, rooms and rejections; the internet has no business seeing
  // them. A token is required in production; development keeps the convenience.
  const expected = process.env.REMO_METRICS_TOKEN;
  const header = String(request.headers.authorization ?? "");
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const allowed = expected ? safeEqual(provided, expected) : process.env.NODE_ENV !== "production";
  if (!allowed) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "RESOURCE_NOT_AVAILABLE" }));
    return;
  }
  const storage = await store.health();
  metrics.set("remo_ws_connections_active", connections);
  metrics.set("remo_rooms_active", store.roomCount ?? storage.rooms ?? roomsFallback);
  if (typeof storage.boards === "number") metrics.set("remo_boards_total", storage.boards);
  if (mailConfig?.driver !== "disabled" && typeof store.mailQueueDepth === "function") {
    try {
      metrics.set("remo_mail_queue_depth", await store.mailQueueDepth());
    } catch {
      // A failed gauge must not take the whole scrape down with it.
    }
  }
  if (typeof store.totalStoredBytes === "function") {
    try {
      metrics.set("remo_files_stored_bytes", await store.totalStoredBytes());
    } catch {
      // Same rule: a scrape is more useful without one gauge than not at all.
    }
  }
  // A reset happens in a CLI process, so its counter cannot live in this process's map;
  // the audit row is the record and the scrape reads the count from there.
  if (typeof store.countOperatorAuditAction === "function") {
    try {
      metrics.set(MFA_RESET_TOTAL, await store.countOperatorAuditAction("mfa.reset"));
    } catch {
      // A missing number is better than a failed scrape.
    }
  }
  response.writeHead(200, { "Content-Type": METRICS_CONTENT_TYPE });
  response.end(`${metrics.render()}\n${processMetrics(startedAt)}\n`);
}
