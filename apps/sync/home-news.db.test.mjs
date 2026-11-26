import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { homeNews, rankHomeNews } from "./home-news.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("home news");
const store = opened?.store;
const org = randomUUID();
const owner = { id: randomUUID(), handle: "news.owner" };
const friend = { id: randomUUID(), handle: "news.friend" };
const board = "news-" + randomUUID();
const secret = "news-private-" + randomUUID();
const membership = { state: "active", relation: "member" };
const live = new Map([[board, ["Teammate"]], [secret, ["Private name"]]]);
const get = (user, presence = live) => homeNews(store, org, user, membership, presence);
let mention, task;

describe.skipIf(!store)("team news with Postgres", () => {
  beforeAll(async () => {
    const query = (sql, params) => store.pool.query(sql, params);
    for (const user of [owner, friend]) {
      await query("insert into users (id,email,password_hash,name,handle) values ($1,$2,'unused',$3,$4)",
        [user.id, user.id + "@example.test", user.handle, user.handle + "-" + org.slice(0, 5)]);
    }
    await query("insert into orgs (id,name,slug) values ($1::uuid,'News',$1::uuid::text)", [org]);
    await query("insert into org_memberships (org_id,user_id) values ($1,$2),($1,$3)", [org, owner.id, friend.id]);
    await query("insert into boards (id,org_id,owner_id,title) values ($1,$3,$4,'Accessible room'),($2,$3,$4,'Hidden room')",
      [board, secret, org, owner.id]);
    await store.putGrant({ boardId: board, subjectType: "user", subjectId: friend.id, role: "editor", grantedBy: owner.id });
    const add = (id) => store.createCommentThread({ boardId: id, anchor: { kind: "point", x: 3, y: 2 },
      authorId: owner.id, authorName: "Teammate", body: "SECRET COMMENT @" + friend.handle + "!" });
    mention = (await add(board)).thread.id;
    await add(secret);
    const agentId = randomUUID();
    await query("insert into agents(id,org_id,owner_id,name) values ($1,$2,$3,'Test agent')", [agentId, org, owner.id]);
    task = randomUUID();
    await query("insert into agent_tasks(id,org_id,agent_id,board_id,intent,status,created_by) values ($1,$2,$3,$4,'SECRET TASK','awaiting_approval',$5)",
      [task, org, agentId, secret, owner.id]);
  });
  afterAll(async () => { await store?.close(); });

  it("returns only granted metadata and rechecks read markers, proposals and revocation during a cached visit", async () => {
    const items = await get(friend);
    expect(items.map(i => i.type)).toEqual(["mention"]);
    expect(items[0]).toMatchObject({ roomId: board, roomTitle: "Accessible room", targetId: mention, people: [{ name: "Teammate" }] });
    expect(JSON.stringify(items)).not.toMatch(/Hidden room|Private name|SECRET/);
    await store.markCommentRead(mention, board, "user:" + friend.id);
    expect((await get(friend)).map(i => i.type)).toEqual(["live"]);
    expect((await get(owner)).some(i => i.targetId === task)).toBe(true);
    await store.pool.query("update agent_tasks set status='applied' where id=$1", [task]);
    expect((await get(owner)).some(i => i.targetId === task)).toBe(false);
    await store.pool.query("delete from board_grants where board_id=$1 and subject_id=$2", [board, friend.id]);
    expect(await get(friend)).toEqual([]);
  });
});

it("ranks by age and involvement and keeps at most three independent items", async () => {
  const now = Date.now(), rows = [];
  const add = (id, type, room, hours, involved) => rows.push({ id, type, board_id: room, at: new Date(now - hours * 3_600_000), involved });
  add("old", "mention", "old", 49, true);
  add("a", "mention", "a", 0, true);
  add("a2", "agent", "a", 0, true);
  add("b", "mention", "b", 1, false);
  add("c", "mention", "c", 2, false);
  add("d", "agent", "d", 12, true);
  add("e", "joined", null, 1, false);
  const result = await rankHomeNews(rows, new Map(), async () => true, now);
  expect(result.map(i => i.id)).toEqual(["mention:a", "mention:b", "agent:d"]);
});

it.skipIf(!opened)("counts actions by type and organisation once per UTC day without personal or room properties", async () => {
  const { metricEvent } = await import("@remo/metrics");
  const { openMetricsTestPool, METRICS_TEST_SCHEMA } = await import("./metrics-test-db.mjs");
  const { MetricsStore } = await import("./metrics-store.mjs");
  const pool = await openMetricsTestPool(opened.url);
  const sink = new MetricsStore({ connectionString: opened.url, options: "-c search_path=" + METRICS_TEST_SCHEMA + ",public" });
  try {
    await sink.connect();
    const event = (type) => metricEvent({ name: "news.clicked", orgId: org, props: { type } });
    await sink.record(event("mention"));
    await sink.record(event("mention"));
    await sink.record(event("live"));
    const { rows } = await pool.query("select props,actor_id,session_id from metrics_events where name='news.clicked' and org_id=$1", [org]);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => !r.actor_id && !r.session_id && Object.keys(r.props).join() === "type")).toBe(true);
    expect(() => event("private text")).toThrow();
  } finally { await sink.close(); await pool.end(); }
});
