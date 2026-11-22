/**
 * The metrics tables inside the run's throwaway database (ADR-131, ADR-082).
 *
 * Production keeps them in a separate database. A test run has one database, so they live
 * in their own schema instead: the product suites ask `current_schema()` what tables exist
 * and must not see `metrics_events` among the board tables. The schema is dropped with the
 * database at the end of the run.
 */
import { METRICS_SCHEMA } from "./metrics-store.mjs";

export const METRICS_TEST_SCHEMA = "pulse_metrics";

export async function openMetricsTestPool(connectionString, { max = 4 } = {}) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString,
    max,
    options: `-c search_path=${METRICS_TEST_SCHEMA},public`,
  });
  const client = await pool.connect();
  try {
    // Two suites may create the schema and the tables at the same time; `create table if
    // not exists` alone is not race-free.
    await client.query("select pg_advisory_lock(hashtext('metrics-schema'))");
    try {
      await client.query(`create schema if not exists ${METRICS_TEST_SCHEMA}`);
      await client.query(METRICS_SCHEMA);
    } finally {
      await client.query("select pg_advisory_unlock(hashtext('metrics-schema'))");
    }
  } finally {
    client.release();
  }
  return pool;
}
