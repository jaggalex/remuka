/**
 * The whole path from a provider notification to money (ADR-248,
 * `spec/payment-providers.md` §5, §5.1; `spec/billing.md` §4).
 *
 * A signed fake-provider delivery is written to the inbox by the real route and applied by
 * the real drain. What the test pins:
 *   - a succeeded payment pays the invoice, opens the period, writes one `invoice.paid`
 *     row and queues one letter;
 *   - a repeated delivery changes nothing (the same key is one row);
 *   - a cancellation after a success does not un-pay anything;
 *   - eight failed applications bury the row with `dead_at`;
 *   - the hourly reconciliation settles a payment whose webhook never came, once.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBillingInbox } from "./billing-inbox.mjs";
import { createBillingNotify } from "./billing-notify.mjs";
import { handlePaymentWebhook } from "./payment-webhooks.mjs";
import { completeFakePayment, fakeAdapter } from "./pay-fake.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("billing inbox");
const store = opened?.store ?? null;

const KEK = { key: randomBytes(32), id: "test-kek" };
const HOOK_SECRET = "fake-webhook-secret";
const HOOK_TOKEN = "inbox-hook-token";
const MAIL = { driver: "smtp", appOrigin: "https://example.test" };
const silent = { error() {}, warn() {}, log() {} };

const createdOrgs = [];
const createdConnections = [];

/** The fake adapter exists only with this flag and outside production (`pay-fake.mjs`). */
const previousFakeFlag = process.env.REMO_PAY_FAKE;

async function organisation(tag) {
  const id = randomUUID();
  await store.pool.query("insert into orgs (id, name, slug) values ($1, $2, $3)", [
    id,
    `Inbox ${tag}`,
    `inbox-${tag}-${id}`,
  ]);
  createdOrgs.push(id);
  return id;
}

async function fakeConnection(orgId) {
  const token = `${HOOK_TOKEN}-${orgId}`;
  const connection = await store.createConnection({
    provider: "fake",
    name: `Fake ${orgId.slice(0, 8)}`,
    mode: "test",
    currencies: ["TST"],
    methodGroups: ["ru_card"],
    settings: { webhookSecret: HOOK_SECRET },
    webhookToken: token,
    createdBy: null,
  });
  await store.setConnectionStatus(connection.id, {
    from: "draft",
    to: "active",
    reason: "test",
    actorId: null,
  });
  createdConnections.push(connection.id);
  return { ...connection, webhookToken: token };
}

/**
 * An open invoice with a pending payment, exactly as checkout leaves it: one attempt row,
 * the provider id attached, a billing address for the letter.
 */
async function checkout(tag, { autopay = true } = {}) {
  const orgId = await organisation(tag);
  const connection = await fakeConnection(orgId);
  const email = `inbox-${tag}-${randomUUID()}@example.test`;
  const priceId = `inbox-${tag}-${randomUUID()}`;
  const periodStart = new Date();
  const periodEnd = new Date(Date.now() + 30 * 86_400_000);

  await store.addPrice({
    id: priceId,
    plan: "pro",
    interval: "month",
    currency: "TST",
    amount: 29000,
  });
  await store.publishPrice(priceId);

  let invoice;
  let payment;
  await store.withTenant(orgId, async () => {
    await store.upsertBillingAccount({ orgId, email, currency: "TST" });
    ({ invoice } = await store.createInvoice({
      orgId,
      currency: "TST",
      lines: [
        {
          kind: "subscription",
          plan: "pro",
          interval: "month",
          priceId,
          amount: 29000,
          ...(autopay
            ? { autopayConsent: { version: "terms-2026-11", at: periodStart.toISOString() } }
            : {}),
        },
      ],
      subtotal: 29000,
      discount: 0,
      creditApplied: 0,
      total: 29000,
      periodStart,
      periodEnd,
    }));
    payment = await store.recordPayment({
      orgId,
      invoiceId: invoice.id,
      connectionId: connection.id,
      providerPaymentId: null,
      idempotencyKey: `checkout:${invoice.id}`,
      amount: 29000,
      currency: "TST",
      status: "pending",
    });
    await store.attachProviderPaymentId(payment.id, `fake:${payment.id}`);
  });
  return { orgId, connection, invoice, payment, email, priceId, periodEnd };
}

function envelope(overrides = {}) {
  return JSON.stringify({
    paymentId: overrides.paymentId,
    status: overrides.status ?? "succeeded",
    amount: 29000,
    currency: "TST",
  });
}

