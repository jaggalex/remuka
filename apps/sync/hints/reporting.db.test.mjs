import { expect, it } from "vitest";
import { openMetricsTestPool } from "../metrics-test-db.mjs";
import { testDatabaseStore } from "../test-db.mjs";
import { operatorWords } from "./api.mjs";

const opened = await testDatabaseStore("words reporting");
it.skipIf(!opened)("Words totals cover today and the previous 27 UTC dates for each variant", async () => {
  const pool = await openMetricsTestPool(opened.url);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from hint_daily where slot='search.empty'");
    await client.query(`insert into hint_daily(day,slot,variant,shown,acted)
      select (now() at time zone 'UTC')::date - back, 'search.empty', 'action', impressions, clicks
      from (values (0,7,5), (27,11,2), (28,33,17)) as sample(back,impressions,clicks)`);
    let body;
    const response = { writeHead(status) { expect(status).toBe(200); }, end(json) { body = JSON.parse(json); } };
    await operatorWords({ response, metricsStore: { pool: client } }, "index");
    expect(body.metricsAvailable).toBe(true);
    expect(body.counts.filter(row => row.slot === "search.empty")).toEqual([
      { slot: "search.empty", variant: "action", shown: 18, acted: 7 },
    ]);
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
    await opened.store.close();
  }
});
