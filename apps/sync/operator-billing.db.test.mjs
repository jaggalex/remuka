import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { totpCode, totpStep } from "./mfa.mjs";
import {
  parseCreditArgs,
  parseRefundArgs,
  runBillingCredit,
  runBillingRefund,
} from "./operator-billing.mjs";
import { encryptSecret } from "./secrets.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("operator-billing");
const store = opened?.store ?? null;

const orgId = randomUUID();
const userId = randomUUID();
const subscriptionId = randomUUID();
const invoiceId = randomUUID();
const paymentId = randomUUID();
const connectionId = randomUUID();

const KEK = { key: Buffer.alloc(32, 11), id: "v1" };
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const env = { DATABASE_URL: "unused", REMO_KEK: KEK.key.toString("base64") };

const mailConfig = {
  driver: "console",
  from: "Remuka <no-reply@example.test>",
  replyTo: null,
  productName: null,
  consoleFile: null,
  resendApiKey: "",
  smtpUrl: "",
  appOrigin: "https://app.example.test",
  batch: 10,
  requireVerifiedForInvites: true,
  isProduction: false,
};

function capture() {
  const lines = [];
  return { lines, out: (line) => lines.push(String(line)), err: (line) => lines.push(String(line)) };
}

/** A fresh code for every command: the database accepts each step once (§1 rule 4). */
async function code() {
  await store.pool.query("update user_mfa set last_step = null where user_id = $1", [userId]);
  return totpCode(SECRET, totpStep());
}

