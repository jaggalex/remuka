/**
 * `entitlementsFor` without a database (ADR-247, `spec/billing.md` §2.2).
 */
import { describe, expect, it } from "vitest";
import { billingEnabled, entitlementsFor } from "./billing.mjs";
import { ALL_PAID, PLANS } from "./billing-catalog.mjs";

const ON = { REMO_BILLING: "on" };
const OFF = {};

/** A store double: `withTenant` runs the callback, the reads answer the fixture. */
function fakeStore({ org = { kind: "shared" }, subscription = null } = {}) {
  const reads = { org: 0, subscription: 0, tenant: 0 };
  return {
    reads,
    async withTenant(_orgId, fn) {
      reads.tenant += 1;
      return fn();
    },
    async billingOrg() {
      reads.org += 1;
      return org;
    },
    async liveSubscription() {
      reads.subscription += 1;
      return subscription;
    },
  };
}

function subscription(plan, status, overrides = {}) {
  return {
    id: "sub-1",
    org_id: "org",
    plan,
    price_id: `${plan}-rub-month-v1`,
    amount: 29000,
    currency: "RUB",
    interval: "month",
    status,
    current_period_start: new Date("2026-11-01T00:00:00Z"),
    current_period_end: new Date("2026-12-01T00:00:00Z"),
    ...overrides,
  };
}

const limitShape = (plan) => ({
  seats: plan.seats,
  rooms: plan.rooms,
  agentTasksPerMonth: plan.agentTasksPerMonth,
  trashDays: plan.trashDays,
  storageBytes: plan.storageBytes,
});

let counter = 0;
const nextOrg = () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, "0")}`;

describe("entitlements: self-host", () => {
  it("limits nothing while billing is off and reads no row", async () => {
    const store = fakeStore({ subscription: subscription("business", "active") });

    const entitlements = await entitlementsFor(store, nextOrg(), { env: OFF });

    expect(entitlements).toEqual({
      plan: "unlimited",
      status: "active",
      limits: {
        seats: null,
        rooms: null,
        agentTasksPerMonth: null,
        trashDays: null,
        storageBytes: null,
      },
      features: new Set(ALL_PAID),
      reason: "plan",
    });
    expect(store.reads).toEqual({ org: 0, subscription: 0, tenant: 0 });
  });

  it("reads the setting from the environment by default", () => {
    expect(billingEnabled({})).toBe(false);
    expect(billingEnabled({ REMO_BILLING: "off" })).toBe(false);
    expect(billingEnabled(ON)).toBe(true);
  });
});

describe("entitlements: plans", () => {
  it("falls back to Free when there is no live subscription", async () => {
    const store = fakeStore();

    const entitlements = await entitlementsFor(store, nextOrg(), { env: ON });

    expect(entitlements).toMatchObject({
      plan: "free",
      status: "active",
      reason: "plan",
      limits: limitShape(PLANS.free),
    });
    expect(entitlements.features).toEqual(new Set());
    expect(store.reads).toEqual({ org: 0, subscription: 1, tenant: 1 });
  });

  it.each(["pro", "team", "business"])("gives an active %s its catalogue", async (plan) => {
    const store = fakeStore({ subscription: subscription(plan, "active") });

    const entitlements = await entitlementsFor(store, nextOrg(), { env: ON });

    expect(entitlements).toEqual({
      plan,
      status: "active",
      limits: limitShape(PLANS[plan]),
      features: new Set(ALL_PAID),
      reason: "plan",
    });
  });

  it("keeps the trial on the plan it trials", async () => {
    const store = fakeStore({ subscription: subscription("team", "trialing") });

    const entitlements = await entitlementsFor(store, nextOrg(), { env: ON });

    expect(entitlements).toMatchObject({ plan: "team", status: "trialing", reason: "plan" });
  });

  it("keeps the plan during the grace period and says why", async () => {
    const store = fakeStore({ subscription: subscription("pro", "past_due") });

    const entitlements = await entitlementsFor(store, nextOrg(), { env: ON });

    expect(entitlements).toEqual({
      plan: "pro",
      status: "past_due",
      limits: limitShape(PLANS.pro),
      features: new Set(ALL_PAID),
      reason: "past_due_grace",
    });
  });

  it("drops a suspended organisation to Free limits and features", async () => {
    const store = fakeStore({ subscription: subscription("team", "suspended") });

    const entitlements = await entitlementsFor(store, nextOrg(), { env: ON });

    expect(entitlements).toEqual({
      plan: "free",
      status: "suspended",
      limits: limitShape(PLANS.free),
      features: new Set(),
      reason: "suspended",
    });
  });

  it("uses the subscription of a personal organisation", async () => {
    const store = fakeStore({
      org: { kind: "personal" },
      subscription: subscription("business", "active"),
    });

    const entitlements = await entitlementsFor(store, nextOrg(), { env: ON });

    expect(entitlements).toMatchObject({
      plan: "business",
      status: "active",
      reason: "plan",
      limits: limitShape(PLANS.business),
    });
    expect(store.reads).toEqual({ org: 0, subscription: 1, tenant: 1 });
  });

  it("answers Free for an unknown plan name instead of inventing one", async () => {
    const store = fakeStore({ subscription: subscription("enterprise", "active") });

    const entitlements = await entitlementsFor(store, nextOrg(), { env: ON });

    expect(entitlements).toMatchObject({ plan: "free", status: "active", reason: "plan" });
  });
});

it("reads the new paid subscription immediately after an earlier Free result", async () => {
  const store = fakeStore();
  const orgId = nextOrg();

  expect((await entitlementsFor(store, orgId, { env: ON })).plan).toBe("free");

  store.liveSubscription = async () => subscription("pro", "active");
  expect((await entitlementsFor(store, orgId, { env: ON })).plan).toBe("pro");
});
