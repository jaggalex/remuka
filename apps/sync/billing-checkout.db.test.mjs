/**
 * Checkout by invoice over HTTP (ADR-247 §4, stage 2).
 *
 * The test drives the real handler with a real tenant: an organisation, a manual
 * connection, a price for sale, then a checkout that must produce an open invoice and a
 * pending payment. Paying is the operator's act, so the last part of the flow is the
 * store calls `billing:mark-paid` makes.
 */
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleBilling } from "./billing-api.mjs";
import { entitlementsFor, resetEntitlementCache } from "./billing.mjs";
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

async function organisation(tag) {
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
    kind: "shared",
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

    resetEntitlementCache();
    const rights = await entitlementsFor(store, org.id, { env: { REMO_BILLING: "on" } });
    expect(rights.plan).toBe("pro");
    const paid = await call(`/orgs/${org.id}/billing/invoices`, { cookie });
    expect(paid.body.invoices[0].status).toBe("paid");
  });

  it("refuses checkout without consent and for a personal organisation", async () => {
    const personal = await organisation("personal");
    await store.withTenant(personal.org.id, async () => {
      await store.pool.query("update orgs set kind = 'personal' where id = $1", [
        personal.org.id,
      ]);
    });
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
    expect(personalOrg.status).toBe(409);
    expect(personalOrg.body.error).toBe("PERSONAL_ORG");
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