async function seed() {
  await store.pool.query(
    `insert into users (id, email, password_hash, name, handle, lang, email_verified_at)
     values ($1, $2, 'x', 'Payer', $3, 'en', now())`,
    [userId, `payer-${userId}@example.test`, `payer-${userId.slice(0, 8)}`],
  );
  await store.pool.query("insert into orgs (id, name, slug) values ($1, 'Payer org', $2)", [
    orgId,
    `payer-org-${orgId}`,
  ]);
  await store.pool.query(
    "insert into admin_roles (org_id, user_id, role) values ($1, $2, 'org_admin')",
    [orgId, userId],
  );
  await store.pool.query(
    `insert into org_memberships (org_id, user_id, relation, state)
     values ($1, $2, 'member', 'active')`,
    [orgId, userId],
  );
  await store.pool.query(
    `insert into billing_accounts (org_id, billing_email, billing_name, currency)
     values ($1, $2, 'Payer', 'RUB')`,
    [orgId, `billing-${orgId}@example.test`],
  );
  await store.pool.query(
    `insert into subscriptions
       (id, org_id, plan, price_id, amount, currency, interval, status,
        current_period_start, current_period_end)
     values ($1, $2, 'pro', 'pro-rub-month-v1', 29000, 'RUB', 'month', 'active',
             now() - interval '1 day', now() + interval '20 days')`,
    [subscriptionId, orgId],
  );
  await store.pool.query(
    `insert into invoices
       (id, org_id, subscription_id, number, status, currency, subtotal, discount,
        credit_applied, total, lines, period_start, period_end, paid_at)
     values ($1, $2, $3, $4, 'paid', 'RUB', 29000, 0, 0, 29000, '[]'::jsonb,
             now() - interval '1 day', now() + interval '29 days', now() - interval '1 day')`,
    [invoiceId, orgId, subscriptionId, `RU-TEST-${orgId.slice(0, 8)}`],
  );
  // The payer also holds the operator role in this fixture: every money command names
  // its author and the role is checked (ADR-259 amendment). The second factor is proved
  // by a code, as it is for a real operator (ADR-262 §5).
  await store.pool.query("insert into instance_operators (user_id) values ($1)", [userId]);
  const sealed = encryptSecret(SECRET, {
    scope: "mfa",
    scopeId: userId,
    provider: "totp",
    id: userId,
    kek: KEK,
  });
  await store.pool.query(
    `insert into user_mfa
       (user_id, secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce,
        kek_id, confirmed_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [userId, sealed.ciphertext, sealed.nonce, sealed.dekWrapped, sealed.dekNonce, sealed.kekId],
  );
  await store.pool.query(
    `insert into payment_connections
       (id, provider, name, mode, status, currencies, method_groups, webhook_token)
     values ($1, 'manual', 'Test', 'test', 'draft', '{RUB}', '{invoice}', $2)`,
    [connectionId, `webhook-${connectionId}`],
  );
  await store.pool.query(
    `insert into payments
       (id, org_id, invoice_id, connection_id, provider_payment_id, idempotency_key,
        amount, currency, status)
     values ($1, $2, $3, $4, 'manual:test', $5, 29000, 'RUB', 'succeeded')`,
    [paymentId, orgId, invoiceId, connectionId, `pay-${paymentId}`],
  );
}

describe.skipIf(!store)("billing operator commands (ADR-259, ADR-262)", () => {
  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from mail_outbox where to_email like $1", [
      `billing-${orgId}@example.test`,
    ]);
    await store.withTenant(orgId, async () => {
      for (const table of [
        "refunds",
        "org_credit_ledger",
        "payments",
        "billing_events",
        "invoices",
        "subscriptions",
        "billing_accounts",
      ]) {
        await store.pool.query(`delete from ${table} where org_id = $1`, [orgId]);
      }
    });
    await store.pool.query("delete from audit_events where org_id = $1", [orgId]);
    await store.pool.query("delete from admin_roles where org_id = $1", [orgId]);
    await store.pool.query("delete from org_memberships where org_id = $1", [orgId]);
    await store.pool.query("delete from orgs where id = $1", [orgId]);
    await store.pool.query("delete from payment_connections where id = $1", [connectionId]);
    await store.pool.query("delete from user_mfa where user_id = $1", [userId]);
    await store.pool.query("delete from instance_operators where user_id = $1", [userId]);
    await store.pool.query("delete from users where id = $1", [userId]);
    await store.close();
  });

  it("refuses a refund without a reason, a whole number or the expected sum", () => {
    expect(() => parseRefundArgs([paymentId, "--expect-refunded", "0"])).toThrow(/--reason/);
    expect(() =>
      parseRefundArgs([paymentId, "--reason", "x", "--expect-refunded", "0", "--amount", "1.5"]),
    ).toThrow(/minor units/);
    expect(() => parseRefundArgs([paymentId, "--reason", "x"])).toThrow(/--expect-refunded/);
    expect(() =>
      parseRefundArgs([paymentId, "--reason", "x", "--expect-refunded", "zero"]),
    ).toThrow(/minor units/);
    // Zero is a legal expectation: "nothing has been returned yet".
    expect(parseRefundArgs([paymentId, "--reason", "x", "--expect-refunded", "0"]).expectRefunded).toBe(0);
  });

  it("refuses a refund without an author before touching the database", async () => {
    const log = capture();
    const codeResult = await runBillingRefund({
      argv: [paymentId, "--reason", "customer request", "--expect-refunded", "0"],
      store,
      mailConfig,
      env: {},
      out: log.out,
      err: log.err,
    });
    expect(codeResult).toBe(1);
    expect(log.lines.join("\n")).toContain("--as");
  });

  it("refuses a refund with a wrong second-factor code and moves no money", async () => {
    await seed();
    const log = capture();
    const codeResult = await runBillingRefund({
      argv: [
        paymentId,
        "--reason",
        "customer request",
        "--expect-refunded",
        "0",
        "--as",
        userId,
        "--code",
        "000000",
      ],
      store,
      mailConfig,
      env,
      out: log.out,
      err: log.err,
    });
    expect(codeResult).toBe(1);
    expect(log.lines.join("\n")).toContain("did not work");
    const { rows } = await store.withTenant(orgId, () =>
      store.pool.query("select 1 from refunds where org_id = $1", [orgId]),
    );
    expect(rows).toHaveLength(0);
  });

  it("refunds part of the payment, writes the journal and the audit with the channel", async () => {
    const log = capture();
    const codeResult = await runBillingRefund({
      argv: [
        paymentId,
        "--expect-refunded",
        "0",
        "--amount",
        "10000",
        "--reason",
        "customer request",
        "--as",
        userId,
        "--code",
        await code(),
      ],
      store,
      mailConfig,
      env,
      out: log.out,
      err: log.err,
    });
    expect(codeResult, log.lines.join("\n")).toBe(0);

    const { rows: refunds } = await store.withTenant(orgId, () =>
      store.pool.query("select amount, status, reason, idempotency_key from refunds where org_id = $1", [
        orgId,
      ]),
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amount: "10000",
      status: "succeeded",
      reason: "customer request",
      idempotency_key: `operator-refund:${paymentId}:0:10000`,
    });

    const { rows: payments } = await store.withTenant(orgId, () =>
      store.pool.query("select status from payments where id = $1", [paymentId]),
    );
    expect(payments[0].status).toBe("partially_refunded");

    const { rows: audit } = await store.pool.query(
      `select action, reason, actor_id, channel, mfa from audit_events
        where org_id = $1 and action = 'billing.refunded'`,
      [orgId],
    );
    expect(audit).toEqual([
      {
        action: "billing.refunded",
        reason: "customer request",
        actor_id: userId,
        channel: "cli",
        mfa: "totp",
      },
    ]);

    const { rows: mail } = await store.pool.query(
      "select template, locale from mail_outbox where to_email = $1",
      [`billing-${orgId}@example.test`],
    );
    expect(mail).toEqual([{ template: "payment_refunded", locale: "en" }]);
  });

  it("refuses a repeat that expects the old sum with exit code 3 and no provider call", async () => {
    const log = capture();
    const codeResult = await runBillingRefund({
      argv: [
        paymentId,
        "--expect-refunded",
        "0",
        "--reason",
        "closed laptop, ran again",
        "--as",
        userId,
        "--code",
        await code(),
      ],
      store,
      mailConfig,
      env,
      out: log.out,
      err: log.err,
    });
    expect(codeResult).toBe(3);
    const text = log.lines.join("\n");
    expect(text).toContain("already refunded");
    expect(text).toContain("expected");
    expect(text).toContain("customer:show");

    const { rows } = await store.withTenant(orgId, () =>
      store.pool.query("select 1 from refunds where org_id = $1", [orgId]),
    );
    expect(rows).toHaveLength(1);
  });

  it("records a refund that raced another operator and journals the warning", async () => {
    const other = randomUUID();
    await store.pool.query(
      `insert into users (id, email, password_hash, name, handle, lang)
       values ($1, $2, 'x', 'Other', $3, 'en')`,
      [other, `other-${other}@example.test`, `other-${other.slice(0, 8)}`],
    );
    await store.withTenant(orgId, () =>
      store.pool.query(
        `insert into refunds (org_id, payment_id, amount, currency, reason, status,
                              idempotency_key, created_by)
         values ($1, $2, 1000, 'RUB', 'another operator', 'succeeded', $3, $4)`,
        [orgId, paymentId, `race-${randomUUID()}`, other],
      ),
    );
    const recorded = await store.withTenant(orgId, () =>
      store.recordRefund({
        orgId,
        paymentId,
        amount: 1000,
        currency: "RUB",
        reason: "second operator",
        status: "succeeded",
        idempotencyKey: `race-${randomUUID()}`,
        createdBy: userId,
        expectRefunded: 10000,
      }),
    );
    expect(recorded.concurrent).toEqual({ expected: 10000, actual: 11000 });
    const authors = await store.operatorRefundAuthors({
      paymentId,
      excludeUserId: userId,
    });
    expect(authors).toEqual([{ id: other, email: `other-${other}@example.test` }]);
    await store.pool.query("delete from refunds where idempotency_key like 'race-%'");
    await store.pool.query("delete from users where id = $1", [other]);
  });

  it("refunds the rest when the expectation matches, and cancels the subscription", async () => {
    const log = capture();
    const codeResult = await runBillingRefund({
      argv: [
        paymentId,
        "--expect-refunded",
        "10000",
        "--reason",
        "rest of the cancellation",
        "--as",
        userId,
        "--code",
        await code(),
      ],
      store,
      mailConfig,
      env,
      out: log.out,
      err: log.err,
    });
    expect(codeResult, log.lines.join("\n")).toBe(0);
    const { rows } = await store.withTenant(orgId, () =>
      store.pool.query("select count(*)::int as n from refunds where org_id = $1", [orgId]),
    );
    expect(rows[0].n).toBe(2);
    const { rows: subscriptions } = await store.withTenant(orgId, () =>
      store.pool.query("select status from subscriptions where id = $1", [subscriptionId]),
    );
    expect(subscriptions[0].status).toBe("canceled");
  });

  it("adds a credit to the journal with a reason and the second factor", async () => {
    const log = capture();
    const codeResult = await runBillingCredit({
      argv: [
        "--org",
        orgId,
        "--amount",
        "5000",
        "--reason",
        "service interruption",
        "--as",
        userId,
        "--code",
        await code(),
      ],
      store,
      env,
      out: log.out,
      err: log.err,
    });
    expect(codeResult, log.lines.join("\n")).toBe(0);
    const { rows } = await store.withTenant(orgId, () =>
      store.pool.query(
        "select amount, currency, kind, note from org_credit_ledger where org_id = $1",
        [orgId],
      ),
    );
    expect(rows).toEqual([
      { amount: "5000", currency: "RUB", kind: "goodwill", note: "service interruption" },
    ]);
    const { rows: audit } = await store.pool.query(
      "select action, reason, channel, mfa from audit_events where org_id = $1 and action = 'billing.credit_granted'",
      [orgId],
    );
    expect(audit).toEqual([
      { action: "billing.credit_granted", reason: "service interruption", channel: "cli", mfa: "totp" },
    ]);
  });

  it("requires a reason for a credit", () => {
    expect(() => parseCreditArgs(["--org", orgId, "--amount", "100"])).toThrow(/--reason/);
  });

  it("refuses a credit without an author", async () => {
    const log = capture();
    const codeResult = await runBillingCredit({
      argv: ["--org", orgId, "--amount", "100", "--reason", "why not"],
      store,
      env: {},
      out: log.out,
      err: log.err,
    });
    expect(codeResult).toBe(1);
    expect(log.lines.join("\n")).toContain("--as");
  });

});
