/**
 * «Пульс»: the operator's weekly picture, read from `metrics_daily` (`spec/pulse.md` §4.6,
 * §6; stage 2 of `spec/operator.md` §8).
 *
 * The panel does not query events or billing: one writer fills the aggregates and every
 * tile, line and total comes from the same rows, so a tile and its twelve-week line cannot
 * disagree. A missing row is "—" with a reason, never a zero: a zero is a claim about the
 * world, and an unwritten day is a hole.
 *
 * Two zones are joined here only when the installation collects them (§5.3). The EU
 * installation initiates the exchange and shows "All", "EU" and "RU"; the Russian one
 * answers and shows its own zone with the reason. A stale zone (no collection for 72
 * hours) is shown with its last date and left out of "All".
 */
import {
  PULSE_WEEKS,
  PULSE_BREAKEVEN,
  percent,
  startOfWeek,
  weekWindow,
  weekKey,
} from "./pulse/week.mjs";
import { readDailyRows, peerStates } from "./pulse/store.mjs";
import { addDays, dayOf } from "./pulse/time.mjs";
import { monthlyAmount } from "./pulse/compute.mjs";

export { PULSE_WEEKS, PULSE_BREAKEVEN, percent, startOfWeek, weekWindow, weekKey, monthlyAmount };

const DAY_MS = 24 * 60 * 60 * 1000;
/** A peer older than this is shown as "no data since …" and left out of "All" (§5.3). */
export const PULSE_PEER_FRESH_MS = 72 * 60 * 60 * 1000;

function dimsKey(dims) {
  return JSON.stringify(
    Object.keys(dims ?? {})
      .sort()
      .map((key) => [key, dims[key]]),
  );
}

function indexRows(rows) {
  const index = new Map();
  for (const row of rows) {
    index.set(`${row.zone}|${row.metric}|${row.day}|${dimsKey(row.dims)}`, row);
  }
  return index;
}

function tile({ id, value = null, previous = null, series = null, reason = null, basis = null }) {
  return { id, value, previous, series, reason, basis };
}

/**
 * Sum one cell over the selected zones. A zone without the row is a hole, not a zero: the
 * result is `null` and the caller attaches the reason, so "All" never silently drops a zone.
 */
function sumCell(index, zones, { metric, day, dims = {} }) {
  let total = 0;
  let seen = 0;
  let rebuilt = false;
  for (const zone of zones) {
    const row = index.get(`${zone}|${metric}|${day}|${dimsKey(dims)}`);
    if (!row) continue;
    seen += 1;
    // One unavailable zone makes the total unavailable: "All" may not silently drop it.
    if (row.status !== "ok" || row.value === null) {
      return { value: null, reason: "not computable for every zone", basis: null };
    }
    total += row.value;
    if (row.basis === "rebuilt") rebuilt = true;
  }
  if (seen === 0) return { value: null, reason: "not computed for this day", basis: null };
  if (seen < zones.length) return { value: null, reason: "not computed for every zone", basis: null };
  return { value: total, reason: null, basis: rebuilt ? "rebuilt" : "derived" };
}

/** Sum a metric over every day of a week; every selected zone must have each day. */
function sumDays(index, zones, { metric, from, to, dims = {} }) {
  let total = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const cell = sumCell(index, zones, { metric, day, dims });
    if (cell.value === null) return { value: null, reason: cell.reason, basis: null };
    total += cell.value;
  }
  return { value: total, reason: null, basis: null };
}

function ratio(part, whole) {
  if (whole.value === null || part.value === null || whole.value === 0) return null;
  return percent(part.value, whole.value);
}

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * The zones this installation can draw: its own, plus every peer it collects.
 * `fresh` is the one condition "All" uses; an explicit filter still shows a stale zone
 * with its date.
 */
