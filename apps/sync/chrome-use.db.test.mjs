/**
 * `chrome.used` is one fact per organisation per control per UTC day (ADR-266 §9,
 * ADR-294), and this suite proves the storage rule against a real database.
 *
 * The event is written through the same sink the service uses (`MetricsStore.record`),
 * not by hand-written SQL: a second click must be dropped by the partial unique index,
 * while another control or another day stays a separate fact.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { metricEvent } from "@remo/metrics";
import { METRICS_TEST_SCHEMA, openMetricsTestPool } from "./metrics-test-db.mjs";
import { MetricsStore } from "./metrics-store.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("chrome used");
const store = opened?.store ?? null;
const orgId = randomUUID();
let pool = null;
let metricsStore = null;

describe.skipIf(!store)("chrome.used (ADR-294)", () => {
  beforeAll(async () => {
    pool = await openMetricsTestPool(opened.url);
    metricsStore = new MetricsStore({
      connectionString: opened.url,
      options: `-c search_path=${METRICS_TEST_SCHEMA},public`,
      log: { log() {}, error() {} },
    });
    await metricsStore.connect();
  });

  afterAll(async () => {
    if (!store) return;
    if (pool) {
      await pool.query("delete from metrics_events where org_id = $1", [orgId]).catch(() => {});
      await pool.end();
    }
    await metricsStore?.close();
    await store.close();
  });

  async function count() {
    const { rows } = await pool.query(
      "select count(*)::int as n from metrics_events where org_id = $1 and name = 'chrome.used'",
      [orgId],
    );
    return rows[0].n;
  }

  async function press(control) {
    await metricsStore.record(
      metricEvent({
        name: "chrome.used",
        orgId,
        props: { control },
      }),
    );
  }

  it("keeps one row for two clicks of the same control on the same day", async () => {
    await press("room.export");
    await press("room.export");
    expect(await count()).toBe(1);
  });

  it("keeps another control and another day apart", async () => {
    await press("search.open");
    expect(await count()).toBe(2);

    // A press from a previous UTC day is its own fact; the index is scoped by day.
    const yesterday = metricEvent({
      name: "chrome.used",
      orgId,
      props: { control: "room.export" },
    });
    yesterday.occurred_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await metricsStore.record(yesterday);
    expect(await count()).toBe(3);
  });
});
