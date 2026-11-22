import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleOperatorConsole } from "./operator-console-api.mjs";
import { encryptSecret } from "./secrets.mjs";
import { testDatabaseStore } from "./test-db.mjs";

/**
 * The console's changing actions against a real database (ADR-262 §3,
 * `spec/operator-actions.md` §3–§4).
 *
 * The unit test proves the access rules; this one proves the acts: a refund is the same
 * function the shell calls, `operator_requests` makes a repeat a read, a state mismatch is
 * a 409 with the real number, a measure letters the administrators, and every path that is
 * not a console action stays a 404 — `operator:*` and `mfa:reset` included.
 */
const opened = await testDatabaseStore("operator-actions");
const store = opened?.store ?? null;

const orgId = randomUUID();
const operatorId = randomUUID();
const adminId = randomUUID();
const memberId = randomUUID();
const connectionId = randomUUID();
const invoiceId = randomUUID();
const openInvoiceId = randomUUID();
const paymentId = randomUUID();
const boardId = `actions-${orgId}`;
const KEK = { key: Buffer.alloc(32, 17), id: "v1" };
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const env = {
  NODE_ENV: "test",
  REMO_KEK: KEK.key.toString("base64"),
  REMO_KEK_ID: "v1",
  REMO_MAIL_DRIVER: "console",
  REMO_MAIL_FROM: "Remuka <no-reply@example.test>",
  REMO_CONTACT_ABUSE: "abuse@example.test",
  REMO_COMPLIANCE_ZONE: "none",
};

let operatorToken = null;
let memberToken = null;
const requestIds = [];

function fakeResponse() {
  const out = { status: 0, body: null, headers: {} };
  return {
    out,
    writeHead(status, headers = {}) {
      out.status = status;
      Object.assign(out.headers, headers);
    },
    setHeader(name, value) {
      out.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return out.headers[name.toLowerCase()];
    },
    end(text) {
      out.body = text ? JSON.parse(text) : null;
    },
  };
}

function request({ method = "GET", token = operatorToken, body = null } = {}) {
  const stream = body === null ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.headers = token ? { cookie: `remo_session=${token}` } : {};
  return stream;
}

async function call(path, { method = "GET", token = operatorToken, body = null } = {}) {
  const response = fakeResponse();
  const handled = await handleOperatorConsole({
    request: request({ method, token, body }),
    response,
    url: new URL(`http://localhost${path}`),
    store,
    env,
    log: { error() {} },
  });
  return { handled, ...response.out };
}

