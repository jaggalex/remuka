import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken, newToken } from "./iam.mjs";
import { handleOperatorConsole } from "./operator-console-api.mjs";
import { openMetricsTestPool } from "./metrics-test-db.mjs";
import { testDatabaseStore } from "./test-db.mjs";

/**
 * The console's SQL against a real database (ADR-259 §5, stage 2).
 *
 * The unit test proves the access rules; this one proves the queries: search by an
 * address and an invoice number, the card without a room title, the journal filter, and
 * the Pulse money tile. Two sessions, one operator and one member, so the 404 is real.
 */
const opened = await testDatabaseStore("operator-console");
const store = opened?.store ?? null;
/** The metrics tables live in their own database in production; a run DB is enough here. */
let metricsPool = null;

const orgId = randomUUID();
const operatorId = randomUUID();
const memberId = randomUUID();
const invoiceNumber = `RU-CONSOLE-${orgId.slice(0, 8)}`;
const boardId = `console-${orgId}`;
let operatorToken = null;
let memberToken = null;

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

function request(token) {
  const stream = Readable.from([]);
  stream.method = "GET";
  stream.headers = { cookie: `remo_session=${token}` };
  return stream;
}

async function call(path, token) {
  const response = fakeResponse();
  const handled = await handleOperatorConsole({
    request: request(token),
    response,
    url: new URL(`http://localhost${path}`),
    store,
    // The step-up challenge is issued behind the 12-hour guard; the key is the same one
    // the routes read in production (the row above is never decrypted by a read).
    env: { REMO_KEK: Buffer.alloc(32, 9).toString("base64"), REMO_KEK_ID: "test" },
    metricsStore: metricsPool ? { pool: metricsPool } : null,
    log: { error() {} },
  });
  return { handled, ...response.out };
}

async function seed() {
  for (const [id, email, handle] of [
    [operatorId, `ops-${orgId}@example.test`, `ops-${orgId.slice(0, 8)}`],
    [memberId, `member-${orgId}@example.test`, `mem-${orgId.slice(0, 8)}`],
  ]) {
    await store.pool.query(
      `insert into users (id, email, password_hash, name, handle, lang, email_verified_at)
       values ($1, $2, 'x', 'Person', $3, 'ru', now())`,
      [id, email, handle],
    );
  }
  await store.pool.query("insert into orgs (id, name, slug) values ($1, 'Console org', $2)", [
    orgId,
    `console-org-${orgId}`,
  ]);
  await store.pool.query(
    `insert into org_memberships (org_id, user_id, relation, state)
     values ($1, $2, 'member', 'active'), ($1, $3, 'member', 'active')`,
    [orgId, operatorId, memberId],
  );
  await store.pool.query("insert into instance_operators (user_id) values ($1)", [operatorId]);
  // The operator has a confirmed factor and entered its code a moment ago: the console's
  // read guard needs both (ADR-260 §6). The sealed columns are never opened by a read.
  await store.pool.query(
    `insert into user_mfa
       (user_id, secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce,
        kek_id, confirmed_at, last_step)
     values ($1, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea,
             'test', now(), 0)`,
    [operatorId],
  );
  await store.pool.query(
    `insert into subscriptions
       (org_id, plan, price_id, amount, currency, interval, status,
        current_period_start, current_period_end)
     values ($1, 'team', 'team-rub-month-v1', 59000, 'RUB', 'month', 'active',
             now() - interval '1 day', now() + interval '20 days')`,
    [orgId],
  );
  await store.pool.query(
    `insert into invoices
       (org_id, number, status, currency, subtotal, discount, credit_applied, total, lines)
     values ($1, $2, 'open', 'RUB', 59000, 0, 0, 59000, '[]'::jsonb)`,
    [orgId, invoiceNumber],
  );
  await store.pool.query(
    `insert into boards (id, title, org_id, owner_id, visibility)
     values ($1, 'A room the console must not name', $2, $3, 'private')`,
    [boardId, orgId, operatorId],
  );
  await store.pool.query(
    `insert into audit_events (actor_id, org_id, action, subject, reason)
     values ($1, $2, 'billing.refunded', $3, 'customer request')`,
    [operatorId, orgId, randomUUID()],
  );

  operatorToken = newToken();
  memberToken = newToken();
  for (const [token, userId, mfaAt] of [
    [operatorToken, operatorId, "now()"],
    [memberToken, memberId, "null"],
  ]) {
    await store.pool.query(
      `insert into sessions (user_id, token_hash, expires_at, mfa_at)
       values ($1, $2, now() + interval '1 day', ${mfaAt})`,
      [userId, hashToken(token)],
    );
  }
}

