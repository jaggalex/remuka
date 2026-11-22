/**
 * The SQL boundary of the Pulse aggregates (`spec/pulse.md` §4.1, §4.4, §5.3).
 *
 * One writer (`aggregate.mjs`), one collector (`peer-collect.mjs`) and readers — the
 * panel, the export and the CLI — share these statements so the shape of a row is spelled
 * once. Nothing here decides a number: a caller hands in computed rows and this module
 * writes them, or asks for rows and this module returns them.
 */
import { METRICS_SCHEMA } from "../metrics-store.mjs";

/** The metrics database is optional everywhere; a missing URL is a reason, not a crash. */
export async function openMetricsPool(env = process.env, { log = console } = {}) {
  const url = env.REMO_METRICS_DATABASE_URL;
  if (!url) return null;
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 3000 });
  pool.on("error", (error) => {
    log.error?.("[pulse] idle metrics connection lost:", error.message);
  });
  await pool.query(METRICS_SCHEMA);
  return pool;
}

/** Insert or update local derived rows; a peer row and a snapshot are never overwritten. */
export async function upsertDerived(client, { day, zone, rows }) {
  for (const row of rows) {
    await client.query(
      `insert into metrics_daily
         (day, zone, metric, dims, value, status, basis, provenance, computed_at)
       values ($1, $2, $3, $4, $5, $6, 'derived', 'local', now())
       on conflict (day, zone, metric, dims) do update
         set value = excluded.value,
             status = excluded.status,
             basis = excluded.basis,
             computed_at = now()
         where metrics_daily.provenance = 'local'
           and metrics_daily.basis = 'derived'`,
      [day, zone, row.metric, row.dims, row.value, row.status],
    );
  }
}

/**
 * Money is a snapshot: the first write for a day wins forever (`do nothing`).
 *
 * A missed day is inserted later with `basis = 'rebuilt'`; the value is still the state
 * seen on that later day, and the panel says so.
 */
export async function insertSnapshots(client, { day, zone, rows }) {
  for (const row of rows) {
    await client.query(
      `insert into metrics_daily
         (day, zone, metric, dims, value, status, basis, provenance, computed_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'local', now())
       on conflict (day, zone, metric, dims) do nothing`,
      [day, zone, row.metric, row.dims, row.value, row.status, row.basis],
    );
  }
}

const SHAPES = {
  daily: "not (dims ? 'period') and not (dims ? 'cohort')",
  weekly: "dims->>'period' = 'week' and not (dims ? 'cohort')",
  retention: "dims->>'period' = 'week' and dims ? 'cohort'",
  monthly: "dims->>'period' = 'month'",
};

/**
 * Remove local derived rows of a day that the new calculation no longer produces.
 *
 * The deletion is bounded by shape: a Sunday holds a daily row, a weekly row and the
 * retention rows of thirteen cohorts, so deleting the whole day would erase history that
 * this run did not recompute (§4.4). Snapshot rows are never deleted: money history is
 * not rewritten (§4.3).
 */
export async function deleteStale(client, { day, zone, shapes, keep }) {
  for (const shape of shapes) {
    await client.query(
      `delete from metrics_daily
        where day = $1 and zone = $2 and provenance = 'local' and basis = 'derived'
          and ${SHAPES[shape]}
          and not exists (
            select 1 from jsonb_array_elements($3::jsonb) as candidate
             where candidate = metrics_daily.dims
          )`,
      [day, zone, JSON.stringify(keep[shape] ?? [])],
    );
  }
}

/** The last day this installation has written, own zone only. */
export async function latestLocalDay(pool, zone) {
  const { rows } = await pool.query(
    "select max(day)::text as day from metrics_daily where zone = $1 and provenance = 'local'",
    [zone],
  );
  return rows[0]?.day ?? null;
}

/** The first day the metrics database holds events, or null when there are none. */
export async function firstEventDay(pool) {
  const { rows } = await pool.query(
    "select (min(occurred_at) at time zone 'UTC')::date::text as day from metrics_events",
  );
  return rows[0]?.day ?? null;
}

