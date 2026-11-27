/**
 * The cross-tenant reads behind the billing letter loop (ADR-319), against Postgres:
 * plan events with their subscription, the reminder windows, the admins' addresses and
 * the facts a letter prints about the space.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("billing letters");
const store = opened?.store ?? null;
const KEK = { key: randomBytes(32), id: "test-kek" };
const NOW = new Date();
const DAY = 86_400_000;
const orgs = [];
const users = [];

async function organisation(tag) {
  const id = randomUUID();
  await store.pool.query("insert into orgs (id, name, slug) values ($1, $2, $3)", [id, `Letters ${tag}`, `letters-${tag}-${id}`]);
  orgs.push(id);
  return id;
}

async function admin(orgId, tag, { active = true } = {}) {
  const userId = randomUUID();
  await store.pool.query(
    "insert into users (id, email, password_hash, name, handle) values ($1, $2, 'x', $3, $4)",
    [userId, `${tag}-${userId}@example.test`, tag, `${tag}-${userId.slice(0, 8)}`],
  );
  users.push(userId);
  await store.pool.query(
    "insert into org_memberships (org_id, user_id, relation, state) values ($1, $2, 'member', $3)",
    [orgId, userId, active ? "active" : "suspended"],
  );
  await store.pool.query("insert into admin_roles (org_id, user_id, role) values ($1, $2, 'org_admin')", [orgId, userId]);
  return `${tag}-${userId}@example.test`;
}

async function subscription(orgId, overrides = {}) {
  const id = randomUUID();
  const row = { status: "active", interval: "month", end: new Date(NOW.getTime() + 20 * DAY), trialEnd: null, ...overrides };
  await store.withTenant(orgId, () => store.pool.query(
    `insert into subscriptions (id, org_id, plan, price_id, amount, currency, interval, status,
        current_period_start, current_period_end, trial_end)
     values ($1, $2, 'team', 'team-rub', 59000, 'RUB', $3, $4, $5, $6, $7)`,
    [id, orgId, row.interval, row.status, new Date(NOW.getTime() - 10 * DAY), row.end, row.trialEnd],
  ));
  return id;
}

describe.skipIf(!store)("db:billing letters (ADR-319)", () => {
  afterAll(async () => {
    if (!store) return;
    for (const orgId of orgs) {
      await store.withTenant(orgId, async () => {
        for (const table of ["billing_events", "subscriptions", "payment_methods", "boards"]) {
          await store.pool.query(`delete from ${table} where org_id = $1`, [orgId]);
        }
      });
      await store.pool.query("delete from admin_roles where org_id = $1", [orgId]);
      await store.pool.query("delete from org_memberships where org_id = $1", [orgId]);
      await store.pool.query("delete from orgs where id = $1", [orgId]);
    }
    for (const userId of users) await store.pool.query("delete from users where id = $1", [userId]);
    await store.close();
  });

  it("lists the active admins of a space, and only them", async () => {
    const orgId = await organisation("admins");
    const anya = await admin(orgId, "anya");
    await admin(orgId, "gone", { active: false });
    expect(await store.orgAdminEmails(orgId)).toEqual([anya]);
  });

  it("reads plan events with their subscription across spaces", async () => {
    const orgId = await organisation("events");
    const subId = await subscription(orgId);
    await store.withTenant(orgId, () => store.pool.query(
      `insert into billing_events (org_id, type, subject_id, data) values
         ($1, 'subscription.change_scheduled', $2, '{"to":{"plan":"pro","fromPlan":"team"}}'),
         ($1, 'invoice.paid', $2, '{}')`,
      [orgId, subId],
    ));
    const events = (await store.billingLetterEvents({ since: new Date(NOW.getTime() - DAY) }))
      .filter((event) => event.orgId === orgId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "subscription.change_scheduled",
      data: { to: { plan: "pro" } },
      subscription: { id: subId, plan: "team", amount: 59000, interval: "month" },
    });
  });

  it("opens the trial, yearly renewal and card windows", async () => {
    const orgId = await organisation("reminders");
    const trial = await subscription(orgId, { status: "trialing", trialEnd: new Date(NOW.getTime() + 2 * DAY) });
    const other = await organisation("reminders-yearly");
    const yearly = await subscription(other, { interval: "year", end: new Date(NOW.getTime() + 6 * DAY) });
    await store.savePaymentMethod({
      orgId: other, connectionId: randomUUID(), ref: "pm_ref",
      display: { kind: "card", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 },
      consentVersion: "terms-2026-11", createdBy: null, kek: KEK,
    });
    const { trials, renewals, cards } = await store.billingReminders({ now: NOW });
    expect(trials.map((row) => row.id)).toContain(trial);
    expect(renewals.map((row) => row.id)).toContain(yearly);
    expect(renewals.map((row) => row.id)).not.toContain(trial);
    expect(cards.find((row) => row.org_id === other)).toMatchObject({ last4: "4242", exp_month: 12, exp_year: 2030 });
  });

  it("counts rooms and frozen rooms for the letter facts", async () => {
    const orgId = await organisation("facts");
    const facts = await store.billingLetterFacts(orgId);
    expect(facts).toMatchObject({ kind: "shared", rooms: 0, frozen: 0, last4: null });
    expect(facts.name).toMatch(/^Letters facts/);
  });
});
