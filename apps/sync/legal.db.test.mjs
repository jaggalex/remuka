/**
 * The legal-acceptance journal against a real database (ADR-256 §4).
 *
 * Proves what the unit test cannot: schema 37 exists with the requested columns and
 * indexes, the table stays outside tenant RLS like `users` and `consent_events`, the
 * account and its acceptances really share one transaction, and the retention pass clears
 * only the address digest.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("legal acceptances");
const store = opened?.store ?? null;
const suite = store ? describe : describe.skip;

const users = [];

function hashEverything() {
  return "a".repeat(64);
}

async function createAccount({ acceptances } = {}) {
  const tag = randomUUID();
  const user = await store.createUserWithAcceptances({
    email: `legal-${tag}@example.test`,
    passwordHash: "x",
    name: "Legal",
    handle: `legal-${tag.slice(0, 12)}`,
    acceptances: acceptances ?? [
      { zone: "ru", doc: "offer", version: 1, sha256: hashEverything(), ipHash: "b".repeat(64), userAgent: "legal-db-test" },
      { zone: "ru", doc: "consent", version: 1, sha256: "c".repeat(64), ipHash: "e".repeat(64), userAgent: "legal-db-test" },
    ],
  });
  users.push(user.id);
  return user;
}

async function rowsOf(userId) {
  const { rows } = await store.pool.query(
    `select zone, doc, version, sha256, accepted_at, ip_hash, user_agent
       from legal_acceptances where user_id = $1
      order by doc`,
    [userId],
  );
  return rows;
}

suite("db:legal acceptances (ADR-256 §4)", () => {
  afterAll(async () => {
    if (!store) return;
    if (users.length) {
      await store.pool.query("delete from users where id = any($1::uuid[])", [users]);
    }
    await store.close();
  });

  it("applies schema 37 with the journal and no tenant RLS", async () => {
    const { rows: meta } = await store.pool.query(
      "select version from schema_meta where id = 1",
    );
    expect(meta[0].version).toBe(40);

    const { rows: columns } = await store.pool.query(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'legal_acceptances'
        order by ordinal_position`,
    );
    expect(columns.map((column) => column.column_name)).toEqual([
      "id",
      "user_id",
      "zone",
      "doc",
      "version",
      "sha256",
      "accepted_at",
      "ip_hash",
      "user_agent",
      "event",
    ]);
    const nullable = Object.fromEntries(
      columns.map((column) => [column.column_name, column.is_nullable]),
    );
    expect(nullable.user_id).toBe("NO");
    expect(nullable.sha256).toBe("NO");
    expect(nullable.ip_hash).toBe("YES");
    expect(nullable.user_agent).toBe("YES");

    const { rows: indexes } = await store.pool.query(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'legal_acceptances'`,
    );
    expect(indexes.map((index) => index.indexname).sort()).toEqual([
      "legal_acceptances_doc_idx",
      "legal_acceptances_ip_idx",
      "legal_acceptances_pkey",
      "legal_acceptances_user_idx",
    ]);

    const { rows: policy } = await store.pool.query(
      `select relrowsecurity, relforcerowsecurity from pg_class
        where relname = 'legal_acceptances'`,
    );
    // The person's proof, not the organisation's content: global, like `consent_events`.
    expect(policy[0]).toMatchObject({ relrowsecurity: false, relforcerowsecurity: false });
  });

  it("creates the account and its acceptances in one transaction", async () => {
    const user = await createAccount();
    const rows = await rowsOf(user.id);
    expect(rows.map((row) => row.doc)).toEqual(["consent", "offer"]);
    expect(rows.find((row) => row.doc === "offer")).toMatchObject({
      zone: "ru",
      version: 1,
      sha256: hashEverything(),
      user_agent: "legal-db-test",
    });
    expect(rows.find((row) => row.doc === "offer").ip_hash).toBe("b".repeat(64));
  });

  it("leaves no account behind when the acceptance cannot be written", async () => {
    const tag = randomUUID();
    const email = `legal-broken-${tag}@example.test`;
    await expect(
      store.createUserWithAcceptances({
        email,
        passwordHash: "x",
        name: "Broken",
        handle: `legal-broken-${tag.slice(0, 12)}`,
        acceptances: [
          { zone: "ru", doc: "offer", version: 1, sha256: "not-a-sha256", ipHash: null, userAgent: null },
        ],
      }),
    ).rejects.toMatchObject({ code: "23514" });

    const { rows } = await store.pool.query("select id from users where email = $1", [email]);
    expect(rows).toEqual([]);
  });

  it("lists one account's acceptances and nothing of another", async () => {
    const anna = await createAccount();
    const boris = await createAccount();
    const listed = await store.listLegalAcceptances(anna.id);
    expect(listed).toHaveLength(2);
    expect(listed.every((row) => row.user_id === anna.id)).toBe(true);
    expect((await store.listLegalAcceptances(boris.id)).every((row) => row.user_id === boris.id)).toBe(
      true,
    );
  });

  it("keeps acceptance and withdrawal rows and answers the latest state", async () => {
    const user = await createAccount();
    await store.recordLegalAcceptances({
      userId: user.id,
      rows: [
        { zone: "ru", doc: "consent", version: 1, sha256: "f".repeat(64), event: "accept" },
      ],
      ipHash: null,
      userAgent: "legal-db-test",
    });
    await store.recordLegalAcceptances({
      userId: user.id,
      rows: [
        { zone: "ru", doc: "consent", version: 1, sha256: "f".repeat(64), event: "withdraw" },
      ],
      ipHash: null,
      userAgent: "legal-db-test",
    });

    const latest = await store.latestLegalAcceptances(user.id);
    expect(latest.find((row) => row.doc === "consent")).toMatchObject({
      event: "withdraw",
      sha256: "f".repeat(64),
    });
    // The history keeps both rows: a withdrawal is a proof, not an erasure.
    const history = await store.listLegalAcceptances(user.id);
    expect(history.filter((row) => row.doc === "consent").map((row) => row.event)).toEqual([
      "accept",
      "accept",
      "withdraw",
    ]);
    const { rows: audit } = await store.pool.query(
      `select action from audit_events
        where actor_id = $1 and action in ('legal.accept', 'legal.withdraw')
        order by at, id`,
      [user.id],
    );
    expect(audit.map((row) => row.action)).toEqual(["legal.accept", "legal.withdraw"]);
  });

  it("clears only the digests older than the retention cutoff", async () => {
    const user = await createAccount();
    await store.pool.query(
      `update legal_acceptances set accepted_at = now() - interval '1200 days'
        where user_id = $1 and doc = 'offer'`,
      [user.id],
    );
    const cleared = await store.clearLegalIpBefore(
      new Date(Date.now() - 1095 * 24 * 60 * 60 * 1000),
    );
    expect(cleared).toBeGreaterThanOrEqual(1);

    const { rows } = await store.pool.query(
      `select doc, ip_hash from legal_acceptances where user_id = $1 order by doc`,
      [user.id],
    );
    // The old digest is gone; the row and its hash still prove the acceptance. A digest
    // inside the retention period stays.
    expect(rows.find((row) => row.doc === "offer").ip_hash).toBeNull();
    expect(rows.find((row) => row.doc === "consent").ip_hash).toBe("e".repeat(64));
    const { rows: proof } = await store.pool.query(
      "select sha256 from legal_acceptances where user_id = $1 and doc = 'offer'",
      [user.id],
    );
    expect(proof[0].sha256).toBe(hashEverything());
  });
});
