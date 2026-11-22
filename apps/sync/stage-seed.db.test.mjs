import { describe, expect, it } from "vitest";
import { runStageSeed } from "./stage-seed.mjs";
import { testDatabaseStore } from "./test-db.mjs";

/**
 * `stage:seed` twice is the same stand (`spec/stage.md` §6).
 *
 * The suite is skipped without the dedicated test server (ADR-131); with it, the real
 * store is the point: fixed room ids, one subscription, one public link and one operator
 * row must stay single after a second run.
 */
const database = await testDatabaseStore("stage seed");
const store = database?.store ?? null;
const suite = store ? describe : describe.skip;

const ENV = {
  REMO_STAGE: "1",
  REMO_STAGE_SEED_DOMAIN: "stage.test",
  REMO_STAGE_SEED_PASSWORD: "stage-fixture-password",
  REMO_BILLING_CURRENCIES: "RUB",
  REMO_COMPLIANCE_ZONE: "none",
};

const quiet = { log() {}, error() {} };

suite("stage seed", () => {
  it("is idempotent and creates the fixtures of §6", async () => {
    const first = await runStageSeed({ env: ENV, store, log: quiet });
    const second = await runStageSeed({ env: ENV, store, log: quiet });
    expect(second.domain).toBe(first.domain);

    const userCount = await store.pool.query(
      "select count(*)::int as n from users where email like $1",
      ["%@stage.test"],
    );
    expect(userCount.rows[0].n).toBe(5);

    const owner = await store.getOrgBySlug("stage-owner");
    const pro = await store.getOrgBySlug("stage-pro");
    expect(owner?.id).toBeTruthy();
    expect(pro?.id).toBeTruthy();

    const rooms = await store.withTenant(owner.id, () =>
      store.pool.query(
        "select count(*)::int as n from boards where org_id = $1 and archived_at is null",
        [owner.id],
      ),
    );
    expect(rooms.rows[0].n).toBe(5);

    const link = await store.withTenant(owner.id, () => store.getBoardLink("stage-owner-room-1"));
    expect(link?.enabled).toBe(true);
    expect(link?.has_password).toBe(true);

    const live = await store.withTenant(pro.id, () => store.liveSubscription(pro.id));
    expect(live?.plan).toBe("pro");

    const legacy = await store.findUserByEmail("legacy@stage.test");
    const legacyRows = await store.pool.query(
      "select count(*)::int as n from legal_acceptances where user_id = $1",
      [legacy.id],
    );
    expect(legacyRows.rows[0].n).toBe(0);

    const operator = await store.findUserByEmail("operator@stage.test");
    expect(await store.isInstanceOperator(operator.id)).toBe(true);
    const mfa = await store.pool.query("select count(*)::int as n from user_mfa where user_id = $1", [
      operator.id,
    ]);
    expect(mfa.rows[0].n).toBe(0);

    const colleague = await store.findUserByEmail("colleague@stage.test");
    const colleagues = await store.withTenant(owner.id, () =>
      store.pool.query(
        "select count(*)::int as n from org_memberships where org_id = $1 and user_id = $2 and state = 'active'",
        [owner.id, colleague.id],
      ),
    );
    expect(colleagues.rows[0].n).toBe(1);
  });
});
