/**
 * The aggregator and the peer revoke against a real database (`spec/pulse.md` §4, §5).
 *
 * The suite writes into the run's throwaway database and applies `METRICS_SCHEMA` there;
 * production keeps the metrics tables in a separate database (ADR-082), and this test does
 * not pretend otherwise — it only needs the same DDL. The numbers are counted in the
 * fixture comments, so a changed formula shows up as a changed expectation.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openMetricsTestPool } from "./metrics-test-db.mjs";
import { recompute } from "./pulse/aggregate.mjs";
import { collectPeer } from "./pulse/peer-collect.mjs";
import { signPulseBody } from "./pulse-export.mjs";
import { readOperatorPulse } from "./operator-pulse.mjs";
import { runPulsePeerRevoke } from "./pulse/cli.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("pulse");
const store = opened?.store ?? null;

const NOW = new Date("2026-11-23T12:00:00.000Z");
const orgId = randomUUID();
const orgOldId = randomUUID();
const userA = randomUUID();
const userB = randomUUID();
const eventIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const PEER = "https://app.remuka.ru";
const PULSE_TOKEN = "test-pulse-token";

let pool = null;

async function withMetrics(work) {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

async function rowsFor(day) {
  const { rows } = await pool.query(
    "select metric, dims, value, status, basis, provenance from metrics_daily where day = $1 and zone = 'eu'",
    [day],
  );
  return rows.map((row) => ({ ...row, value: row.value === null ? null : Number(row.value) }));
}

describe.skipIf(!store)("pulse aggregates (ADR-258)", () => {
  beforeAll(async () => {
    pool = await openMetricsTestPool(opened.url);

    await store.pool.query(
      `insert into users (id, email, password_hash, name, handle, email_verified_at)
       values ($1, $2, 'x', 'Pulse A', $3, now()), ($4, $5, 'x', 'Pulse B', $6, now())`,
      [userA, `pulse-a-${orgId}@example.test`, `pa-${orgId.slice(0, 8)}`, userB, `pulse-b-${orgId}@example.test`, `pb-${orgId.slice(0, 8)}`],
    );
    await store.pool.query(
      `insert into orgs (id, name, slug, created_at) values
         ($1, 'Pulse org', $2, '2026-11-17T10:00:00Z'),
         ($3, 'Pulse old', $4, '2026-08-24T10:00:00Z')`,
      [orgId, `pulse-${orgId}`, orgOldId, `pulse-old-${orgId}`],
    );
    // The revoke names its author; an operator is an existing account with the role.
    await store.pool.query("insert into instance_operators (user_id) values ($1)", [userA]);
    // A unique test currency keeps the money assertions out of other suites' totals.
    await store.pool.query(
      `insert into subscriptions
         (org_id, plan, price_id, amount, currency, interval, status, current_period_start, current_period_end)
       values ($1, 'team', 'team-xts-month-v1', 120000, 'XTS', 'year', 'active', now(), now() + interval '1 year')`,
      [orgId],
    );

    const events = [
      ["board.saved", "2026-11-17T11:00:00Z", userA, "user", { objectCount: 3 }],
      ["object.created", "2026-11-18T11:00:00Z", userB, "user", {}],
      ["activation.first_value", "2026-11-18T12:00:00Z", userA, "user", { kind: "solo" }],
      ["collab.session", "2026-11-19T12:00:00Z", userA, "user", { participants: 2, durationMin: 20 }],
      ["chrome.used", "2026-11-21T10:00:00Z", userA, "user", { control: "room.export" }],
    ];
    for (let index = 0; index < events.length; index += 1) {
      const [name, occurredAt, actorId, actorType, props] = events[index];
      await pool.query(
        `insert into metrics_events
           (event_id, name, occurred_at, org_id, actor_id, actor_type, app_version, schema_version, props)
         values ($1, $2, $3, $4, $5, $6, 'test', 1, $7)`,
        [eventIds[index], name, occurredAt, orgId, actorId, actorType, props],
      );
    }
  });

  afterAll(async () => {
    if (!store) return;
    if (pool) {
      await pool.query("delete from metrics_daily where zone in ('eu', 'ru')");
      await pool.query("delete from metrics_events where event_id = any($1::uuid[])", [eventIds]);
      await pool.query("delete from pulse_peers where origin = $1", [PEER]);
      await pool.end();
    }
    await store.pool.query("delete from subscriptions where org_id = $1", [orgId]);
    await store.pool.query("delete from instance_operators where user_id = $1", [userA]);
    await store.pool.query("delete from orgs where id = any($1::uuid[])", [[orgId, orgOldId]]);
    await store.pool.query("delete from users where id = any($1::uuid[])", [[userA, userB]]);
    await store.close();
  });

  it("writes yesterday's aggregates and never today's", async () => {
    const result = await recompute({
      pool,
      store,
      zone: "eu",
      from: "2026-11-16",
      to: "2026-11-22",
      now: NOW,
      log: { log() {}, error() {} },
    });
    expect(result.ok).toBe(true);

    const sunday = await rowsFor("2026-11-22");
    expect(sunday).toContainEqual(
      expect.objectContaining({ metric: "collab.teams", value: 1, status: "ok" }),
    );
    expect(sunday).toContainEqual(
      expect.objectContaining({ metric: "active.actors", value: 2, basis: "derived" }),
    );
    const retention = sunday.find(
      (row) => row.metric === "retention.cohort" && row.dims.offset === 0,
    );
    expect(retention.value).toBeGreaterThanOrEqual(1);

    const today = await rowsFor("2026-11-23");
    expect(today).toHaveLength(0);
  });

  it("stores money as a snapshot at the end of the last full day", async () => {
    const money = (await rowsFor("2026-11-22")).filter((row) => row.metric === "money.mrr");
    const xts = money.find((row) => row.dims.currency === "XTS");
    // 120000 a year is 10000 a month.
    expect(xts).toMatchObject({ value: 10000, basis: "snapshot" });
  });

  it("shows the chrome share and its thresholds in the Pulse", async () => {
    const pulse = await readOperatorPulse({
      store,
      metricsPool: pool,
      zone: "eu",
      weeks: 4,
      now: NOW,
      log: { error() {} },
    });
    expect(pulse.chrome.day).toBe("2026-11-22");
    // One organisation did a value event in the 28-day window; Export was used by it.
    expect(pulse.chrome.activeOrgs).toBe(1);
    const exported = pulse.chrome.items.find((item) => item.control === "room.export");
    expect(exported).toMatchObject({ orgs: 1, share: 100, verdict: "place" });
    // A control nobody pressed is a real zero and a candidate to go deeper.
    const unused = pulse.chrome.items.find((item) => item.control === "canvas.addCard");
    expect(unused).toMatchObject({ orgs: 0, share: 0, verdict: "deep" });
  });

  it("is idempotent: a second run leaves the same rows and sum", async () => {
    // Money is snapshotted from live billing: another suite's subscription may add a new
    // currency/plan cell between two runs, which is a new fact, not a duplicate. The
    // derived rows are the ones a repeated run must not change.
    const snapshot = async () => {
      const { rows } = await pool.query(
        `select count(*)::int as n, coalesce(sum(value), 0)::bigint as total
           from metrics_daily
          where zone = 'eu' and metric not like 'money.%'`,
      );
      return { n: rows[0].n, total: Number(rows[0].total) };
    };
    const before = await snapshot();
    const result = await recompute({
      pool,
      store,
      zone: "eu",
      from: "2026-11-16",
      to: "2026-11-22",
      now: NOW,
      log: { log() {}, error() {} },
    });
    expect(result.ok).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it("marks a money day first counted late as rebuilt", async () => {
    await pool.query(
      "delete from metrics_daily where day = '2026-11-17' and zone = 'eu' and metric like 'money.%'",
    );
    await recompute({
      pool,
      store,
      zone: "eu",
      from: "2026-11-17",
      to: "2026-11-17",
      now: NOW,
      log: { log() {}, error() {} },
    });
    const money = (await rowsFor("2026-11-17")).filter((row) => row.metric === "money.mrr");
    expect(money.some((row) => row.basis === "rebuilt")).toBe(true);
  });

  it("collects a peer zone and revokes it with an audit row", async () => {
    // The exporting installation answers with a signed body; the collector verifies the
    // signature before parsing and writes the rows with `provenance = 'peer'` (§5.3).
    const body = JSON.stringify({
      version: 1,
      zone: "ru",
      generatedAt: NOW.toISOString(),
      from: "2026-11-22",
      to: "2026-11-22",
      rows: [
        {
          day: "2026-11-22",
          metric: "orgs.created",
          dims: { source: "habr" },
          value: 3,
          status: "ok",
          basis: "derived",
        },
      ],
    });
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => body,
        headers: { "x-pulse-signature": signPulseBody(PULSE_TOKEN, body) },
      };
    };
    const collected = await collectPeer({
      origin: PEER,
      token: PULSE_TOKEN,
      zone: "eu",
      pool,
      fetchImpl,
      log: { log() {}, error() {} },
      now: () => NOW,
      sleep: async () => {},
    });
    expect(collected.rows).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toContain("/api/operator/pulse/export?from=");
    const peer = await pool.query(
      "select count(*)::int as n, min(provenance) as provenance from metrics_daily where zone = 'ru' and provenance = 'peer'",
    );
    expect(peer.rows[0].n).toBe(1);
    expect(peer.rows[0].provenance).toBe("peer");
    const peerState = await pool.query("select zone from pulse_peers where origin = $1", [PEER]);
    expect(peerState.rows[0].zone).toBe("ru");

    // The answer names both zones; "All" includes the fresh peer (§5.3, §9).
    const pulse = await readOperatorPulse({
      store,
      metricsPool: pool,
      zone: "eu",
      weeks: 4,
      now: NOW,
      log: { error() {} },
    });
    expect(pulse.zones.map((entry) => entry.id)).toEqual(expect.arrayContaining(["eu", "ru"]));
    expect(pulse.zoneReason).toBeNull();

    const out = [];
    const err = [];
    const code = await runPulsePeerRevoke({
      argv: ["--origin", PEER, "--reason", "zones are split", "--as", userA],
      env: {},
      store,
      pool,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    expect(code).toBe(0);
    expect(err).toEqual([]);
    const after = await pool.query(
      "select count(*)::int as n from metrics_daily where zone = 'ru' and provenance = 'peer'",
    );
    expect(after.rows[0].n).toBe(0);
    const state = await pool.query("select count(*)::int as n from pulse_peers where origin = $1", [PEER]);
    expect(state.rows[0].n).toBe(0);
    const audit = await store.pool.query(
      "select action, reason, after from audit_events where action = 'pulse.peer_revoked' and subject = $1",
      [PEER],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "pulse.peer_revoked",
      reason: "zones are split",
    });
    expect(audit.rows[0].after).toMatchObject({ zone: "ru", rows: 1 });

    // The panel stops showing the zone immediately: no cache, no leftovers on the chart.
    const afterRevoke = await readOperatorPulse({
      store,
      metricsPool: pool,
      zone: "eu",
      weeks: 4,
      now: NOW,
      log: { error() {} },
    });
    expect(afterRevoke.zones.map((entry) => entry.id)).not.toContain("ru");
    expect(afterRevoke.zoneReason).toMatch(/own zone only/);
  });
});
