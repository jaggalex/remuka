/**
 * Metrics sink: a separate PostgreSQL database (ADR-082).
 *
 * It is intentionally not the product database: metrics are not a source of truth for
 * boards, grants or audit, and dropping the metrics database must never affect a board.
 *
 * `metrics_daily` and `pulse_peers` belong here too (ADR-258, `spec/pulse.md` §4.1, §5.3).
 * The table has no schema version of its own: `create table if not exists` is idempotent,
 * so `pnpm db:metrics` and the service start apply the same file (ADR-082).
 *
 * The metrics database keeps product events for 400 days: the recompute window is 730
 * days, but an event older than the retention cannot be re-aggregated, and a 400-day
 * stream is enough for late corrections and the launch quarter. The owner's decision of
 * 2026-11-23 fixed that number; the aggregator prunes weekly (`pulse/aggregate.mjs`).
 */
export const METRICS_EVENTS_RETENTION_DAYS = 400;

export const METRICS_SCHEMA = `
create table if not exists metrics_events (
  event_id uuid primary key,
  name text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  org_id uuid,
  actor_id uuid,
  actor_type text not null,
  board_id text,
  session_id text,
  app_version text not null,
  schema_version integer not null,
  props jsonb not null default '{}'::jsonb
);
create index if not exists metrics_events_time_idx on metrics_events (occurred_at);
create index if not exists metrics_events_org_time_idx on metrics_events (org_id, occurred_at);
create index if not exists metrics_events_name_time_idx on metrics_events (name, occurred_at);
-- Activation is once per workspace, not once per save. A partial unique index makes
-- the event idempotent even when several boards are saved concurrently (ADR-082).
create unique index if not exists metrics_activation_once_idx
  on metrics_events (org_id)
  where name = 'activation.first_value' and org_id is not null;

-- Daily aggregates (spec/pulse.md §4.1). One row per day, zone, metric and dimension set;
-- the primary key is also the idempotency rule of the nightly recompute (§4.4).
create table if not exists metrics_daily (
  day date not null,                    -- UTC date; a week or month row sits on the last day
  zone text not null check (zone in ('eu', 'ru', 'none')),
  metric text not null,                 -- spec/pulse.md §1.2–1.3, e.g. orgs.created
  dims jsonb not null default '{}'::jsonb,   -- closed key list, see the check below
  value bigint,                         -- counter, currency minor units or micro-USD
  status text not null default 'ok' check (status in ('ok', 'suppressed', 'unavailable')),
  basis text not null default 'derived' check (basis in ('derived', 'snapshot', 'rebuilt')),
  provenance text not null default 'local' check (provenance in ('local', 'peer')),
  computed_at timestamptz not null default now(),
  primary key (day, zone, metric, dims),
  constraint metrics_daily_value_check
    check ((status = 'ok') = (value is not null) and (value is null or value >= 0)),
  constraint metrics_daily_dims_check check (
    dims - 'period' - 'plan' - 'currency' - 'source' - 'feature' - 'template' - 'skill'
         - 'cohort' - 'offset' = '{}'::jsonb
  ),
  constraint metrics_daily_no_email_check check (strpos(dims::text, '@') = 0)
);
create index if not exists metrics_daily_metric_idx on metrics_daily (metric, zone, day);
create index if not exists metrics_daily_peer_idx
  on metrics_daily (zone, day) where provenance = 'peer';

-- One row per installation the collector reads (spec/pulse.md §5.3). The zone is the
-- source's own zone and is remembered on the first successful collection; the unique
-- constraint on zone is what makes "delete every row of that zone" exact.
create table if not exists pulse_peers (
  origin text primary key,             -- the peer's scheme and host only, no path
  zone text not null check (zone in ('eu', 'ru')),
  last_success_at timestamptz,
  last_day date,
  last_rows integer,
  last_error text,
  last_error_at timestamptz,
  received_at timestamptz not null default now(),
  unique (zone)
);

-- The read-only boundary for an external BI tool (spec/pulse.md §4.3 last bullet). It is a
-- view so a grant can name it without exposing writes; the service keeps writing the table.
create or replace view pulse_daily as
  select day, zone, metric, dims, value, status, basis, provenance, computed_at
    from metrics_daily;
`;

export class MetricsStore {
  constructor({ connectionString, log = console }) {
    this.connectionString = connectionString;
    this.log = log;
    this.pool = null;
  }

  async connect() {
    const { default: pg } = await import("pg");
    this.pool = new pg.Pool({
      connectionString: this.connectionString,
      max: 2,
      connectionTimeoutMillis: 3000,
    });
    // A metrics outage must not affect a board, and an unheard pool error would (ADR-160).
    this.pool.on("error", (error) => {
      this.log.error("[metrics] idle database connection lost:", error.message);
    });
    await this.pool.query(METRICS_SCHEMA);
    this.log.log("[metrics] separate database ready");
  }

  /** Best-effort insert. A metrics outage must not affect a board. */
  async record(event) {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `insert into metrics_events
          (event_id, name, occurred_at, org_id, actor_id, actor_type, board_id, session_id, app_version, schema_version, props)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict do nothing`,
        [
          event.event_id,
          event.name,
          event.occurred_at,
          event.org_id,
          event.actor_id,
          event.actor_type,
          event.board_id,
          event.session_id,
          event.app_version,
          event.schema_version,
          event.props ?? {},
        ],
      );
    } catch (error) {
      this.log.error?.(`[metrics] write failed: ${error.message ?? error}`);
    }
  }

  async close() {
    await this.pool?.end?.();
    this.pool = null;
  }
}
