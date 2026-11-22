/**
 * The nightly writer of `metrics_daily` (`spec/pulse.md` §4.2, §4.4, §4.5).
 *
 * One writer and one unit of work: a UTC day. A day is recomputed in its own transaction
 * under an advisory lock, so a retry, a manual command and the nightly timer cannot write
 * the same day twice, and a failure rolls back only that day. The primary key makes a
 * repeated run idempotent; the deletion of stale rows is bounded by the shape of a row, so
 * the retention rows of other cohorts on the same Sunday survive.
 *
 * Money is not derived: `computeMoney` returns the billing state seen now and the writer
 * inserts it once (`do nothing`). A day first counted late carries `basis = 'rebuilt'`.
 * Events are stored for 400 days (`METRICS_EVENTS_RETENTION_DAYS`); the aggregates live
 * for 730.
 */
import {
  PULSE_WINDOW_DAYS,
  RETENTION_WEEKS,
  addDays,
  dayOf,
  eachDay,
  isMonthEnd,
  isWeekEnd,
  maxDay,
  minDay,
  startOfMonth,
  startOfWeek,
} from "./time.mjs";
import { METRICS_EVENTS_RETENTION_DAYS } from "../metrics-store.mjs";
import {
  computeActivation,
  computeActiveActors,
  computeCollaborativeSessions,
  computeCollaborativeTeams,
  computeFeatureUsage,
  computeInvitesAccepted,
  computeInvitesSent,
  computeMoney,
  computeOrgsCreated,
  computeRetention,
  computeTemplateUsage,
} from "./compute.mjs";
import { metricAvailable } from "./catalog.mjs";
import {
  deleteStale,
  firstEventDay,
  insertSnapshots,
  latestLocalDay,
  openMetricsPool,
  prune,
  upsertDerived,
} from "./store.mjs";

/** A day cannot be rewritten before this window; `pulse:recompute` refuses it too (§4.5). */
export function oldestRecomputableDay(now = new Date()) {
  return addDays(dayOf(now), -PULSE_WINDOW_DAYS);
}

/** A row's shape decides which deletion may touch it (§4.4 point 3). */
export function rowShape(row) {
  if (row.dims.cohort) return "retention";
  if (row.dims.period === "week") return "weekly";
  if (row.dims.period === "month") return "monthly";
  return "daily";
}

function groupByShape(rows) {
  const keep = { daily: [], weekly: [], retention: [], monthly: [] };
  for (const row of rows) keep[rowShape(row)].push(row.dims);
  return keep;
}

/** Read the events of a window; an empty window is an empty list, not an error. */
async function loadEvents(client, from, to) {
  const { rows } = await client.query(
    `select name, occurred_at, org_id, actor_id, actor_type, props
       from metrics_events
      where occurred_at >= $1::date and occurred_at < ($2::date + 1)`,
    [from, to],
  );
  return rows.map((row) => ({
    name: row.name,
    occurredAt: row.occurred_at,
    orgId: row.org_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    props: row.props ?? {},
  }));
}

/**
 * Everything one day holds. `periodEnds` decides which shapes this run owns: a Sunday owns
 * weekly and retention rows, a month's last day owns the monthly row.
 */
export function rowsForDay({ day, orgs = [], events = [], invitations = [], subscriptions = null, basis = "snapshot" }) {
  const daily = [
    ...computeOrgsCreated({ day, orgs }),
    ...computeInvitesSent({ day, invitations }),
    ...computeInvitesAccepted({ day, invitations }),
    ...computeActiveActors({ day, events }),
    ...(metricAvailable("collab.sessions")
      ? computeCollaborativeSessions({ day, events })
      : []),
  ];
  const weekly = isWeekEnd(day)
    ? [
        ...computeActiveActors({ day, events, period: "week" }),
        ...computeCollaborativeTeams({ day, events }),
        ...computeActivation({ day, orgs, events }),
        ...(metricAvailable("feature.used") ? computeFeatureUsage({ day, events }) : []),
        ...(metricAvailable("template.used") ? computeTemplateUsage({ day, events }) : []),
        ...computeRetention({
          day,
          orgs,
          events,
          offsets: RETENTION_WEEKS,
        }),
      ]
    : [];
  const monthly = isMonthEnd(day)
    ? computeActiveActors({ day, events, period: "month" })
    : [];
  const money = computeMoney({ day, subscriptions, basis });
  return { derived: [...daily, ...weekly, ...monthly], money };
}

