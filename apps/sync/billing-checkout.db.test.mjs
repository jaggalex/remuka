/**
 * Checkout by invoice over HTTP (ADR-247 §4, stage 2).
 *
 * The test drives the real handler with a real tenant: an organisation, a manual
 * connection, a price for sale, then a checkout that must produce an open invoice and a
 * pending payment. Paying is the operator's act, so the last part of the flow is the
 * store calls `billing:mark-paid` makes.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleBilling } from "./billing-api.mjs";
import { settleInvoice } from "./billing-settle.mjs";
import { applyPaymentEvent } from "./billing-inbox.mjs";
import { createBillingLoops } from "./billing-renewals.mjs";
import { periodEnd } from "./billing-money.mjs";
import { entitlementsFor } from "./billing.mjs";
import { hashToken } from "./iam.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("billing checkout");
const store = database?.store ?? null;
const storeReachable = store !== null;
const suite = storeReachable ? describe : describe.skip;
let server = null;
let base = "";
let stageServer = null;
let stageBase = "";
const stamp = Date.now();
const PASSWORD_HASH = "scrypt$placeholder";
const BILLING_ENV = {
  REMO_BILLING: "on",
  REMO_BILLING_CURRENCIES: "TST,STG,BTH",
};

async function startServer(env) {
  const instance = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const orgId = /^\/orgs\/([^/]+)\//.exec(url.pathname)?.[1];
    const handled = orgId
      ? await store.withTenant(orgId, () =>
          handleBilling({ request, response, url, store, env }),
        )
      : await handleBilling({ request, response, url, store, env });
    if (handled) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not handled" }));
  });
  await new Promise((resolve) => instance.listen(0, resolve));
  return { instance, base: `http://127.0.0.1:${instance.address().port}` };
}

beforeAll(async () => {
  if (!storeReachable) return;
  ({ instance: server, base } = await startServer(BILLING_ENV));
  // The same behaviour with the stand flag on: one installation, two envs, one database.
  ({ instance: stageServer, base: stageBase } = await startServer({
    ...BILLING_ENV,
    REMO_STAGE: "1",
  }));
});

afterAll(async () => {
  if (stageServer) await new Promise((resolve) => stageServer.close(resolve));
  if (server) await new Promise((resolve) => server.close(resolve));
  if (store) await store.close();
});

async function organisation(tag, kind = "shared") {
  const user = await store.createUser({
    email: `checkout-${tag}-${stamp}@example.test`,
    passwordHash: PASSWORD_HASH,
    name: tag,
    handle: `checkout-${tag}-${stamp}`,
  });
  const { org } = await store.createOrgWithOwner({
    name: `Checkout ${tag}`,
    slug: `checkout-${tag}-${stamp}`,
    userId: user.id,
    kind,
  });
  const token = `test-session-${tag}-${stamp}-${Math.random()}`;
  await store.createSession({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return { user, org, cookie: `remo_session=${token}` };
}

async function manualConnection(userId, { mode = "live", currency = "TST", groups = ["invoice"] } = {}) {
  const connection = await store.createConnection({
    provider: "manual",
    name: `Bank invoice ${mode} ${currency}`,
    mode,
    currencies: [currency],
    methodGroups: groups,
    priority: 10,
    settings: { instructions: "Pay to account 40702810… and quote the invoice number" },
    sealed: null,
    webhookToken: `tok-${Math.random().toString(36).slice(2)}`,
    createdBy: userId,
  });
  await store.setConnectionStatus(connection.id, {
    from: "draft",
    to: "ready",
    reason: "test",
    actorId: userId,
  });
  await store.setConnectionStatus(connection.id, {
    from: "ready",
    to: "active",
    reason: "test",
    actorId: userId,
  });
  return connection;
}

async function call(path, { method = "GET", cookie, body, from = base } = {}) {
  const response = await fetch(`${from}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** A complete price book (every paid plan and interval), which the catalogue demands. */
