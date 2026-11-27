import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";
import { Y } from "./y.mjs";

const store = (await testDatabaseStore("room covers"))?.store;
afterAll(() => store?.close());

(store ? describe : describe.skip)("durable room cover scheduling", () => {
  it("reserves one worker, preserves intervening edits, and skips unchanged rooms", async () => {
    const id = randomUUID();
    const user = await store.createUser({ email: id + "@example.com", name: "Cover", handle: id.slice(0,8), passwordHash: "unused" });
    const { org, team } = await store.createOrgWithOwner({ name: "Cover test", slug: "cover-" + id, userId: user.id });
    await store.createIamBoard({ id, orgId: org.id, teamId: team.id, ownerId: user.id, title: "Closed room" });
    const reserve = () => store.withTenant(org.id, () => store.claimRoomCover(id));
    const [first, second] = await Promise.all([reserve(), reserve()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const job = first ?? second;
    const staleToken = { ...job, token: randomUUID() };
    expect(await store.publishRoomCover(id, staleToken, Buffer.from("bad"))).toBe(false);
    const doc = new Y.Doc();
    try {
      doc.getMap("meta").set("title", "Changed during render");
      await store.pool.query("insert into board_updates (board_id, update) values ($1,$2)", [id, Y.encodeStateAsUpdate(doc)]);
      expect(await store.publishRoomCover(id, job, Buffer.from("first cover"))).toBe(true);
      expect(await reserve()).toBeNull();
      const { rows: [row] } = await store.pool.query(
        "select extract(epoch from cover_next_at-now()) as seconds from boards where id=$1", [id]);
      expect(Number(row.seconds)).toBeGreaterThan(550);
      expect(Number(row.seconds)).toBeLessThanOrEqual(600);
      await store.pool.query("update boards set cover_next_at=now() where id=$1", [id]);
      const next = await reserve();
      expect(next).toBeTruthy();
      await store.publishRoomCover(id, next, Buffer.from("second cover"));
      await store.pool.query("update boards set cover_next_at=now(), updated_at=now() where id=$1", [id]);
      expect(await reserve()).toBeNull();
      expect((await store.roomCover(id)).toString()).toBe("second cover");
    } finally {
      doc.destroy();
      await store.pool.query("delete from boards where id=$1", [id]);
    }
  });
});
