/**
 * The Pulse runtime of the composition root (`spec/pulse.md` §4.2, §5.3).
 *
 * One place opens the metrics database, starts the nightly writer and, on the EU
 * installation only, the peer collector. Moving it out of `server.mjs` keeps that file a
 * wiring list and keeps the file-size ratchet (ADR-093) from failing on one more feature.
 *
 * A malformed `REMO_PULSE_PEERS` stops the start, like a malformed compliance zone: a typo
 * must not silently leave the exchange off. An absent metrics database is normal and
 * starts nothing.
 */
import { MetricsStore } from "./metrics-store.mjs";
import { configureMetrics } from "./metrics-events.mjs";
import { createPulseLoop } from "./pulse/aggregate.mjs";
import { createPeerCollector, parsePeerOrigins } from "./pulse/peer-collect.mjs";

function describePulse(metrics) {
  metrics.describe("remo_pulse_recompute_days_total", "Pulse days recomputed, by result");
  metrics.describe(
    "remo_pulse_last_success_timestamp_seconds",
    "When the Pulse last wrote a day; an alert fires when the night does not run",
    "gauge",
  );
  metrics.describe("remo_pulse_export_rows_total", "Aggregate rows handed to a peer");
  metrics.describe("remo_pulse_peer_collect_total", "Peer collections, by result");
  metrics.describe("remo_pulse_peer_rows_total", "Peer rows stored, by origin");
}

export async function createPulseRuntime({
  store,
  metrics,
  version = "dev",
  zone = "none",
  env = process.env,
  log = console,
} = {}) {
  describePulse(metrics);

  const metricsUrl = env.REMO_METRICS_DATABASE_URL;
  let metricsStore = null;
  if (metricsUrl && env.REMO_METRICS !== "off") {
    metricsStore = new MetricsStore({ connectionString: metricsUrl });
    try {
      await metricsStore.connect();
      configureMetrics((event) => metricsStore.record(event), { enabled: true, version });
      log.log("[metrics] product metrics enabled");
    } catch (error) {
      log.error(`[metrics] unavailable (${error.message || error.code}); events are dropped`);
      // A pool that failed its schema check must not become the writer of the night.
      await metricsStore.close().catch(() => {});
      metricsStore = null;
    }
  }

  // Only the EU installation initiates the exchange (the owner's decision, ADR-263). The
  // Russian one answers the export route and never makes an outbound call.
  let peers = [];
  if (zone === "eu") {
    peers = parsePeerOrigins(env.REMO_PULSE_PEERS);
  } else if (String(env.REMO_PULSE_PEERS ?? "").trim()) {
    log.warn(
      "[sync] pulse: REMO_PULSE_PEERS is set on an installation that is not the EU collector; no peer is collected",
    );
  }

  const pool = metricsStore?.pool ?? null;
  return {
    metricsStore,
    pool,
    loop: createPulseLoop({ pool, store, zone, metrics, log }),
    peerCollector: createPeerCollector({
      peers,
      token: String(env.REMO_PULSE_TOKEN ?? ""),
      zone,
      pool,
      metrics,
      log,
    }),
  };
}