describe.skipIf(!store)("operator console (ADR-259 §5)", () => {
  beforeAll(async () => {
    await seed();
    metricsPool = await openMetricsTestPool(opened.url, { max: 2 });
    // A money snapshot on the last full day, the only source the tile may read (§4.6).
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await metricsPool.query(
      `insert into metrics_daily (day, zone, metric, dims, value, status, basis)
       values ($1, 'none', 'money.mrr', '{"currency":"RUB","plan":"team"}'::jsonb, 59000, 'ok', 'snapshot'),
              ($1, 'none', 'money.paying', '{}'::jsonb, 1, 'ok', 'snapshot')
       on conflict do nothing`,
      [yesterday],
    );
  });

  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from sessions where user_id = any($1::uuid[])", [
      [operatorId, memberId],
    ]);
    await store.pool.query("delete from audit_events where org_id = $1", [orgId]);
    await store.pool.query("delete from boards where id = $1", [boardId]);
    await store.pool.query("delete from invoices where org_id = $1", [orgId]);
    await store.pool.query("delete from subscriptions where org_id = $1", [orgId]);
    await store.pool.query("delete from instance_operators where user_id = $1", [operatorId]);
    await store.pool.query("delete from org_memberships where org_id = $1", [orgId]);
    await store.pool.query("delete from orgs where id = $1", [orgId]);
    await store.pool.query("delete from users where id = any($1::uuid[])", [[operatorId, memberId]]);
    if (metricsPool) {
      await metricsPool.query("delete from metrics_daily where zone = 'none'");
      await metricsPool.end();
    }
    await store.close();
  });

  it("answers 404 to a session without the role", async () => {
    const denied = await call("/operator/pulse", memberToken);
    expect(denied.status).toBe(404);
  });

  it("refuses a read whose code is older than twelve hours", async () => {
    await store.pool.query(
      "update sessions set mfa_at = now() - interval '13 hours' where token_hash = $1",
      [hashToken(operatorToken)],
    );
    try {
      const denied = await call("/operator/pulse", operatorToken);
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ error: "MFA_REQUIRED", mfaRequired: true });
    } finally {
      await store.pool.query("update sessions set mfa_at = now() where token_hash = $1", [
        hashToken(operatorToken),
      ]);
    }
  });

  it("reads the pulse's money tile from the daily snapshot, not billing", async () => {
    const result = await call("/operator/pulse?weeks=4", operatorToken);
    expect(result.status).toBe(200);
    // The snapshot was written into the metrics database; the product subscription row is
    // deliberately not the source (§4.6).
    const rub = result.body.money.mrrByCurrency.find((row) => row.currency === "RUB");
    expect(rub.amount).toBe(59000);
    const mrr = result.body.tiles.find((tile) => tile.id === "mrr");
    expect(mrr.value).toBe(59000);
    expect(mrr.basis).toBe("snapshot");
    expect(result.body.lastCompleteDay).toBe(
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    );
  });

  it("finds a customer by address and by invoice number", async () => {
    const byEmail = await call(
      `/operator/customers?q=${encodeURIComponent(`ops-${orgId}@example.test`)}`,
      operatorToken,
    );
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.matches[0]).toMatchObject({ kind: "user" });

    const byInvoice = await call(
      `/operator/customers?q=${encodeURIComponent(invoiceNumber)}`,
      operatorToken,
    );
    expect(byInvoice.body.matches[0]).toMatchObject({
      kind: "invoice",
      id: orgId,
      label: invoiceNumber,
    });
  });

  it("prints the card without a room title", async () => {
    const result = await call(`/operator/customers/org/${orgId}`, operatorToken);
    expect(result.status).toBe(200);
    expect(result.body.orgs[0]).toMatchObject({ name: "Console org", counts: { rooms: 1 } });
    expect(JSON.stringify(result.body)).not.toContain("A room the console must not name");
  });

  it("filters the journal by action and keeps the reason", async () => {
    const result = await call("/operator/journal?action=billing.", operatorToken);
    expect(result.status).toBe(200);
    // The database is shared with other suites, so this suite's row is found by its
    // actor and reason rather than by position.
    const event = result.body.events.find(
      (row) => row.actorId === operatorId && row.reason === "customer request",
    );
    expect(event).toMatchObject({ action: "billing.refunded" });
  });
});
