/**
 * Entitlements: the one place that answers "what may this organisation do" (ADR-247,
 * `spec/billing.md` §2.2).
 *
 * No route compares plan names. A limit or feature is checked against the object this
 * module returns, so the catalogue is the only place a plan is described and this module
 * is the only place a plan is chosen.
 *
 * With `REMO_BILLING=off` — the default and the AGPL self-host case — nothing is
 * limited and no row is read: the product works exactly as before billing existed.
 */
import { ALL_PAID, PLANS } from "./billing-catalog.mjs";

const NO_LIMIT = Object.freeze({
  seats: null,
  rooms: null,
  agentTasksPerMonth: null,
  trashDays: null,
  storageBytes: null,
});

export function billingEnabled(env = process.env) {
  return env.REMO_BILLING === "on";
}

/**
 * The self-host answer. Built per call rather than shared, so a caller that mutates the
 * feature set (it should not) cannot poison the next request.
 */
function unlimited() {
  return {
    plan: "unlimited",
    status: "active",
    limits: { ...NO_LIMIT },
    features: new Set(ALL_PAID),
    reason: "plan",
  };
}

/**
 * The catalogue shape of an entitlement. Only the five limited fields are copied, so an
 * extra catalogue key (`trialDays`) never leaks into the API answer.
 */
function forPlan(planName, status, reason) {
  const plan = PLANS[planName];
  return {
    plan: planName,
    status,
    limits: {
      seats: plan.seats,
      rooms: plan.rooms,
      agentTasksPerMonth: plan.agentTasksPerMonth,
      trashDays: plan.trashDays,
      storageBytes: plan.storageBytes,
    },
    features: new Set(plan.features),
    reason,
  };
}

function free(reason = "plan", status = "active") {
  return forPlan("free", status, reason);
}

/** The summary and access checks derive rights from a live subscription in the same way. */
export function entitlementsFromSubscription(subscription) {
  if (!subscription) return free();

  // Suspension preserves the rooms and their data. A confirmed payment restores the paid rights.
  if (subscription.status === "suspended") return free("suspended", "suspended");
  const planName = Object.hasOwn(PLANS, subscription.plan) ? subscription.plan : "free";
  if (planName === "free") return free();

  const reason = subscription.status === "past_due" ? "past_due_grace" : "plan";
  return forPlan(planName, subscription.status, reason);
}

/** A committed subscription change is visible to the next access check on any sync process. */
export async function entitlementsFor(store, orgId, { env = process.env } = {}) {
  if (!billingEnabled(env)) return unlimited();

  const subscription = await store.withTenant(orgId, () => store.liveSubscription(orgId));
  return entitlementsFromSubscription(subscription);
}