async function seed() {
  for (const [id, email, handle] of [
    [operatorId, `ops-${orgId}@example.test`, `ops-${orgId.slice(0, 8)}`],
    [adminId, `admin-${orgId}@example.test`, `adm-${orgId.slice(0, 8)}`],
    [memberId, `member-${orgId}@example.test`, `mem-${orgId.slice(0, 8)}`],
  ]) {
    await store.pool.query(
      `insert into users (id, email, password_hash, name, handle, lang, email_verified_at)
       values ($1, $2, 'x', 'Person', $3, 'en', now())`,
      [id, email, handle],
    );
  }
  await store.pool.query("insert into orgs (id, name, slug) values ($1, 'Actions org', $2)", [
    orgId,
    `actions-org-${orgId}`,
  ]);
  await store.pool.query(
    `insert into org_memberships (org_id, user_id, relation, state)
     values ($1, $2, 'member', 'active'), ($1, $3, 'member', 'active'), ($1, $4, 'member', 'active')`,
    [orgId, operatorId, adminId, memberId],
  );
  await store.pool.query(
    "insert into admin_roles (org_id, user_id, role) values ($1, $2, 'org_admin')",
    [orgId, adminId],
  );
  await store.pool.query("insert into instance_operators (user_id) values ($1)", [operatorId]);
  const sealed = encryptSecret(SECRET, {
    scope: "mfa",
    scopeId: operatorId,
    provider: "totp",
    id: operatorId,
    kek: KEK,
  });
  await store.pool.query(
    `insert into user_mfa
       (user_id, secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce,
        kek_id, confirmed_at)
     values ($1, $2, $3, $4, $5, $6, now())`,
    [operatorId, sealed.ciphertext, sealed.nonce, sealed.dekWrapped, sealed.dekNonce, sealed.kekId],
  );
  await store.pool.query(
    `insert into billing_accounts (org_id, billing_email, billing_name, currency)
     values ($1, $2, 'Actions org', 'RUB')`,
    [orgId, `billing-${orgId}@example.test`],
  );
  await store.pool.query(
    `insert into payment_connections
       (id, provider, name, mode, status, currencies, method_groups, webhook_token)
     values ($1, 'manual', 'Test connection', 'test', 'active', '{RUB}', '{invoice}', $2)`,
    [connectionId, `webhook-${connectionId}`],
  );
  await store.pool.query(
    `insert into invoices
       (id, org_id, number, status, currency, subtotal, discount, credit_applied, total, lines)
     values ($1, $2, $3, 'paid', 'RUB', 29000, 0, 0, 29000, '[]'::jsonb),
            ($4, $2, $5, 'open', 'RUB', 10000, 0, 0, 10000, '[]'::jsonb)`,
    [invoiceId, orgId, `RU-ACT-${orgId.slice(0, 8)}`, openInvoiceId, `RU-OPEN-${orgId.slice(0, 8)}`],
  );
  await store.pool.query(
    `insert into payments
       (id, org_id, invoice_id, connection_id, provider_payment_id, idempotency_key,
        amount, currency, status)
     values ($1, $2, $3, $4, 'manual:actions', $5, 29000, 'RUB', 'succeeded')`,
    [paymentId, orgId, invoiceId, connectionId, `pay-${paymentId}`],
  );
  await store.pool.query(
    `insert into boards (id, title, org_id, owner_id, visibility)
     values ($1, 'A room with a bad link', $2, $3, 'link')`,
    [boardId, orgId, adminId],
  );
  await store.pool.query(
    "insert into board_links (board_id, enabled, created_by) values ($1, true, $2)",
    [boardId, adminId],
  );

  operatorToken = randomUUID();
  memberToken = randomUUID();
  for (const [token, userId] of [
    [operatorToken, operatorId],
    [memberToken, memberId],
  ]) {
    const { hashToken } = await import("./iam.mjs");
    await store.pool.query(
      `insert into sessions (user_id, token_hash, expires_at, mfa_at, mfa_factor)
       values ($1, $2, now() + interval '1 day', now(), 'totp')`,
      [userId, hashToken(token)],
    );
  }
}

