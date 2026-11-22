import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { runCustomerShow } from "./operator-customer.mjs";
import { testDatabaseStore } from "./test-db.mjs";

/**
 * The support card against a real database (ADR-259, `spec/operator.md` §3, §9).
 *
 * It names the plan, subscription, invoice and accepted document, counts rooms, and never
 * selects a room title: the operator answers a support question without reading the room.
 */
const opened = await testDatabaseStore("operator-customer");
const store = opened?.store ?? null;

const orgId = randomUUID();
const userId = randomUUID();
const email = `card-${userId}@example.test`;
const secretTitle = `Secret room title ${userId}`;

function capture() {
  const lines = [];
  return { lines, out: (line) => lines.push(String(line)), err: (line) => lines.push(String(line)) };
}

async function seed() {
  await store.pool.query(
    `insert into users (id, email, password_hash, name, handle, email_verified_at)
     values ($1, $2, 'x', 'Customer', $3, now())`,
    [userId, email, `card-${userId.slice(0, 8)}`],
  );
  await store.pool.query("insert into orgs (id, name, slug) values ($1, 'Card org', $2)", [
    orgId,
    `card-org-${orgId}`,
  ]);
  await store.pool.query(
    `insert into org_memberships (org_id, user_id, relation, state)
     values ($1, $2, 'member', 'active')`,
    [orgId, userId],
  );
  await store.pool.query(
    "insert into admin_roles (org_id, user_id, role) values ($1, $2, 'org_admin')",
    [orgId, userId],
  );
  await store.pool.query(
    `insert into billing_accounts (org_id, billing_email, currency)
     values ($1, $2, 'RUB')`,
    [orgId, `billing-${orgId}@example.test`],
  );
  await store.pool.query(
    `insert into subscriptions
       (org_id, plan, price_id, amount, currency, interval, status,
        current_period_start, current_period_end)
     values ($1, 'pro', $2, 29000, 'RUB', 'month', 'active',
             now() - interval '2 days', now() + interval '28 days')`,
    [orgId, `pro-rub-card-${orgId.slice(0, 8)}`],
  );
  await store.pool.query(
    `insert into invoices
       (org_id, number, status, currency, subtotal, discount, credit_applied, total, lines)
     values ($1, $2, 'paid', 'RUB', 29000, 0, 0, 29000, '[]'::jsonb)`,
    [orgId, `RU-CARD-${orgId.slice(0, 8)}`],
  );
  await store.pool.query(
    `insert into legal_acceptances (user_id, zone, doc, version, sha256, event)
     values ($1, 'ru', 'consent', 2, $2, 'accept')`,
    [userId, "a".repeat(64)],
  );
  await store.pool.query(
    `insert into boards (id, title, org_id, owner_id)
     values ($1, $2, $3, $4)`,
    [`card-board-${orgId}`, secretTitle, orgId, userId],
  );
}

describe.skipIf(!store)("customer:show (ADR-259)", () => {
  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from boards where org_id = $1", [orgId]);
    await store.pool.query("delete from legal_acceptances where user_id = $1", [userId]);
    await store.withTenant(orgId, async () => {
      for (const table of ["invoices", "subscriptions", "billing_accounts"]) {
        await store.pool.query(`delete from ${table} where org_id = $1`, [orgId]);
      }
    });
    await store.pool.query("delete from admin_roles where org_id = $1", [orgId]);
    await store.pool.query("delete from org_memberships where org_id = $1", [orgId]);
    await store.pool.query("delete from orgs where id = $1", [orgId]);
    await store.pool.query("delete from users where id = $1", [userId]);
    await store.close();
  });

  it("shows the plan, subscription, invoice and acceptance without a room title", async () => {
    await seed();
    const log = capture();
    const code = await runCustomerShow({
      argv: ["--email", email],
      store,
      env: { DATABASE_URL: "unused" },
      out: log.out,
      err: log.err,
    });
    const text = log.lines.join("\n");
    expect(code, text).toBe(0);
    expect(text).toContain(`account ${userId} ${email}`);
    expect(text).toContain("subscription: pro/active");
    expect(text).toContain(`RU-CARD-${orgId.slice(0, 8)}`);
    expect(text).toContain("ru/consent v2 accept");
    expect(text).toContain("members: 1, guests: 0, rooms: 1");
    expect(text).not.toContain(secretTitle);
  });

  it("accepts an organisation id as well", async () => {
    const log = capture();
    const code = await runCustomerShow({
      argv: ["--org", orgId],
      store,
      env: { DATABASE_URL: "unused" },
      out: log.out,
      err: log.err,
    });
    expect(code, log.lines.join("\n")).toBe(0);
    expect(log.lines.join("\n")).toContain("Card org");
  });
});