export function describeZones({ localZone, peers = [], now = new Date() }) {
  const zones = [
    {
      id: localZone,
      kind: "local",
      fresh: true,
      lastSuccessAt: null,
      lastDay: null,
      reason:
        localZone === "none"
          ? "this installation has no compliance zone, so no aggregate can be exchanged"
          : null,
    },
  ];
  for (const peer of peers) {
    if (peer.zone === localZone) continue;
    const at = peer.lastSuccessAt ? new Date(peer.lastSuccessAt) : null;
    const fresh = Boolean(at) && now.getTime() - at.getTime() <= PULSE_PEER_FRESH_MS;
    zones.push({
      id: peer.zone,
      kind: "peer",
      fresh,
      origin: peer.origin,
      lastSuccessAt: peer.lastSuccessAt ?? null,
      lastDay: peer.lastDay ?? null,
      reason: fresh
        ? null
        : at
          ? `no data since ${iso(at).slice(0, 10)}`
          : "never collected",
    });
  }
  return zones;
}

/** The sentence under the filter when this installation cannot show both zones. */
export function zoneReasonFor(zones, ownZone) {
  if (ownZone === "none") {
    return "No compliance zone is configured; the Pulse shows local aggregates only.";
  }
  const peers = zones.filter((zone) => zone.kind === "peer");
  if (peers.length === 0) {
    return ownZone === "ru"
      ? "This installation answers for its own zone only. The EU installation collects both zones."
      : "No peer is configured; the Pulse shows this installation's own zone only.";
  }
  const stale = peers.filter((zone) => !zone.fresh);
  if (stale.length) {
    return `All is shown without ${stale.map((zone) => zone.id.toUpperCase()).join(", ")}: ${stale
      .map((zone) => zone.reason)
      .join("; ")}`;
  }
  return null;
}

/**
 * Read the picture. `metricsPool` is the metrics database's pool; `null` leaves every
 * aggregate empty with a reason and never falls back to events or billing (§4.6).
 */