describe.skipIf(!store)("console actions (ADR-262 §3)", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from mail_outbox where to_email like $1", [
      `%${orgId}@example.test`,
    ]);
    await store.pool.query("delete from operator_requests where operator_id = $1", [operatorId]);
    await store.withTenant(orgId, async () => {
      for (const table of [
        "refunds",
        "org_credit_ledger",
        "payments",
        "billing_events",
        "invoices",
        "billing_accounts",
      ]) {
        await store.pool.query(`delete from ${table} where org_id = $1`, [orgId]);
      }
    });
    await store.pool.query("delete from board_links where board_id = $1", [boardId]);
    await store.pool.query("delete from boards where id = $1", [boardId]);
    await store.pool.query("delete from audit_events where org_id = $1", [orgId]);
    await store.pool.query("delete from operator_actions where subject_id = $1", [boardId]);
    await store.pool.query("delete from admin_roles where org_id = $1", [orgId]);
    await store.pool.query("delete from org_memberships where org_id = $1", [orgId]);
    await store.pool.query("delete from orgs where id = $1", [orgId]);
    await store.pool.query("delete from payment_connections where id = $1", [connectionId]);
    await store.pool.query("delete from user_mfa where user_id = $1", [operatorId]);
    await store.pool.query("delete from instance_operators where user_id = $1", [operatorId]);
    await store.pool.query("delete from sessions where user_id = any($1::uuid[])", [
      [operatorId, memberId],
    ]);
    await store.pool.query("delete from users where id = any($1::uuid[])", [
      [operatorId, adminId, memberId],
    ]);
    await store.close();
  });

  it("answers 404 to a non-operator and to every path the console does not own", async () => {
    for (const path of [
      "/operator/operators",
      "/operator/mfa/reset",
      "/operator/account/delete",
      "/operator/payments/x/refund",
    ]) {
      const denied = await call(path, {
        method: "POST",
        token: memberToken,
        body: { reason: "a long enough reason", requestId: randomUUID() },
      });
      expect(denied.status, path).toBe(404);
    }
    const refund = await call(`/operator/payments/${paymentId}/refund`, {
      method: "POST",
      token: memberToken,
      body: { expectRefunded: 0, reason: "a long enough reason", requestId: randomUUID() },
    });
    expect(refund.status).toBe(404);
  });

  it("refuses a reason shorter than ten characters before writing anything", async () => {
    const requestId = randomUUID();
    const short = await call(`/operator/payments/${paymentId}/refund`, {
      method: "POST",
      body: { expectRefunded: 0, reason: "short", requestId },
    });
    expect(short.status).toBe(400);
    expect(short.body.error).toBe("REASON_REQUIRED");
    const { rows } = await store.pool.query(
      "select 1 from operator_requests where request_id = $1",
      [requestId],
    );
    expect(rows).toHaveLength(0);
  });

  it("refunds once for one requestId, repeats the answer and keeps one row", async () => {
    const requestId = randomUUID();
    requestIds.push(requestId);
    const body = {
      amount: 10000,
      expectRefunded: 0,
      reason: "customer asked for a partial refund",
      requestId,
    };
    const first = await call(`/operator/payments/${paymentId}/refund`, { method: "POST", body });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const refundId = first.body.result.refundId;

    const second = await call(`/operator/payments/${paymentId}/refund`, { method: "POST", body });
    expect(second.status).toBe(200);
    expect(second.body.result.refundId).toBe(refundId);

    const { rows: refunds } = await store.withTenant(orgId, () =>
      store.pool.query("select id, amount, idempotency_key from refunds where org_id = $1", [orgId]),
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0].idempotency_key).toBe(`operator-refund:${paymentId}:console:${requestId}`);
    const { rows: requests } = await store.pool.query(
      "select request_id, operator_id, route, result from operator_requests where request_id = $1",
      [requestId],
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      request_id: requestId,
      operator_id: operatorId,
      route: `/operator/payments/${paymentId}/refund`,
    });
    expect(requests[0].result.refundId).toBe(refundId);

    const { rows: audit } = await store.pool.query(
      `select channel, mfa, reason from audit_events
        where org_id = $1 and action = 'billing.refunded'`,
      [orgId],
    );
    expect(audit).toEqual([
      { channel: "console", mfa: "totp", reason: "customer asked for a partial refund" },
    ]);
  });

  it("refuses a state mismatch with the real number and the same requestId elsewhere", async () => {
    const stale = await call(`/operator/payments/${paymentId}/refund`, {
      method: "POST",
      body: {
        expectRefunded: 0,
        reason: "a repeated refund with a stale expectation",
        requestId: randomUUID(),
      },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("REFUND_STATE_CHANGED");
    expect(stale.body.refunded).toBe(10000);
    expect(stale.body.currency).toBe("RUB");

    const reused = await call(`/operator/orgs/${orgId}/credit`, {
      method: "POST",
      body: {
        amount: 500,
        reason: "the same form id on a different route is a conflict",
        requestId: requestIds[0],
      },
    });
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe("REQUEST_CONFLICT");
  });

  it("marks an invoice paid and credits an organisation through the same commands", async () => {
    const paid = await call(`/operator/invoices/${openInvoiceId}/mark-paid`, {
      method: "POST",
      body: { reason: "bank transfer arrived Monday", requestId: randomUUID() },
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.result.invoice.status).toBe("paid");

    const credit = await call(`/operator/orgs/${orgId}/credit`, {
      method: "POST",
      body: {
        amount: 50000,
        currency: "RUB",
        reason: "compensation for the outage",
        requestId: randomUUID(),
      },
    });
    expect(credit.status, JSON.stringify(credit.body)).toBe(200);
    expect(credit.body.result.amount).toBe(50000);
  });

  it("applies and reverts a measure, letters the administrators and names the console", async () => {
    const applied = await call("/operator/measures", {
      method: "POST",
      body: {
        kind: "link_disable",
        target: boardId,
        reason: "the public link leads to unlawful material",
        requestId: randomUUID(),
      },
    });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const actionId = applied.body.result.action.id;

    const open = await call("/operator/measures");
    expect(open.status).toBe(200);
    expect(open.body.actions.map((action) => action.id)).toContain(actionId);

    const reverted = await call(`/operator/measures/${actionId}/revert`, {
      method: "POST",
      body: { reason: "the complaint was resolved", requestId: randomUUID() },
    });
    expect(reverted.status, JSON.stringify(reverted.body)).toBe(200);
    expect(reverted.body.result.changed).toBe(true);

    const { rows: audit } = await store.pool.query(
      `select action, channel, mfa from audit_events
        where org_id = $1 and action like 'abuse.%'
        order by at`,
      [orgId],
    );
    expect(audit).toEqual([
      { action: "abuse.link_disabled", channel: "console", mfa: "totp" },
      { action: "abuse.reverted", channel: "console", mfa: "totp" },
    ]);
    const { rows: letters } = await store.pool.query(
      `select template, locale from mail_outbox where to_email = $1 order by created_at`,
      [`admin-${orgId}@example.test`],
    );
    expect(letters.length).toBe(2);
    expect(new Set(letters.map((letter) => letter.template))).toEqual(new Set(["operator_action"]));
  });

  it("shows connections without secrets and the refund with its channel", async () => {
    const money = await call("/operator/money");
    expect(money.status).toBe(200);
    const connection = money.body.connections.find((row) => row.id === connectionId);
    expect(connection).toMatchObject({
      provider: "manual",
      name: "Test connection",
      mode: "test",
      status: "active",
    });
    expect(connection).not.toHaveProperty("webhook_token");
    expect(connection).not.toHaveProperty("ciphertext");
    expect(connection).not.toHaveProperty("settings");
    const refund = money.body.refunds.find((row) => row.orgId === orgId);
    expect(refund).toMatchObject({ amount: 10000, currency: "RUB", channel: "console" });
  });

  it("asks for a fresh code twenty minutes after the step-up", async () => {    const { hashToken } = await import("./iam.mjs");
    await store.pool.query(
      `update sessions set mfa_at = now() - interval '20 minutes', mfa_factor = 'totp'
        where token_hash = $1`,
      [hashToken(operatorToken)],
    );
    const stale = await call(`/operator/orgs/${orgId}/credit`, {
      method: "POST",
      body: {
        amount: 100,
        reason: "a credit after the step-up window",
        requestId: randomUUID(),
      },
    });
    expect(stale.status).toBe(403);
    expect(stale.body.error).toBe("MFA_REQUIRED");
    expect(typeof stale.body.challenge).toBe("string");
    // Reading stays open for twelve hours: the refusal is about this action, not the console.
    const read = await call("/operator/measures");
    expect(read.status).toBe(200);
  });

  it("removes an idempotency row past the thirty-day window", async () => {
    const requestId = randomUUID();
    await store.pool.query(
      `insert into operator_requests (request_id, operator_id, route, result, created_at)
       values ($1, $2, '/operator/measures', '{"refundId":"x"}'::jsonb, now() - interval '31 days')`,
      [requestId, operatorId],
    );
    const removed = await store.purgeOperatorRequests({
      cutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    expect(removed).toBeGreaterThanOrEqual(1);
    const { rows } = await store.pool.query(
      "select 1 from operator_requests where request_id = $1",
      [requestId],
    );
    expect(rows).toHaveLength(0);
  });
});