/** Rows for the panel and the digest; the zone list is chosen by the caller. */
export async function readDailyRows(pool, { zones, from, to }) {
  if (!zones?.length) return [];
  const { rows } = await pool.query(
    `select day::text as day, zone, metric, dims, value, status, basis, provenance,
            computed_at
       from metrics_daily
      where zone = any($1::text[]) and day >= $2 and day <= $3`,
    [zones, from, to],
  );
  return rows.map((row) => ({
    day: row.day,
    zone: row.zone,
    metric: row.metric,
    dims: row.dims ?? {},
    value: row.value === null ? null : Number(row.value),
    status: row.status,
    basis: row.basis,
    provenance: row.provenance,
    computedAt: row.computed_at,
  }));
}

/** Local rows of one zone for the export endpoint, already within the requested window. */
export async function readExportRows(pool, { zone, from, to }) {
  const { rows } = await pool.query(
    `select day::text as day, metric, dims, value, status, basis
       from metrics_daily
      where zone = $1 and provenance = 'local' and day >= $2 and day <= $3`,
    [zone, from, to],
  );
  return rows.map((row) => ({
    day: row.day,
    metric: row.metric,
    dims: row.dims ?? {},
    value: row.value === null ? null : Number(row.value),
    status: row.status,
    basis: row.basis,
  }));
}

/** Every peer state row, oldest origin first: `pulse:peer:list` and the panel. */
export async function peerStates(pool) {
  const { rows } = await pool.query(
    `select origin, zone, last_success_at, last_day::text as last_day, last_rows,
            last_error, last_error_at
       from pulse_peers
      order by origin`,
  );
  return rows.map((row) => ({
    origin: row.origin,
    zone: row.zone,
    lastSuccessAt: row.last_success_at,
    lastDay: row.last_day,
    lastRows: row.last_rows,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
  }));
}

/** Record a failed attempt on an origin that already has a state row. */
export async function recordPeerFailure(pool, { origin, error }) {
  await pool.query(
    `update pulse_peers
        set last_error = $2, last_error_at = now()
      where origin = $1`,
    [origin, String(error).slice(0, 500)],
  );
}

/**
 * Write one collected window: rows and the source's state in one transaction (§5.3).
 *
 * `unique (zone)` refuses a second installation claiming a zone that is already taken;
 * the caller reports that as a refusal rather than merging two sources into one series.
 */
export async function savePeerWindow(
  client,
  { origin, zone, rows, lastDay, lastRows },
) {
  await client.query("begin");
  try {
    for (const row of rows) {
      await client.query(
        `insert into metrics_daily
           (day, zone, metric, dims, value, status, basis, provenance, computed_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'peer', now())
         on conflict (day, zone, metric, dims) do update
           set value = excluded.value,
               status = excluded.status,
               basis = excluded.basis,
               computed_at = now()
           where metrics_daily.provenance = 'peer'`,
        [row.day, zone, row.metric, row.dims, row.value, row.status, row.basis],
      );
    }
    await client.query(
      `insert into pulse_peers
         (origin, zone, last_success_at, last_day, last_rows, last_error, last_error_at, received_at)
       values ($1, $2, now(), $3, $4, null, null, now())
       on conflict (origin) do update
         set zone = excluded.zone,
             last_success_at = now(),
             last_day = excluded.last_day,
             last_rows = excluded.last_rows,
             last_error = null,
             last_error_at = null,
             received_at = now()`,
      [origin, zone, lastDay, lastRows],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

/** Delete every aggregate of a peer zone and its state row in one transaction (§5.4). */
export async function deletePeerZone(client, { zone }) {
  await client.query("begin");
  try {
    const rows = await client.query(
      "delete from metrics_daily where zone = $1 and provenance = 'peer'",
      [zone],
    );
    await client.query("delete from pulse_peers where zone = $1", [zone]);
    await client.query("commit");
    return rows.rowCount ?? 0;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

/** The 730-day window and the 400-day event retention, pruned weekly (§4.5). */
export async function prune(pool, { windowStart, eventsBefore }) {
  const daily = await pool.query("delete from metrics_daily where day < $1", [windowStart]);
  const events = await pool.query("delete from metrics_events where occurred_at < $1", [
    eventsBefore,
  ]);
  return { daily: daily.rowCount ?? 0, events: events.rowCount ?? 0 };
}
