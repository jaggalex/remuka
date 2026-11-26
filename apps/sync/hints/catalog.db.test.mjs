import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { slots, catalogSlot, validateVariants } from "./catalog.mjs";
import { publishedWords, saveWords, slotState } from "./store.mjs";
import { exportWords, importDrafts } from "./transfer.mjs";
import { testDatabaseStore } from "../test-db.mjs";

const opened = await testDatabaseStore("words");
const store = opened?.store;
const editor = randomUUID();
const slot = catalogSlot("room.empty");

it("registers only product teaching surfaces and ships valid defaults in both languages", () => {
  for (const rule of slots) {
    expect(["room","home","comments","search","follow","voting","activity"]).toContain(rule.screen);
    for (const lang of ["ru", "en"]) expect(validateVariants(rule, lang, rule.defaults[lang]).variants).toHaveLength(rule.defaults[lang].length);
  }
});

describe.skipIf(!store)("published wording and portable drafts", () => {
  const words = (body, action = "draft") => saveWords(store.pool, { id: slot.id, lang: "en",
    action, body, operator: editor, mfa: "totp" });
  beforeAll(async () => {
    await store.pool.query("insert into users(id,email,password_hash,name,handle) values ($1,$2,'unused','Wording QA',$3)", [editor, editor + "@example.test","words-"+editor.slice(0,8)]);
  });
  afterAll(async () => { await store?.close(); });
  it.each([
    ["html","click <b>here</b>"], ["link","read https://example.org"],
    ["placeholder","Hello {unknown}"], ["emoji","Hello 😀"], ["voice","Oops!"],
    ["length","x".repeat(241)], ["bold","Hello **team**"],
  ])("rejects %s and writes nothing", async (code, text) => {
    const variants = structuredClone(slot.defaults.en);
    variants[0].fields.body = text;
    await expect(words({ expected: 0, variants })).rejects.toMatchObject({ code });
    expect((await slotState(store.pool, slot, "en")).draft).toBe(null);
  });

  it("preserves revisions, checks concurrent edits, audits reason and rolls back to built-in copy", async () => {
    const variants = structuredClone(slot.defaults.en);
    variants[0].fields.body = "Try the new wording";
    expect((await publishedWords(store.pool, "en"))[slot.id]).toBeUndefined();
    const saves = await Promise.allSettled([words({ expected: 0, variants }), words({ expected: 0, variants })]);
    expect(saves.map(s => s.status).sort()).toEqual(["fulfilled","rejected"]);
    expect((await publishedWords(store.pool, "en"))[slot.id]).toBeUndefined();
    await expect(words({ expected: 1, reason: "" }, "publish")).rejects.toMatchObject({ code: "reason" });
    await words({ expected: 1, reason: "Clarify the first step" }, "publish");
    const exported = await exportWords(store.pool);
    expect(exported.entries.find(e => e.slot === slot.id && e.lang === "en").variants).toContainEqual(variants[0]);
    expect((await publishedWords(store.pool, "ru"))[slot.id]).toBeUndefined();
    await words({ expected: 2, reason: "Restore original" }, "rollback");
    expect((await publishedWords(store.pool, "en"))[slot.id].find(v => v.key === "action").fields).toEqual(slot.defaults.en[0].fields);
    const audit = await store.pool.query("select reason,after,channel,mfa from audit_events where actor_id=$1 and action='hint.published' order by id", [editor]);
    expect(audit.rows).toMatchObject([{ reason: "Clarify the first step", after: { version: 2 }, channel: "console", mfa: "totp" },
      { reason: "Restore original", after: { version: 3 } }]);
    const handoff = { format: 1, entries: exported.entries.filter(e => e.slot === slot.id) };
    await importDrafts(store.pool, handoff, editor);
    expect((await slotState(store.pool, slot, "en")).draft.variants).toContainEqual(variants[0]);
    expect((await slotState(store.pool, slot, "ru")).published.version).toBe(0);
    await importDrafts(store.pool, handoff, editor);
  });
});

it.skipIf(!opened)("stores only daily wording totals, without raw visits or personal identifiers", async () => {
  const { metricEvent } = await import("@remo/metrics");
  const { MetricsStore } = await import("../metrics-store.mjs");
  const { openMetricsTestPool, METRICS_TEST_SCHEMA } = await import("../metrics-test-db.mjs");
  const pool = await openMetricsTestPool(opened.url);
  const sink = new MetricsStore({ connectionString: opened.url, options: "-c search_path=" + METRICS_TEST_SCHEMA + ",public" });
  try {
    await sink.connect();
    const props = { slot: slot.id, variant: "action" };
    const event = name => ({ ...metricEvent({ name, props }), occurred_at: "2021-10-17T01:00:00Z" });
    await sink.record(event("hint.shown"));
    await sink.record(event("hint.shown"));
    await sink.record(event("hint.acted"));
    const totals = await pool.query("select shown::int, acted::int from hint_daily where day='2021-10-17' and slot=$1 and variant='action'", [slot.id]);
    expect(totals.rows).toEqual([{ shown: 2, acted: 1 }]);
    expect((await pool.query("select 1 from metrics_events where name in ('hint.shown','hint.acted')")).rowCount).toBe(0);
    expect(() => metricEvent({ name: "hint.shown", props: { ...props, userId: editor } })).toThrow();
  } finally { await sink.close(); await pool.end(); }
});
