/**
 * The panel reads `metrics_daily`, never events or billing (`spec/pulse.md` §4.6, §6).
 *
 * A fake pool feeds a fixture that is counted by hand. The case pins the tile values, the
 * retention cohort dimension (the Monday of the creation week), the money snapshot day and
 * the freshness rule that leaves a stale zone out of "All".
 */
import { describe, expect, it } from "vitest";
import { readOperatorPulse } from "./operator-pulse.mjs";

const NOW = new Date("2026-11-23T12:00:00.000Z");
const YESTERDAY = "2026-11-22";

function cell(metric, day, dims, value, { basis = "derived", zone = "eu", status = "ok" } = {}) {
  return {
    day,
    zone,
    metric,
    dims,
    value,
    status,
    basis,
    provenance: zone === "eu" ? "local" : "peer",
    computed_at: new Date("2026-11-23T03:10:00.000Z"),
  };
}

const ROWS = [
  cell("collab.teams", "2026-11-22", { period: "week" }, 5),
  cell("collab.teams", "2026-11-15", { period: "week" }, 3),
  cell("collab.teams", "2026-11-08", { period: "week" }, 2),
  cell("activation.cohort", "2026-11-22", { period: "week" }, 10),
  cell("activation.reached", "2026-11-22", { period: "week" }, 4),
  cell("activation.cohort", "2026-11-15", { period: "week" }, 7),
  cell("activation.reached", "2026-11-15", { period: "week" }, 0),
  cell("activation.cohort", "2026-11-08", { period: "week" }, 6),
  cell("activation.reached", "2026-11-08", { period: "week" }, 0),
  cell("retention.cohort", "2026-11-22", { period: "week", cohort: "2026-10-19", offset: 4 }, 8),
  cell("retention.active", "2026-11-22", { period: "week", cohort: "2026-10-19", offset: 4 }, 2),
  cell("money.mrr", "2026-11-22", { currency: "RUB", plan: "team" }, 1000, { basis: "snapshot" }),
  cell("money.mrr", "2026-11-15", { currency: "RUB", plan: "team" }, 900, { basis: "snapshot" }),
  cell("money.paying", "2026-11-22", {}, 2, { basis: "snapshot" }),
  cell("money.paying", "2026-11-15", {}, 2, { basis: "snapshot" }),
  cell("active.actors", YESTERDAY, {}, 3),
  cell("active.actors", "2026-11-22", { period: "week" }, 6),
  cell("active.actors", "2026-10-31", { period: "month" }, 9),
  cell("collab.sessions", YESTERDAY, {}, 1),
  cell("invites.sent", YESTERDAY, {}, 2),
];

// A day with no collaborative session writes a real zero, not a hole.
for (const day of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]) {
  ROWS.push(cell("collab.sessions", day, {}, 0));
}

// Every day of the three complete weeks carries one new organisation, so a weekly sum is 7.
for (const day of [
  "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08",
  "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
  "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22",
]) {
  ROWS.push(cell("orgs.created", day, {}, 1));
}

function fakePool({ peers = [] } = {}) {
  return {
    async query(sql) {
      if (sql.includes("from pulse_peers")) return { rows: peers };
      if (sql.includes("from metrics_daily")) return { rows: ROWS };
      throw new Error(`unexpected query: ${sql.slice(0, 40)}`);
    },
  };
}

describe("readOperatorPulse", () => {
  it("draws the six tiles from the aggregates", async () => {
    const pulse = await readOperatorPulse({
      metricsPool: fakePool({
        peers: [{ origin: "https://app.remuka.ru", zone: "ru", last_success_at: NOW, last_day: YESTERDAY, last_rows: 1 }],
      }),
      zone: "eu",
      zoneFilter: "eu",
      weeks: 4,
      now: NOW,
      log: { error() {} },
    });
    const tile = (id) => pulse.tiles.find((entry) => entry.id === id);
    expect(tile("wact")).toMatchObject({ value: 5, previous: 3 });
    expect(tile("mrr")).toMatchObject({ value: 1000, previous: 900, basis: "snapshot" });
    expect(tile("paying")).toMatchObject({ value: 2, basis: "snapshot" });
    expect(tile("activation7d").value).toBe(40);
    expect(tile("retentionW4").value).toBe(25);
    expect(tile("newOrgs")).toMatchObject({ value: 7, previous: 7 });
    expect(pulse.money.mrrDay).toBe(YESTERDAY);
    expect(pulse.lastCompleteDay).toBe(YESTERDAY);
    expect(pulse.lastCompleteWeek).toBe(YESTERDAY);
    expect(pulse.zones.map((entry) => entry.id)).toEqual(["eu", "ru"]);
    expect(pulse.zoneReason).toBeNull();
  });

  it("reads engagement from the matching rows", async () => {
    const pulse = await readOperatorPulse({
      metricsPool: fakePool({ peers: [] }),
      zone: "eu",
      weeks: 4,
      now: NOW,
      log: { error() {} },
    });
    expect(pulse.engagement).toMatchObject({
      dau: 3,
      wau: 6,
      mau: 9,
      stickiness: 33.3,
      collaboration: 1,
    });
    expect(pulse.growth.registrations).toBe(21);
    expect(pulse.growth.activations).toBe(4);
  });

  it("leaves a stale peer out of All and says which one is missing", async () => {
    const stale = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000);
    const pulse = await readOperatorPulse({
      metricsPool: fakePool({
        peers: [{ origin: "https://app.remuka.ru", zone: "ru", last_success_at: stale, last_day: "2026-11-18", last_rows: 1 }],
      }),
      zone: "eu",
      weeks: 4,
      now: NOW,
      log: { error() {} },
    });
    expect(pulse.zones.find((entry) => entry.id === "ru")).toMatchObject({ fresh: false });
    expect(pulse.zoneReason).toMatch(/All is shown without RU/);
  });

  it("shows one zone with a reason on an installation that only answers", async () => {
    const pulse = await readOperatorPulse({
      metricsPool: fakePool({ peers: [] }),
      zone: "ru",
      weeks: 4,
      now: NOW,
      log: { error() {} },
    });
    expect(pulse.zones.map((entry) => entry.id)).toEqual(["ru"]);
    expect(pulse.zoneReason).toMatch(/own zone only/);
  });
});