function signedRequest(body, headers = {}) {
  const bytes = Buffer.from(body, "utf8");
  const signature = createHmac("sha256", HOOK_SECRET).update(bytes).digest("hex");
  return {
    method: "POST",
    headers: { "x-remo-fake-signature": signature, ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
    resume() {},
  };
}

function fakeResponse() {
  const out = { status: 0, body: null };
  return {
    out,
    writeHead(status) {
      out.status = status;
    },
    end(payload) {
      out.body = payload ?? "";
    },
  };
}

async function deliver(connection, paymentId, status = "succeeded") {
  const body = envelope({ paymentId, status });
  const response = fakeResponse();
  await handlePaymentWebhook({
    request: signedRequest(body),
    response,
    store,
    connectionId: connection.id,
    token: connection.webhookToken,
    env: process.env,
    log: silent,
  });
  return response.out;
}

function inbox() {
  return createBillingInbox({
    store,
    notify: createBillingNotify({ store, mailConfig: MAIL, kek: KEK }),
    kek: KEK,
    log: silent,
  });
}

async function invoiceOf(invoiceId) {
  return store.billingInvoiceGlobal(invoiceId);
}

async function paymentRows(invoiceId) {
  const { rows } = await store.pool.query(
    "select * from payments where invoice_id = $1 order by created_at",
    [invoiceId],
  );
  return rows;
}

async function billingEventRows(orgId, type) {
  return store.withTenant(orgId, async () => {
    const { rows } = await store.pool.query(
      "select * from billing_events where org_id = $1 and type = $2 order by occurred_at",
      [orgId, type],
    );
    return rows;
  });
}

async function mailRows(email) {
  const { rows } = await store.pool.query(
    "select * from mail_outbox where to_email = $1 and template = 'payment_succeeded'",
    [email],
  );
  return rows;
}

async function eventRows(connectionId) {
  const { rows } = await store.pool.query(
    "select * from billing_provider_events where connection_id = $1 order by received_at",
    [connectionId],
  );
  return rows;
}

describe.skipIf(!store)("db:billing inbox (ADR-248 §5)", () => {
  beforeAll(() => {
    process.env.REMO_PAY_FAKE = "1";
  });

  afterAll(async () => {
    if (!store) return;
    for (const connectionId of createdConnections) {
      await store.pool.query("delete from billing_provider_events where connection_id = $1", [
        connectionId,
      ]);
      await store.pool.query("delete from payment_connection_events where connection_id = $1", [
        connectionId,
      ]);
      await store.pool.query("delete from payment_connections where id = $1", [connectionId]);
    }
    for (const orgId of createdOrgs) {
      await store.withTenant(orgId, async () => {
        for (const table of [
          "refunds",
          "payments",
          "org_credit_ledger",
          "invoices",
          "billing_events",
          "subscriptions",
          "payment_methods",
          "billing_accounts",
        ]) {
          await store.pool.query(`delete from ${table} where org_id = $1`, [orgId]);
        }
      });
      await store.pool.query("delete from mail_outbox where to_email like 'inbox-%'");
      await store.pool.query("delete from orgs where id = $1", [orgId]);
    }
    if (previousFakeFlag === undefined) delete process.env.REMO_PAY_FAKE;
    else process.env.REMO_PAY_FAKE = previousFakeFlag;
    await store.close();
  });

  it("settles a succeeded delivery exactly once", async () => {
    const fixture = await checkout("success");
    const out = await deliver(fixture.connection, fixture.payment.id);
    expect(out.status).toBe(200);

    const before = await eventRows(fixture.connection.id);
    expect(before).toHaveLength(1);
    expect(before[0].processed_at).toBeNull();

    const drain = inbox();
    expect(await drain.drain()).toBe(1);

    const invoice = await invoiceOf(fixture.invoice.id);
    expect(invoice.status).toBe("paid");

    const subscription = await store.withTenant(fixture.orgId, () =>
      store.liveSubscription(fixture.orgId),
    );
    expect(subscription).toMatchObject({ plan: "pro", status: "active" });

    expect(await billingEventRows(fixture.orgId, "invoice.paid")).toHaveLength(1);

    const payments = await paymentRows(fixture.invoice.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      id: fixture.payment.id,
      status: "succeeded",
      provider_payment_id: `fake:${fixture.payment.id}`,
    });

    const mail = await mailRows(fixture.email);
    expect(mail).toHaveLength(1);

    const [event] = await eventRows(fixture.connection.id);
    expect(event).toMatchObject({
      org_id: fixture.orgId,
      attempts: 0,
      last_error: null,
    });
    expect(event.processed_at).not.toBeNull();

    // The same delivery again: the unique key keeps one row, and the drain leaves money,
    // ledger and mailbox untouched.
    await deliver(fixture.connection, fixture.payment.id);
    expect(await eventRows(fixture.connection.id)).toHaveLength(1);
    await drain.drain();
    expect((await invoiceOf(fixture.invoice.id)).status).toBe("paid");
    expect(await billingEventRows(fixture.orgId, "invoice.paid")).toHaveLength(1);
    expect(await mailRows(fixture.email)).toHaveLength(1);
    expect(await paymentRows(fixture.invoice.id)).toHaveLength(1);
  });

  it("does not un-pay an invoice when a cancellation arrives after a success", async () => {
    const fixture = await checkout("stale-cancel");
    await deliver(fixture.connection, fixture.payment.id, "succeeded");
    const drain = inbox();
    await drain.drain();

    await deliver(fixture.connection, fixture.payment.id, "canceled");
    await drain.drain();

    const invoice = await invoiceOf(fixture.invoice.id);
    expect(invoice.status).toBe("paid");
    const payments = await paymentRows(fixture.invoice.id);
    expect(payments[0].status).toBe("succeeded");
    expect(await billingEventRows(fixture.orgId, "invoice.paid")).toHaveLength(1);

    const events = await eventRows(fixture.connection.id);
    const canceled = events.find((row) => row.provider_event_key.endsWith(":canceled"));
    expect(canceled).toMatchObject({ last_error: "STALE", org_id: fixture.orgId });
    expect(canceled.processed_at).not.toBeNull();
  });

  it("cancels a pending payment and leaves the invoice open", async () => {
    const fixture = await checkout("cancel");
    await deliver(fixture.connection, fixture.payment.id, "canceled");
    await inbox().drain();

    const payments = await paymentRows(fixture.invoice.id);
    expect(payments[0].status).toBe("canceled");
    expect((await invoiceOf(fixture.invoice.id)).status).toBe("open");
    expect(await billingEventRows(fixture.orgId, "invoice.paid")).toHaveLength(0);
    expect(await mailRows(fixture.email)).toHaveLength(0);
  });

  it("buries an event after eight failed attempts", async () => {
    const fixture = await checkout("dead");
    // A payment id that exists nowhere in the ledger: no chain can be resolved.
    await store.recordProviderEvent({
      connectionId: fixture.connection.id,
      providerEventKey: `dead:${randomUUID()}`,
      type: "payment.updated",
      payload: {
        type: "payment.updated",
        paymentId: randomUUID(),
        payment: { providerPaymentId: "nowhere", status: "succeeded", amount: 1, currency: "TST" },
      },
    });

    let clock = Date.now();
    const drain = createBillingInbox({ store, log: silent, now: () => clock });
    for (let pass = 0; pass < 8; pass += 1) {
      await drain.drain();
      clock += 60 * 60 * 1000;
    }

    const events = await eventRows(fixture.connection.id);
    const buried = events.find((row) => row.provider_event_key.startsWith("dead:"));
    expect(buried.dead_at).not.toBeNull();
    expect(buried.attempts).toBe(8);
    expect(buried.last_error).toBe("PAYMENT_NOT_FOUND");
    expect(buried.processed_at).toBeNull();
  });

  it("settles a pending payment from the reconciliation, once", async () => {
    const fixture = await checkout("reconcile", { autopay: false });
    const providerPaymentId = `fake:${fixture.payment.id}`;
    await fakeAdapter.createCheckout(
      { id: fixture.connection.id, settings: {} },
      {
        paymentId: fixture.payment.id,
        amount: 29000,
        currency: "TST",
        savePaymentMethod: false,
      },
    );
    completeFakePayment(providerPaymentId, "success");

    // Older than fifteen minutes, so the hourly pass considers it due.
    await store.withTenant(fixture.orgId, () =>
      store.pool.query(
        "update payments set created_at = now() - interval '20 minutes', provider_payment_id = $2 where id = $1",
        [fixture.payment.id, providerPaymentId],
      ),
    );

    const drain = inbox();
    const first = await drain.reconcile();
    expect(first.checked).toBe(1);

    expect((await invoiceOf(fixture.invoice.id)).status).toBe("paid");
    expect(await billingEventRows(fixture.orgId, "invoice.paid")).toHaveLength(1);
    expect(await mailRows(fixture.email)).toHaveLength(1);
    expect(await paymentRows(fixture.invoice.id)).toHaveLength(1);

    // The same answer next hour: the payment is no longer pending, so nothing is recorded
    // again and no second payment or letter appears.
    const second = await drain.reconcile();
    expect(second.checked).toBe(0);
    expect(await billingEventRows(fixture.orgId, "invoice.paid")).toHaveLength(1);
    expect(await mailRows(fixture.email)).toHaveLength(1);
  });
});