async function writeDay({ pool, store, zone, day, yesterday, metrics, log }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // `current_date` and every date cast follow this setting; the server's own zone must
    // never decide which day a row belongs to (§4.2).
    await client.query("set local time zone 'UTC'");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`pulse:${day}`]);

    const starts = [day];
    if (isWeekEnd(day)) starts.push(startOfWeek(day));
    if (isMonthEnd(day)) starts.push(startOfMonth(day));
    const eventsFrom = minDay(...starts);
    const events = await loadEvents(client, eventsFrom, day);

    const orgsFrom = addDays(startOfWeek(day), -7 * RETENTION_WEEKS);
    const orgs = await store.pulseOrgs({ from: orgsFrom, to: day });
    const invitations = await store.pulseInvitations({ from: day, to: day });

    let subscriptions = null;
    try {
      subscriptions = await store.pulseSubscriptions();
    } catch (error) {
      log.error?.(`[pulse] billing unreadable on ${day}: ${error.message ?? error}`);
    }

    const { derived, money } = rowsForDay({
      day,
      orgs,
      events,
      invitations,
      subscriptions,
      basis: day < yesterday ? "rebuilt" : "snapshot",
    });

    await upsertDerived(client, { day, zone, rows: derived });
    await insertSnapshots(client, { day, zone, rows: money });

    const shapes = ["daily"];
    if (isWeekEnd(day)) shapes.push("weekly", "retention");
    if (isMonthEnd(day)) shapes.push("monthly");
    await deleteStale(client, {
      day,
      zone,
      shapes,
      keep: groupByShape(derived),
    });

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Recompute a closed range of UTC days.
 *
 * `to` is clamped to yesterday, `from` to the 730-day window and the first day with
 * events. Period ends of touched weeks and months are added when they are already closed,
 * so a late event also corrects its week and month but never creates a running period.
 */
export async function recompute({
  pool,
  store,
  zone = "none",
  from,
  to = null,
  now = new Date(),
  metrics = null,
  log = console,
} = {}) {
  if (!pool) return { ok: false, reason: "the metrics database is not configured", days: [] };
  if (!store || typeof store.pulseOrgs !== "function") {
    return { ok: false, reason: "the product store cannot answer the aggregator", days: [] };
  }
  const today = dayOf(now);
  const yesterday = addDays(today, -1);
  const upper = to ?? yesterday;
  const toDay = minDay(upper, yesterday);
  let fromDay = maxDay(from, oldestRecomputableDay(now)) ?? from;
  const first = await firstEventDay(pool).catch((error) => {
    log.error?.(`[pulse] cannot read the first event day: ${error.message ?? error}`);
    return null;
  });
  if (first) fromDay = maxDay(fromDay, first);
  if (!fromDay || fromDay > toDay) {
    return { ok: true, from: fromDay, to: toDay, days: [], failed: [] };
  }

  const days = new Set(eachDay(fromDay, toDay));
  for (const day of [...days]) {
    const weekEnd = addDays(startOfWeek(day), 6);
    if (weekEnd <= yesterday) days.add(weekEnd);
    const monthEnd = addDays(startOfMonth(addDays(startOfMonth(day), 32)), -1);
    if (monthEnd <= yesterday) days.add(monthEnd);
  }
  const ordered = [...days].sort();
  const done = [];
  const failed = [];
  for (const day of ordered) {
    try {
      await writeDay({ pool, store, zone, day, yesterday, metrics, log });
      done.push(day);
      metrics?.inc?.("remo_pulse_recompute_days_total", { result: "ok" });
      metrics?.set?.("remo_pulse_last_success_timestamp_seconds", Math.floor(now.getTime() / 1000));
    } catch (error) {
      failed.push({ day, error: error.message ?? String(error) });
      metrics?.inc?.("remo_pulse_recompute_days_total", { result: "failed" });
      log.error?.(`[pulse] recompute ${day} failed: ${error.message ?? error}`);
    }
  }
  return { ok: failed.length === 0, from: fromDay, to: toDay, days: done, failed };
}