export async function readOperatorPulse({
  store = null,
  metricsPool = null,
  weeks = 12,
  currency = null,
  preferredCurrency = null,
  breakeven = PULSE_BREAKEVEN,
  zone = "none",
  zoneFilter = "all",
  now = new Date(),
  health = {},
  log = console,
} = {}) {
  const safeWeeks = PULSE_WEEKS.includes(Number(weeks)) ? Number(weeks) : 12;
  const buckets = weekWindow(safeWeeks, now);
  const since = buckets[0].start;
  const yesterday = addDays(dayOf(now), -1);

  if (!metricsPool) {
    return emptyPulse({
      now,
      weeks: safeWeeks,
      since,
      buckets,
      zone,
      zoneFilter,
      breakeven,
      health,
      reason: "the metrics database is not configured",
    });
  }

  let peers = [];
  try {
    peers = await peerStates(metricsPool);
  } catch (error) {
    log.error?.(`[pulse] peer state read failed: ${error.message ?? error}`);
    return emptyPulse({
      now,
      weeks: safeWeeks,
      since,
      buckets,
      zone,
      zoneFilter,
      breakeven,
      health,
      reason: "the metrics database did not answer",
    });
  }
  const zones = describeZones({ localZone: zone, peers, now });
  const wanted =
    zoneFilter === "all"
      ? zones.filter((entry) => entry.fresh)
      : zones.filter((entry) => entry.id === zoneFilter);
  const selected = [...new Set(wanted.map((entry) => entry.id))];

  let rows = [];
  if (selected.length) {
    try {
      rows = await readDailyRows(metricsPool, {
        zones: selected,
        from: dayKey(since),
        to: yesterday,
      });
    } catch (error) {
      log.error?.(`[pulse] aggregate read failed: ${error.message ?? error}`);
      return emptyPulse({
        now,
        weeks: safeWeeks,
        since,
        buckets,
        zone,
        zoneFilter,
        breakeven,
        health,
        zones,
        reason: "the metrics database did not answer",
      });
    }
  }
  const index = indexRows(rows);
  const computedAt = rows.reduce(
    (latest, row) => (!latest || new Date(row.computedAt) > new Date(latest) ? row.computedAt : latest),
    null,
  );

  const complete = buckets.length > 1 ? buckets.length - 2 : 0;
  const previous = complete > 0 ? complete - 1 : null;
  const lastComplete = buckets[complete];
  // A tile shows a complete week, but the money tile is "the end of the last full day";
  // those are different days, and the answer names each for what it is.
  const lastWeekEnd = lastComplete ? dayKey(new Date(lastComplete.end - DAY_MS)) : null;
  const lastCompleteDay = yesterday;

  /** A weekly cell on the bucket's Sunday. */
  const weekCell = (metric, bucket, extra = {}) => {
    if (!bucket) return { value: null, reason: "no complete week" };
    return sumCell(index, selected, {
      metric,
      day: dayKey(bucket.end - DAY_MS),
      dims: { period: "week", ...extra },
    });
  };

  const weeklySeries = (metric, extraFor = () => ({})) => {
    const out = [];
    for (let position = 0; position <= complete; position += 1) {
      const cell = weekCell(metric, buckets[position], extraFor(buckets[position]));
      if (cell.value === null) return { series: null, reason: cell.reason };
      out.push(cell.value);
    }
    return { series: out, reason: null };
  };

  const wact = weekCell("collab.teams", lastComplete);
  const wactPrevious = previous !== null ? weekCell("collab.teams", buckets[previous]) : null;
  const wactSeries = weeklySeries("collab.teams");

  const cohortCell = (bucket) =>
    bucket
      ? sumCell(index, selected, {
          metric: "activation.cohort",
          day: dayKey(bucket.end - DAY_MS),
          dims: { period: "week" },
        })
      : { value: null };
  const reachedCell = (bucket) =>
    bucket
      ? sumCell(index, selected, {
          metric: "activation.reached",
          day: dayKey(bucket.end - DAY_MS),
          dims: { period: "week" },
        })
      : { value: null };
  const activation = ratio(reachedCell(lastComplete), cohortCell(lastComplete));
  const activationSeries = (() => {
    const out = [];
    for (let position = 0; position <= complete; position += 1) {
      const value = ratio(reachedCell(buckets[position]), cohortCell(buckets[position]));
      if (value === null) return null;
      out.push(value);
    }
    return out;
  })();

  const retention = (() => {
    if (!lastComplete) return null;
    const day = dayKey(lastComplete.end - DAY_MS);
    // The cohort dimension is the Monday of the creation week; the W4 observation week
    // ends four weeks after that Monday.
    const cohort = addDays(day, -7 * 4 - 6);
    const whole = sumCell(index, selected, {
      metric: "retention.cohort",
      day,
      dims: { period: "week", cohort, offset: 4 },
    });
    const active = sumCell(index, selected, {
      metric: "retention.active",
      day,
      dims: { period: "week", cohort, offset: 4 },
    });
    return ratio(active, whole);
  })();

  const orgSeries = (() => {
    const out = [];
    for (let position = 0; position <= complete; position += 1) {
      const bucket = buckets[position];
      const cell = sumDays(index, selected, {
        metric: "orgs.created",
        from: dayKey(bucket.start),
        to: dayKey(new Date(bucket.end - DAY_MS)),
      });
      if (cell.value === null) return { series: null, reason: cell.reason };
      out.push(cell.value);
    }
    return { series: out, reason: null };
  })();
  const newOrgs = orgSeries.series ? orgSeries.series[complete] : null;

  const money = readMoney({ index, selected, buckets, complete, currency, preferredCurrency, lastCompleteDay, yesterday });

  const tiles = [
    tile({
      id: "wact",
      value: wact.value,
      previous: wactPrevious?.value ?? null,
      series: null,
      reason: wact.reason ?? wactSeries.reason,
      basis: wact.basis,
    }),
    tile({
      id: "mrr",
      value: money.mrr,
      previous: money.previousMrr,
      series: money.series,
      reason: money.reason,
      basis: money.basis,
    }),
    tile({
      id: "paying",
      value: money.paying,
      previous: money.previousPaying,
      series: money.payingSeries,
      reason: money.reason,
      basis: money.basis,
    }),
    tile({
      id: "activation7d",
      value: activation,
      previous: null,
      series: activationSeries,
      reason:
        lastComplete && activation === null
          ? "no organisation was created in that week"
          : null,
    }),
    tile({
      id: "retentionW4",
      value: retention,
      previous: null,
      series: null,
      reason: retention === null ? "no cohort reached week four" : null,
    }),
    tile({
      id: "newOrgs",
      value: newOrgs,
      previous: orgSeries.series && previous !== null ? orgSeries.series[previous] : null,
      series: orgSeries.series,
      reason: orgSeries.reason,
    }),
  ];

  // A tile's series is a full window or nothing: a line with holes would invent a shape.
  tiles[0].series = wactSeries.series;

  const engagement = readEngagement({ index, selected, yesterday, lastComplete, complete });

  const windowFrom = buckets[0] ? dayKey(buckets[0].start) : null;
  const windowTo = lastWeekEnd;
  const sources = readSources(index, selected, windowFrom, windowTo);

  return {
    generatedAt: iso(now),
    weeks: safeWeeks,
    from: iso(since),
    to: iso(new Date(buckets[buckets.length - 1].end)),
    zone,
    zoneFilter,
    zones,
    zoneReason: zoneReasonFor(zones, zone),
    lastCompleteDay,
    lastCompleteWeek: lastWeekEnd,
    computedAt: iso(computedAt),
    currencies: money.currencies,
    currency: money.currency,
    breakeven,
    tiles,
    growth: {
      registrations: readRegistrationCount(index, selected, windowFrom, windowTo),
      activations: weeklyTotal(index, selected, "activation.reached", buckets, complete),
      invitations: readDayTotal(index, selected, "invites.sent", windowFrom, windowTo),
      collaborating: wact.value,
      paying: money.paying,
      source: null,
      sources: sources.rows,
      sourceReason: sources.reason,
    },
    engagement,
    money: {
      mrrByCurrency: money.mrrByCurrency,
      byPlan: money.byPlan,
      mrrDay: money.day,
      freeToPaid: null,
      reason: money.reason,
    },
    health: {
      mailDead: health.mailDead ?? null,
      storeWriteErrors: health.storeWriteErrors ?? null,
      storeWrites: health.storeWrites ?? null,
      aiUnavailable: health.aiUnavailable ?? null,
      wsRejected: health.wsRejected ?? null,
      reason: null,
    },
  };
}