async function priceBook(currency, userId) {
  const ids = {};
  const plans = { pro: 29_000, team: 59_000, business: 119_000 };
  for (const [plan, amount] of Object.entries(plans)) {
    for (const interval of ["month", "year"]) {
      const id = `${plan}-${currency.toLowerCase()}-${interval}-${stamp}`;
      await store.addPrice({ id, plan, interval, currency, amount, createdBy: userId });
      await store.publishPrice(id);
      ids[`${plan}/${interval}`] = id;
    }
  }
  return ids;
}

function checkoutBody(priceId) {
  return {
    priceId,
    methodGroup: "invoice",
    consent: { autopay: false, termsVersion: "terms-2026-11" },
    billingEmail: `billing-${stamp}@example.test`,
  };
}

async function paidConnection(paymentId) {
  const { rows } = await store.pool.query("select connection_id from payments where id = $1", [
    paymentId,
  ]);
  return rows[0]?.connection_id ?? null;
}

suite("checkout by invoice (ADR-247 stage 2)", () => {
  it("turns a price into an open invoice and a pending payment", async () => {
    const { user, org, cookie } = await organisation("pay");
    await manualConnection(user.id);
    const priceId = `pro-tst-month-${stamp}`;
    await store.addPrice({
      id: priceId,
      plan: "pro",
      interval: "month",
      currency: "TST",
      amount: 29000,
      createdBy: user.id,
    });
    await store.publishPrice(priceId);

    const checkout = await call(`/orgs/${org.id}/billing/checkout`, {
      method: "POST",
      cookie,
      body: {
        priceId,
        methodGroup: "invoice",
        consent: { autopay: false, termsVersion: "terms-2026-11" },
        billingEmail: `billing-${stamp}@example.test`,
      },
    });
    expect(checkout.status).toBe(201);
    expect(checkout.body.amount).toBe(29000);
    expect(checkout.body.widget.kind).toBe("instructions");

    const invoices = await call(`/orgs/${org.id}/billing/invoices`, { cookie });
    expect(invoices.body.invoices).toHaveLength(1);
    expect(invoices.body.invoices[0].status).toBe("open");

    const status = await call(`/orgs/${org.id}/billing/checkout/${checkout.body.paymentId}`, {
      cookie,
    });
    expect(status.body.status).toBe("pending");

    // The operator's side: pay the invoice and grant the plan it sells.
    const invoice = await store.billingInvoiceGlobal(checkout.body.invoiceId);
    await store.markInvoicePaid({
      invoiceId: invoice.id,
      amount: Number(invoice.total),
      currency: invoice.currency,
      providerPaymentId: `manual:${invoice.id}`,
    });
    await store.withTenant(org.id, async () => {
      await store.upsertOperatorPlan({
        orgId: org.id,
        plan: "pro",
        priceId,
        amount: Number(invoice.subtotal),
        currency: invoice.currency,
        interval: "month",
        until: invoice.period_end,
      });
    });

    const rights = await entitlementsFor(store, org.id, { env: { REMO_BILLING: "on" } });
    expect(rights.plan).toBe("pro");
    const paid = await call(`/orgs/${org.id}/billing/invoices`, { cookie });
    expect(paid.body.invoices[0].status).toBe("paid");
  });

  it("activates a paid personal plan and keeps financial details private", async () => {
    const personal = await organisation("personal", "personal");
    const connection = await manualConnection(personal.user.id);
    const priceId = `pro-tst-month-personal-${stamp}`;
    await store.addPrice({
      id: priceId,
      plan: "pro",
      interval: "month",
      currency: "TST",
      amount: 29000,
    });
    await store.publishPrice(priceId);

    const noConsent = await call(`/orgs/${personal.org.id}/billing/checkout`, {
      method: "POST",
      cookie: personal.cookie,
      body: { priceId, methodGroup: "invoice", consent: { autopay: true } },
    });
    expect(noConsent.status).toBe(422);
    expect(noConsent.body.error).toBe("CONSENT_REQUIRED");

    const personalOrg = await call(`/orgs/${personal.org.id}/billing/checkout`, {
      method: "POST",
      cookie: personal.cookie,
      body: {
        priceId,
        methodGroup: "invoice",
        consent: { autopay: false, termsVersion: "terms-2026-11" },
      },
    });
    expect(personalOrg.status).toBe(201);

    const basePath = `/orgs/${personal.org.id}/billing`;
    const before = await call(basePath, { cookie: personal.cookie });
    expect(before.body).toMatchObject({ plan: "free", limits: { rooms: 5 }, subscription: null });

    const invoice = await store.billingInvoiceGlobal(personalOrg.body.invoiceId);
    await settleInvoice({ store, invoice, connectionId: connection.id, paymentId: personalOrg.body.paymentId });

    const after = await call(basePath, { cookie: personal.cookie });
    expect(after.body).toMatchObject({
      plan: "pro",
      limits: { rooms: null },
      subscription: { plan: "pro", status: "active", amount: 29_000 },
    });
    expect((await entitlementsFor(store, personal.org.id, { env: BILLING_ENV })).plan).toBe("pro");
    expect((await call(`${basePath}/invoices`, { cookie: personal.cookie })).body.invoices[0].status).toBe("paid");

    const member = await organisation("personal-member");
    await store.withTenant(personal.org.id, () => store.pool.query(
      "insert into org_memberships (org_id, user_id, relation, state) values ($1, $2, 'member', 'active')",
      [personal.org.id, member.user.id],
    ));
    const overview = await call(basePath, { cookie: member.cookie });
    expect(overview.body).toMatchObject({ plan: "pro", limits: { rooms: null }, subscription: null });
    expect((await call(`${basePath}/invoices`, { cookie: member.cookie })).status).toBe(403);
    expect((await call(`${basePath}/checkout/${personalOrg.body.paymentId}`, { cookie: member.cookie })).status).toBe(403);
  });

  it("keeps the paying organisation shared when the schema is reapplied", async () => {
    const { org } = await organisation("paid-after-schema");
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 86_400_000);
    const { invoice } = await store.withTenant(org.id, async () => {
      await store.upsertBillingAccount({ orgId: org.id, email: `billing-${stamp}@example.test`, currency: "RUB" });
      return store.createInvoice({
        orgId: org.id,
        currency: "RUB",
        lines: [{ kind: "subscription", plan: "pro", interval: "month", priceId: "migration-pro", amount: 29_000 }],
        subtotal: 29_000,
        total: 29_000,
        periodStart: now,
        periodEnd: end,
      });
    });
    await settleInvoice({ store, invoice });
    expect((await entitlementsFor(store, org.id, { env: BILLING_ENV })).plan).toBe("pro");

    const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
    await store.withTenant(org.id, async () => {
      const client = await store.pool.connect();
      try {
        await client.query("begin");
        await client.query(schema);
        expect((await store.billingInvoiceGlobal(invoice.id)).status).toBe("paid");
        expect(await store.liveSubscription(org.id)).toMatchObject({ plan: "pro", status: "active" });
        expect((await entitlementsFor(store, org.id, { env: BILLING_ENV })).plan).toBe("pro");
        expect((await store.billingOrg(org.id)).kind).toBe("shared");
      } finally {
        await client.query("rollback");
        client.release();
      }
    });
  });

  it("answers 404 for every billing route when billing is off", async () => {
    const { org } = await organisation("off");
    let status = 0;
    const handled = await store.withTenant(org.id, () =>
      handleBilling({
        request: { method: "GET", headers: {} },
        response: {
          writeHead(code) {
            status = code;
          },
          end() {},
        },
        url: new URL(`http://localhost/orgs/${org.id}/billing`),
        store,
        env: { REMO_BILLING: "off" },
      }),
    );
    expect(handled).toBe(true);
    expect(status).toBe(404);
  });

  it.each(["personal", "shared"])("changes a paid %s plan through checkout and renewal", async kind => {
    const { user, org, cookie } = await organisation(`change-${kind}`, kind);
    const currency = kind === "personal" ? "PCH" : "SCH";
    const connection = await manualConnection(user.id, { currency });
    const prices = await priceBook(currency, user.id);
    const basePath = `/orgs/${org.id}/billing`;
    const change = (body, method = "POST") => call(`${basePath}/change`, { method, cookie, body });
    const overview = () => call(basePath, { cookie });
    const fiveMinutes = 300_000;
    const middle = Math.floor(Date.now() / fiveMinutes) * fiveMinutes;
    const halfPeriod = 15 * 86_400_000;
    const start = new Date(middle - halfPeriod);
    const end = new Date(middle + halfPeriod);
    const { invoice: first } = await store.withTenant(org.id, async () => {
      await store.upsertBillingAccount({ orgId: org.id, email: user.email, currency });
      return store.createInvoice({
        orgId: org.id, currency, subtotal: 29_000, total: 29_000, periodStart: start, periodEnd: end,
        lines: [{ kind: "subscription", plan: "pro", priceId: prices["pro/month"], interval: "month", amount: 29_000 }],
      });
    });
    await settleInvoice({ store, invoice: first });
    await store.withTenant(org.id, () => store.pool.query(
      "update subscriptions set current_period_start = $2 where org_id = $1", [org.id, start],
    ));
    const actor = { log() {}, warn() {}, error() {} };
    const confirm = (paymentId, amount, status = "succeeded") =>
      applyPaymentEvent({
        store, connectionId: connection.id, log: actor,
        event: { type: "payment.updated", paymentId, payment: { status, amount, currency } },
      });
    const upgrade = await change({ priceId: prices["team/month"], preview: true });
    expect(upgrade.status).toBe(200);
    expect(upgrade.body).toMatchObject({ type: "upgrade", credit: 14_500, total: 44_500, amount: 59_000 });
    expect((await change({ ...checkoutBody(prices["team/month"]), key: "obsolete" })).body.error).toBe("QUOTE_EXPIRED");
    const payload = { ...checkoutBody(prices["team/month"]), key: upgrade.body.key };
    const [a, b] = await Promise.all([change(payload), change(payload)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const firstAttempt = a.status === 201 ? a : b;
    expect((await overview()).body).toMatchObject({ plan: "pro", pendingPlanPayment: { paymentId: firstAttempt.body.paymentId } });
    await confirm(firstAttempt.body.paymentId, 44_500, "canceled");
    expect((await overview()).body).toMatchObject({ plan: "pro", pendingPlanPayment: null });

    const approved = await change(payload);
    expect(approved.status).toBe(201);
    await expect(confirm(approved.body.paymentId, 44_499)).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect((await overview()).body.plan).toBe("pro");
    await confirm(approved.body.paymentId, 44_500);
    const repeated = await confirm(approved.body.paymentId, 44_500);
    expect(repeated.reason).toBe("ALREADY_APPLIED");
    const paid = await store.withTenant(org.id, () => store.invoiceById(org.id, approved.body.invoiceId));
    const paidSummary = (await overview()).body;
    expect(paidSummary).toMatchObject({
      plan: "team", limits: { seats: 20 }, pendingPlanPayment: null,
      subscription: { plan: "team", amount: 59_000, currentPeriodStart: paid.paid_at.toISOString() },
    });
    expect(paidSummary.subscription.currentPeriodEnd).toBe(periodEnd(paid.paid_at, "month").toISOString());

    const planDowngrade = async () => {
      const preview = await change({ priceId: prices["pro/month"], preview: true });
      expect(preview.body).toMatchObject({ type: "downgrade", total: 0, amount: 29_000 });
      expect((await change({ priceId: prices["pro/month"], key: preview.body.key })).status).toBe(200);
    };
    await planDowngrade();
    expect((await overview()).body).toMatchObject({
      plan: "team", scheduledChange: { plan: "pro", at: paidSummary.subscription.currentPeriodEnd },
    });
    expect((await call(`${basePath}/invoices`, { cookie })).body.invoices).toHaveLength(3);
    expect((await change(undefined, "DELETE")).status).toBe(200);
    expect((await overview()).body.scheduledChange).toBeNull();
    await planDowngrade();

    const makeDue = async () => {
      const boundary = new Date(Date.now() - 1000);
      await store.withTenant(org.id, () => store.pool.query(
        "update subscriptions set current_period_start = $2, current_period_end = $3 where org_id = $1",
        [org.id, new Date(+boundary - halfPeriod), boundary],
      ));
      return boundary;
    };
    const boundary = await makeDue();
    const renewal = createBillingLoops({
      store, log: actor, charge: async () => ({ status: "failed", failureCode: "manual_payment_required" }),
    });
    await renewal.tick();
    const overdue = (await overview()).body;
    expect(overdue).toMatchObject({ plan: "team", status: "past_due", changeInvoice: { amount: 29_000 } });
    const payment = await change({ ...checkoutBody(prices["pro/month"]), invoiceId: overdue.changeInvoice.id });
    expect(payment.status).toBe(201);
    await confirm(payment.body.paymentId, 29_000);
    expect((await overview()).body).toMatchObject({
      plan: "pro", limits: { seats: 5 }, scheduledChange: null,
      subscription: { plan: "pro", amount: 29_000, currentPeriodStart: boundary.toISOString() },
    });

    const free = await change({ priceId: "free", preview: true });
    expect((await change({ priceId: "free", key: free.body.key })).status).toBe(200);
    expect((await overview()).body.plan).toBe("pro");
    await makeDue();
    await renewal.tick();
    expect((await overview()).body).toMatchObject({ plan: "free", limits: { rooms: 5 }, subscription: null });
  });

  /* ------------------------------------------------- stand showcase (ADR-280) -- */

  it("sells a test-only currency on a stand and hides it in production", async () => {
    const { user, org, cookie } = await organisation("stand");
    const test = await manualConnection(user.id, { mode: "test", currency: "STG" });
    const prices = await priceBook("STG", user.id);

    const production = await call("/billing/catalog?currency=STG");
    expect(production.status).toBe(200);
    expect(production.body.currencies).toEqual([]);

    const stand = await call("/billing/catalog?currency=STG", { from: stageBase });
    expect(stand.status).toBe(200);
    expect(stand.body.currencies.map((entry) => entry.currency)).toEqual(["STG"]);
    expect(stand.body.currencies[0].methodGroups).toEqual(["invoice"]);

    const body = checkoutBody(prices["pro/month"]);
    const refused = await call(`/orgs/${org.id}/billing/checkout`, { method: "POST", cookie, body });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("NO_PAYMENT_ROUTE");

    const paid = await call(`/orgs/${org.id}/billing/checkout`, {
      method: "POST",
      cookie,
      body,
      from: stageBase,
    });
    expect(paid.status).toBe(201);
    expect(paid.body.widget.kind).toBe("instructions");
    expect(await paidConnection(paid.body.paymentId)).toBe(test.id);
  });

  it("prefers live in production and test on a stand when both are active", async () => {
    const { user, org, cookie } = await organisation("both");
    const live = await manualConnection(user.id, { mode: "live", currency: "BTH" });
    const test = await manualConnection(user.id, { mode: "test", currency: "BTH" });
    const prices = await priceBook("BTH", user.id);
    const body = checkoutBody(prices["pro/month"]);

    const productionCatalog = await call("/billing/catalog?currency=BTH");
    expect(productionCatalog.body.currencies[0].methodGroups).toEqual(["invoice"]);

    const production = await call(`/orgs/${org.id}/billing/checkout`, {
      method: "POST",
      cookie,
      body,
    });
    expect(production.status).toBe(201);
    expect(await paidConnection(production.body.paymentId)).toBe(live.id);

    const stand = await call(`/orgs/${org.id}/billing/checkout`, {
      method: "POST",
      cookie,
      body,
      from: stageBase,
    });
    expect(stand.status).toBe(201);
    expect(await paidConnection(stand.body.paymentId)).toBe(test.id);
  });
});