/**
 * The weekly housekeeping of §4.5: aggregates older than 730 days and events older than
 * 400. It runs in the same nightly loop, once a week, and removes local and peer rows.
 */
export async function pruneIfDue({ pool, now = new Date(), log = console } = {}) {
  if (!pool) return { skipped: "no metrics database" };
  const today = dayOf(now);
  if (new Date(`${today}T00:00:00.000Z`).getUTCDay() !== 1) return { skipped: "not Monday" };
  try {
    return await prune(pool, {
      windowStart: addDays(today, -PULSE_WINDOW_DAYS),
      eventsBefore: new Date(now.getTime() - METRICS_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    log.error?.(`[pulse] prune failed: ${error.message ?? error}`);
    return { error: error.message ?? String(error) };
  }
}

/**
 * The timer from §4.2 and the catch-up from §4.4.
 *
 * Every night at 03:10 UTC it recomputes D−1…D−3; on Monday it prunes first. On start it
 * walks the gap from the last written day to yesterday in the background, one logged day
 * at a time, and never delays `listen`. No timer means no aggregator: a missing metrics
 * database is a reason, not an error.
 */
export function createPulseLoop({
  pool = null,
  store = null,
  zone = "none",
  metrics = null,
  log = console,
  now = () => new Date(),
} = {}) {
  let timer = null;
  let running = false;

  async function nightly() {
    if (running) return;
    running = true;
    try {
      const today = dayOf(now());
      const yesterday = addDays(today, -1);
      if (new Date(`${today}T00:00:00.000Z`).getUTCDay() === 1) {
        await pruneIfDue({ pool, now: now(), log });
      }
      await recompute({
        pool,
        store,
        zone,
        from: addDays(yesterday, -2),
        to: yesterday,
        now: now(),
        metrics,
        log,
      });
    } finally {
      running = false;
    }
  }

  async function catchUp() {
    if (!pool || !store) return { skipped: "no metrics database" };
    const today = dayOf(now());
    const yesterday = addDays(today, -1);
    let last = null;
    try {
      last = await latestLocalDay(pool, zone);
    } catch (error) {
      log.error?.(`[pulse] catch-up cannot read the last day: ${error.message ?? error}`);
      return { skipped: "last day unreadable" };
    }
    const from = last ? addDays(last, 1) : addDays(yesterday, -2);
    if (from > yesterday) return { days: [] };
    const gap = eachDay(from, yesterday).length;
    log.log(`[pulse] catch-up ${gap} days from ${from}`);
    const result = await recompute({
      pool,
      store,
      zone,
      from,
      to: yesterday,
      now: now(),
      metrics,
      log,
    });
    return result;
  }

  function schedule() {
    const current = now();
    const next = new Date(current);
    next.setUTCHours(3, 10, 0, 0);
    if (next.getTime() <= current.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    timer = setTimeout(async () => {
      await nightly();
      schedule();
    }, next.getTime() - current.getTime());
    timer.unref?.();
  }

  function start() {
    // A disk store has no organisations or billing to aggregate; the night would only
    // log a refusal every day.
    if (!pool || !store || typeof store.pulseOrgs !== "function") return;
    schedule();
    // The catch-up runs after the port is open and never blocks a request.
    void catchUp();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { start, stop, catchUp, nightly };
}

export { openMetricsPool };