function dayKey(value) {
  if (typeof value === "string") return value;
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------- money -- */

function readMoney({ index, selected, buckets, complete, currency, preferredCurrency, lastCompleteDay, yesterday }) {
  const empty = {
    mrr: null,
    previousMrr: null,
    series: null,
    paying: null,
    previousPaying: null,
    payingSeries: null,
    day: null,
    currencies: [],
    currency: null,
    mrrByCurrency: [],
    byPlan: [],
    reason: "no money snapshot has been written yet",
    basis: null,
  };
  if (!selected.length) return { ...empty, reason: "no zone is selected" };

  const daysByZone = selected.map((zone) => {
    let day = null;
    for (const row of index.values()) {
      if (row.zone === zone && row.metric === "money.mrr" && row.day <= yesterday) {
        if (!day || row.day > day) day = row.day;
      }
    }
    return day;
  });
  if (daysByZone.some((day) => !day)) return empty;
  const day = daysByZone.reduce((oldest, value) => (value < oldest ? value : oldest));

  const mrrRows = [];
  let rebuilt = false;
  const paying = sumCell(index, selected, { metric: "money.paying", day });
  for (const zone of selected) {
    for (const row of index.values()) {
      if (row.zone !== zone || row.metric !== "money.mrr" || row.day !== day) continue;
      mrrRows.push(row);
      if (row.basis === "rebuilt") rebuilt = true;
    }
  }
  if (paying.value === null && mrrRows.length === 0) return empty;

  const byCurrency = new Map();
  const byPlan = new Map();
  for (const row of mrrRows) {
    const code = row.dims.currency;
    if (!code) continue;
    if (row.status !== "ok" || row.value === null) continue;
    byCurrency.set(code, (byCurrency.get(code) ?? 0) + row.value);
    const planKey = `${code}\u0000${row.dims.plan ?? "other"}`;
    byPlan.set(planKey, (byPlan.get(planKey) ?? 0) + row.value);
  }
  const currencies = [...byCurrency.keys()].sort();
  const chosen =
    currency && currencies.includes(currency)
      ? currency
      : preferredCurrency && currencies.includes(preferredCurrency)
        ? preferredCurrency
        : currencies[0] ?? preferredCurrency ?? null;
  const mrr = chosen && byCurrency.has(chosen) ? byCurrency.get(chosen) : mrrRows.length ? 0 : null;
  const planRows = [...byPlan.entries()]
    .filter(([key]) => !chosen || key.startsWith(`${chosen}\u0000`))
    .map(([key, amount]) => ({ plan: key.split("\u0000")[1], amount }))
    .sort((a, b) => (a.plan < b.plan ? -1 : 1));

  const mrrSeries = [];
  const payingSeries = [];
  let seriesBroken = false;
  for (let position = 0; position <= complete; position += 1) {
    const sunday = dayKey(buckets[position].end - DAY_MS);
    const cell = sumCell(index, selected, { metric: "money.paying", day: sunday });
    const amount = chosen ? sumMrrOn(index, selected, sunday, chosen) : null;
    if (cell.value === null || amount === null) {
      seriesBroken = true;
      break;
    }
    payingSeries.push(cell.value);
    mrrSeries.push(amount);
  }

  return {
    mrr,
    previousMrr: complete > 0 ? sumMrrOn(index, selected, dayKey(buckets[complete - 1].end - DAY_MS), chosen) : null,
    series: seriesBroken ? null : mrrSeries,
    paying: paying.value,
    previousPaying:
      complete > 0
        ? sumCell(index, selected, {
            metric: "money.paying",
            day: dayKey(buckets[complete - 1].end - DAY_MS),
          }).value
        : null,
    payingSeries: seriesBroken ? null : payingSeries,
    day,
    currencies: currencies.length ? currencies : chosen ? [chosen] : [],
    currency: chosen,
    mrrByCurrency: currencies.map((code) => ({ currency: code, amount: byCurrency.get(code) })),
    byPlan: planRows,
    reason:
      day !== lastCompleteDay
        ? `the money snapshot is from ${day}; the last complete day is ${lastCompleteDay}`
        : null,
    basis: rebuilt ? "rebuilt" : "snapshot",
  };
}

function sumMrrOn(index, zones, day, currency) {
  let total = 0;
  let seen = false;
  for (const zone of zones) {
    for (const row of index.values()) {
      if (row.zone !== zone || row.metric !== "money.mrr" || row.day !== day) continue;
      if (row.dims.currency !== currency) continue;
      seen = true;
      if (row.status === "ok" && row.value !== null) total += row.value;
    }
  }
  return seen ? total : null;
}

/* -------------------------------------------------------------- engagement -- */

function readEngagement({ index, selected, yesterday, lastComplete, complete }) {
  const dau = selected.length
    ? sumCell(index, selected, { metric: "active.actors", day: yesterday })
    : { value: null, reason: "no zone is selected" };
  const wau = lastComplete
    ? sumCell(index, selected, {
        metric: "active.actors",
        day: dayKey(lastComplete.end - DAY_MS),
        dims: { period: "week" },
      })
    : { value: null, reason: "no complete week" };
  const mauDay = latestMonthEnd(index, selected, yesterday);
  const mau = mauDay
    ? sumCell(index, selected, {
        metric: "active.actors",
        day: mauDay,
        dims: { period: "month" },
      })
    : { value: null, reason: "no complete month" };
  const sessions = lastComplete
    ? sumDays(index, selected, {
        metric: "collab.sessions",
        from: dayKey(lastComplete.start),
        to: dayKey(lastComplete.end - DAY_MS),
      })
    : { value: null, reason: "no complete week" };
  return {
    dau: dau.value,
    wau: wau.value,
    mau: mau.value,
    stickiness:
      dau.value !== null && mau.value && mau.value > 0
        ? Math.round((dau.value / mau.value) * 1000) / 10
        : null,
    collaboration: sessions.value,
    reason:
      dau.value === null
        ? `daily activity: ${dau.reason}`
        : sessions.value === null
          ? `collaborative sessions: ${sessions.reason ?? "the session event is not emitted by this version"}`
          : null,
  };
}

function latestMonthEnd(index, zones, yesterday) {
  let latest = null;
  for (const row of index.values()) {
    if (!zones.includes(row.zone) || row.metric !== "active.actors") continue;
    if (row.dims.period !== "month" || row.day > yesterday) continue;
    if (!latest || row.day > latest) latest = row.day;
  }
  return latest;
}

/* ------------------------------------------------------------------ growth -- */

function weeklyTotal(index, zones, metric, buckets, complete) {
  let total = 0;
  let seen = false;
  for (let position = 0; position <= complete; position += 1) {
    const cell = sumCell(index, zones, {
      metric,
      day: dayKey(buckets[position].end - DAY_MS),
      dims: { period: "week" },
    });
    if (cell.value === null) return null;
    total += cell.value;
    seen = true;
  }
  return seen ? total : null;
}

function readDayTotal(index, zones, metric, from, to) {
  if (!from || !to) return null;
  const cell = sumDays(index, zones, { metric, from, to });
  return cell.value;
}

function readRegistrationCount(index, zones, from, to) {
  return readDayTotal(index, zones, "orgs.created", from, to);
}

function readSources(index, zones, from, to) {
  if (!from || !to || !zones.length) return { rows: [], reason: "the source split is not collected yet" };
  const counts = new Map();
  for (const zone of zones) {
    for (const row of index.values()) {
      if (row.zone !== zone || row.metric !== "orgs.created") continue;
      if (row.day < from || row.day > to) continue;
      const source = row.dims.source;
      if (!source) continue;
      if (row.status !== "ok" || row.value === null) continue;
      counts.set(source, (counts.get(source) ?? 0) + row.value);
    }
  }
  const rows = [...counts.entries()]
    .map(([source, value]) => ({ source, value }))
    .sort((a, b) => b.value - a.value || (a.source < b.source ? -1 : 1));
  return {
    rows,
    reason: rows.length ? null : "no organisation carried a source in this window",
  };
}

/* ------------------------------------------------------------------- empty -- */

function emptyPulse({
  now,
  weeks,
  since,
  buckets,
  zone,
  zoneFilter,
  breakeven,
  health,
  zones = null,
  reason,
}) {
  const tileIds = ["wact", "mrr", "paying", "activation7d", "retentionW4", "newOrgs"];
  const zoneList =
    zones ??
    [
      {
        id: zone,
        kind: "local",
        fresh: true,
        lastSuccessAt: null,
        lastDay: null,
        reason: zone === "none" ? "no compliance zone is configured" : null,
      },
    ];
  return {
    generatedAt: iso(now),
    weeks,
    from: iso(since),
    to: iso(new Date(buckets[buckets.length - 1].end)),
    zone,
    zoneFilter,
    zones: zoneList,
    zoneReason: zoneReasonFor(zoneList, zone),
    lastCompleteDay: null,
    lastCompleteWeek: null,
    computedAt: null,
    currencies: [],
    currency: null,
    breakeven,
    tiles: tileIds.map((id) => tile({ id, reason })),
    growth: {
      registrations: null,
      activations: null,
      invitations: null,
      collaborating: null,
      paying: null,
      source: null,
      sources: [],
      sourceReason: reason,
    },
    engagement: { dau: null, wau: null, mau: null, stickiness: null, collaboration: null, reason },
    money: { mrrByCurrency: [], byPlan: [], mrrDay: null, freeToPaid: null, reason },
    health: {
      mailDead: health.mailDead ?? null,
      storeWriteErrors: health.storeWriteErrors ?? null,
      storeWrites: health.storeWrites ?? null,
      aiUnavailable: health.aiUnavailable ?? null,
      wsRejected: health.wsRejected ?? null,
      reason,
    },
  };
}
