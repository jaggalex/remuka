/**
 * Account deletion against a real database (ADR-257, `spec/account-deletion.md` §2–§3).
 *
 * The unit tests prove the refusals. This file proves the two irreversible things: the
 * command really ends every way back in, and the purge really leaves a tombstone rather
 * than a person. It also walks `information_schema`, so a foreign key to `users` added
 * later without a decision in the specification fails here and not in an audit.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccountPurge } from "./account-purge.mjs";
import {
  USER_REFERENCES,
  deleteAccount,
} from "./account-deletion.mjs";
import { deleteAccountAsOperator } from "./account-operator.mjs";
import { FILE_VARIANTS, fileKey } from "./files-store.mjs";
import { handleIam } from "./iam-api.mjs";
import { testDatabaseStore } from "./test-db.mjs";

// The cancellation letter is sealed with the installation's KEK, as in every mail test.
process.env.REMO_KEK = Buffer.alloc(32, 5).toString("base64");

const opened = await testDatabaseStore("account deletion");
const store = opened?.store ?? null;
let server = null;
let base = "";

const users = [];
const orgs = [];
const boards = [];
let tokenSeed = 0;

function hash() {
  tokenSeed += 1;
  return Buffer.from(`token-${tokenSeed}-${randomUUID()}`);
}

const DAY = 24 * 60 * 60 * 1000;

async function seedUser({ name = "Anna Petrova", state = "active", deletingSince = null } = {}) {
  const userId = randomUUID();
  await store.pool.query(
    `insert into users
       (id, email, password_hash, name, handle, state, deletion_requested_at, support_id)
     values ($1, $2, 'scrypt$16384$8$1$c2FsdA==$aGFzaA==', $3, $4, $5, $6, $7)`,
    [
      userId,
      `del-${userId}@example.test`,
      name,
      `del-${userId.slice(0, 8)}`,
      state,
      deletingSince,
      `support-${userId.slice(0, 8)}`,
    ],
  );
  users.push(userId);
  return userId;
}

async function seedOrg({ kind = "shared", createdBy = null, name = "Studio" } = {}) {
  const orgId = randomUUID();
  await store.pool.query(
    "insert into orgs (id, name, slug, kind, created_by) values ($1, $2, $3, $4, $5)",
    [orgId, name, `org-${orgId.slice(0, 8)}`, kind, createdBy],
  );
  orgs.push(orgId);
  return orgId;
}

async function join(orgId, userId, state = "active") {
  await store.pool.query(
    "insert into org_memberships (org_id, user_id, relation, state) values ($1, $2, 'member', $3)",
    [orgId, userId, state],
  );
}

async function makeAdmin(orgId, userId, grantedBy = null) {
  await store.pool.query(
    `insert into admin_roles (org_id, user_id, role, granted_by)
     values ($1, $2, 'org_admin', $3)`,
    [orgId, userId, grantedBy],
  );
}

async function seedBoard(orgId, ownerId, createdBy = ownerId) {
  const boardId = `del-${randomUUID().slice(0, 12)}`;
  await store.pool.query(
    `insert into boards (id, title, org_id, owner_id, created_by)
     values ($1, 'Room', $2, $3, $4)`,
    [boardId, orgId, ownerId, createdBy],
  );
  boards.push(boardId);
  return boardId;
}

async function callDelete(userId) {
  return deleteAccount({ store, userId, actorId: userId });
}

/** A purge job whose clock is fifteen days past the request. */
function purgeJob(fileStore = null) {
  return createAccountPurge({
    store,
    fileStore,
    log: { log() {}, error() {} },
    now: () => new Date(Date.now()),
  });
}

async function backdate(userId, days = 15) {
  await store.pool.query(
    "update users set deletion_requested_at = now() - $2::interval where id = $1",
    [userId, `${days} days`],
  );
}

/** A cookie jar per "browser", as in `iam-api.test.mjs`. */
function client() {
  let cookie = "";
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
}

const suite = store ? describe : describe.skip;

beforeAll(async () => {
  if (!store) return;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (
      await handleIam({
        request,
        response,
        url,
        store,
        mail: { mail: true, passwordReset: true, emailVerification: true },
        mailConfig: {
          driver: "console",
          from: "",
          replyTo: null,
          productName: null,
          appOrigin: "http://localhost:5173",
          isProduction: false,
        },
      })
    ) {
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not handled in this test" }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (!store) return;
  const cleanup = async (text, params) => {
    await store.pool.query(text, params).catch(() => {});
  };
  if (users.length) {
    await cleanup("delete from audit_events where actor_id = any($1::uuid[])", [users]);
    await cleanup("delete from audit_events where subject = any($1::text[])", [
      users.map(String),
    ]);
    await cleanup("delete from mail_outbox where user_id = any($1::uuid[])", [users]);
    for (const table of [
      "refunds",
      "payments",
      "org_credit_ledger",
      "invoices",
      "subscriptions",
      "payment_methods",
      "billing_events",
      "billing_accounts",
    ]) {
      await cleanup(`delete from ${table} where org_id = any($1::uuid[])`, [orgs]);
    }
    await cleanup("delete from boards where owner_id = any($1::uuid[]) or org_id = any($2::uuid[])", [
      users,
      orgs,
    ]);
    await cleanup("delete from orgs where id = any($1::uuid[])", [orgs]);
    await cleanup("delete from users where id = any($1::uuid[])", [users]);
  }
  await store.close();
});

suite("db:account deletion (ADR-257)", () => {
  it("is schema 37 with the two states and the request date", async () => {
    const { rows } = await store.pool.query("select version from schema_meta where id = 1");
    expect(rows[0].version).toBe(40);

    const userId = await seedUser();
    await store.pool.query("update users set state = 'deleting' where id = $1", [userId]);
    await store.pool.query("update users set state = 'deleted' where id = $1", [userId]);
    await expect(
      store.pool.query("update users set state = 'removed' where id = $1", [userId]),
    ).rejects.toMatchObject({ code: "23514" });

    const { rows: column } = await store.pool.query(
      `select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'users'
          and column_name = 'deletion_requested_at'`,
    );
    expect(column[0]?.data_type).toBe("timestamp with time zone");
  });

  it("has a deletion decision for every foreign key to users", async () => {
    const { rows } = await store.pool.query(
      `select tc.table_name, kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name
          and kcu.constraint_schema = tc.constraint_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
          and ccu.constraint_schema = tc.constraint_schema
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'public'
          and ccu.table_schema = 'public'
          and ccu.table_name = 'users'
        order by tc.table_name, kcu.column_name`,
    );
    const found = rows.map((row) => `${row.table_name}.${row.column_name}`);
    expect(found.length).toBeGreaterThan(40);
    expect(found.filter((column) => !(column in USER_REFERENCES))).toEqual([]);
    expect(Object.keys(USER_REFERENCES).filter((column) => !found.includes(column))).toEqual([]);
  });

  it("refuses to leave a shared organisation without an administrator", async () => {
    const owner = await seedUser({ name: "Olga" });
    const colleague = await seedUser({ name: "Pavel" });
    const orgId = await seedOrg({ createdBy: owner });
    await join(orgId, owner);
    await makeAdmin(orgId, owner);

    // The only member: nobody is left behind, so nothing blocks the deletion (§1.3).
    await expect(store.accountDeletionBlockers(owner)).resolves.toEqual([]);

    await join(orgId, colleague);
    const blockers = await store.accountDeletionBlockers(owner);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ id: orgId, members: 1 });

    await expect(callDelete(owner)).rejects.toMatchObject({ code: "LAST_ORG_ADMIN" });
    const { rows: untouched } = await store.pool.query("select state from users where id = $1", [
      owner,
    ]);
    expect(untouched[0].state).toBe("active");

    // A second administrator removes the block without touching the deletion command.
    await makeAdmin(orgId, colleague, owner);
    await expect(store.accountDeletionBlockers(owner)).resolves.toEqual([]);
    await expect(callDelete(owner)).resolves.toMatchObject({ state: "deleting", changed: true });
  });

  it("stops the account now and ends every way back in", async () => {
    const userId = await seedUser();
    const orgId = await seedOrg({ createdBy: userId });
    await join(orgId, userId);
    const personal = await seedOrg({ kind: "personal", createdBy: userId, name: "Anna" });
    await join(personal, userId);
    await store.pool.query(
      `insert into subscriptions
         (org_id, plan, price_id, amount, currency, interval, status,
          current_period_start, current_period_end)
       values ($1, 'pro', 'pro-rub-month-v1', 0, 'RUB', 'month', 'active', now(),
               now() + interval '1 month')`,
      [personal],
    );
    const agentId = randomUUID();
    await store.pool.query(
      "insert into agents (id, org_id, owner_id, name) values ($1, $2, $3, 'Helper')",
      [agentId, orgId, userId],
    );
    await store.pool.query(
      `insert into agent_tokens (agent_id, token_hash, expires_at)
       values ($1, $2, now() + interval '1 day')`,
      [agentId, hash()],
    );
    await store.pool.query(
      `insert into sessions (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '1 day')`,
      [userId, hash()],
    );
    await store.pool.query(
      `insert into auth_tokens (user_id, purpose, token_hash, email, expires_at)
       values ($1, 'password_reset', $2, $3, now() + interval '1 hour')`,
      [userId, hash(), `del-${userId}@example.test`],
    );
    await store.pool.query(
      `insert into integration_tokens (org_id, owner_id, token_hash, scopes, expires_at)
       values ($1, $2, $3, array['board.read'], now() + interval '1 day')`,
      [orgId, userId, hash()],
    );

    const result = await callDelete(userId);
    expect(result.changed).toBe(true);
    expect(new Date(result.deletionRequestedAt).getTime()).toBeGreaterThan(
      Date.now() - 5 * 60_000,
    );

    const [{ rows: [user] }, { rows: sessions }, { rows: agentTokens }, { rows: integration }] =
      await Promise.all([
        store.pool.query("select state, deletion_requested_at from users where id = $1", [userId]),
        store.pool.query("select id from sessions where user_id = $1", [userId]),
        store.pool.query("select id from agent_tokens where agent_id = $1", [agentId]),
        store.pool.query("select id from integration_tokens where owner_id = $1", [userId]),
      ]);
    expect(user.state).toBe("deleting");
    expect(user.deletion_requested_at).toBeInstanceOf(Date);
    expect(sessions).toEqual([]);
    expect(agentTokens).toEqual([]);
    expect(integration).toEqual([]);

    const { rows: audit } = await store.pool.query(
      "select action from audit_events where actor_id = $1 and action = 'account.delete'",
      [userId],
    );
    expect(audit).toHaveLength(1);

    // The plan does not renew: the billing module's own flag and event, not a second way.
    const { rows: [subscription] } = await store.pool.query(
      "select cancel_at_period_end from subscriptions where org_id = $1",
      [personal],
    );
    expect(subscription.cancel_at_period_end).toBe(true);
    const { rows: events } = await store.pool.query(
      "select id from billing_events where org_id = $1 and type = 'subscription.canceled_at_period_end'",
      [personal],
    );
    expect(events).toHaveLength(1);
  });

  it("refuses a session that raced the stop, not only the rows it deleted", async () => {
    const userId = await seedUser();
    const tokenHash = hash();
    await store.pool.query(
      `insert into sessions (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '1 day')`,
      [userId, tokenHash],
    );
    expect(await store.findSession(tokenHash)).toMatchObject({ user_id: userId });

    await store.pool.query("update users set state = 'deleting' where id = $1", [userId]);
    expect(await store.findSession(tokenHash)).toBeNull();
  });

  it("turns the tombstone after fourteen days and keeps the organisation's history", async () => {
    const userId = await seedUser({ name: "Anna Petrova" });
    const other = await seedUser({ name: "Boris" });

    const personal = await seedOrg({ kind: "personal", createdBy: userId, name: "Anna" });
    await join(personal, userId);
    const personalBoard = await seedBoard(personal, userId);

    const shared = await seedOrg({ createdBy: other, name: "Studio" });
    await join(shared, userId);
    await makeAdmin(shared, userId);
    const ownedRoom = await seedBoard(shared, userId);
    const otherRoom = await seedBoard(shared, other, other);

    const threadId = randomUUID();
    await store.pool.query(
      `insert into comment_threads
         (id, board_id, org_id, anchor_kind, created_by, created_by_name)
       values ($1, $2, $3, 'point', $4, 'Anna Petrova')`,
      [threadId, ownedRoom, shared, userId],
    );
    await store.pool.query(
      `insert into comments
         (thread_id, board_id, org_id, author_id, author_name, author_handle, body)
       values ($1, $2, $3, $4, 'Anna Petrova', 'anna', 'hello')`,
      [threadId, ownedRoom, shared, userId],
    );
    await store.pool.query(
      "insert into comment_reads (thread_id, subject_id) values ($1, $2)",
      [threadId, `user:${userId}`],
    );
    await store.pool.query(
      `insert into board_grants (board_id, subject_type, subject_id, role, granted_by, org_id)
       values ($1, 'user', $2, 'viewer', $3, $4)`,
      [otherRoom, userId, other, shared],
    );
    await store.pool.query(
      "insert into consent_events (user_id, zone, choices, policy_version, user_agent, ip_hash) values ($1, 'eu', '{\"a\":true}'::jsonb, '1', 'Mozilla/5.0', 'hmac-digest')",
      [userId],
    );
    await store.pool.query(
      `insert into legal_acceptances
         (user_id, zone, doc, version, sha256, user_agent, ip_hash)
       values ($1, 'eu', 'terms', 1, $2, 'Mozilla/5.0', 'legal-digest')`,
      [userId, "d".repeat(64)],
    );
    await store.pool.query(
      `insert into mail_outbox (user_id, to_email, template, locale)
       values ($1, $2, 'password_reset', 'ru')`,
      [userId, `del-${userId}@example.test`],
    );
    const fileId = randomUUID();
    await store.pool.query(
      `insert into files
         (id, org_id, board_id, uploaded_by, sha256, mime, bytes, stored_bytes, width, height, variants)
       values ($1, $2, $3, $4, 'sha', 'image/png', 1, 1, 1, 1, '{}'::jsonb)`,
      [fileId, personal, personalBoard, userId],
    );

    // An address in the journal is personal data even when the row it names stays.
    await store.pool.query(
      "insert into audit_events (actor_id, action, subject) values ($1, 'auth.login', $2)",
      [userId, `del-${userId}@example.test`],
    );

    // The command is what puts the account in the queue; then the clock moves.
    await callDelete(userId);
    await backdate(userId, 15);
    const fileStore = { deleted: [], async delete(key) { this.deleted.push(key); } };
    const purged = await purgeJob(fileStore).runOnce();
    expect(purged).toBeGreaterThanOrEqual(1);

    const { rows: [user] } = await store.pool.query(
      `select email, name, handle, password_hash, support_id, theme, lang,
              email_verified_at, state
         from users where id = $1`,
      [userId],
    );
    expect(user.email).toBe(`deleted-${userId}@invalid`);
    expect(user.name).toBe("");
    expect(user.handle).toMatch(/^deleted-[0-9a-f]{24}$/);
    expect(user.password_hash).toBe("");
    expect(user.support_id).toBeNull();
    expect(user.theme).toBeNull();
    expect(user.lang).toBeNull();
    expect(user.email_verified_at).toBeNull();
    expect(user.state).toBe("deleted");

    // The personal organisation and its rooms are gone; the shared room stays, unowned.
    const { rows: personalOrgs } = await store.pool.query("select id from orgs where id = $1", [
      personal,
    ]);
    expect(personalOrgs).toEqual([]);
    const { rows: personalBoards } = await store.pool.query(
      "select id from boards where id = $1",
      [personalBoard],
    );
    expect(personalBoards).toEqual([]);
    const { rows: [room] } = await store.pool.query(
      "select owner_id from boards where id = $1",
      [ownedRoom],
    );
    expect(room.owner_id).toBeNull();
    expect((await store.pool.query("select id from boards where id = $1", [otherRoom])).rows).toHaveLength(1);

    // The person's name leaves the copies in content, not only the account row.
    const { rows: [comment] } = await store.pool.query(
      "select author_name, author_handle from comments where thread_id = $1",
      [threadId],
    );
    expect(comment).toEqual({ author_name: "", author_handle: "" });
    expect(
      (await store.pool.query("select created_by_name from comment_threads where id = $1", [threadId]))
        .rows[0].created_by_name,
    ).toBe("");
    expect(
      (await store.pool.query("select thread_id from comment_reads where subject_id = $1", [
        `user:${userId}`,
      ])).rows,
    ).toEqual([]);

    // The proof of a choice stays; the agent string goes; the keyed digest is not an address.
    const { rows: [consent] } = await store.pool.query(
      "select user_id, user_agent, ip_hash from consent_events where user_id = $1",
      [userId],
    );
    expect(consent).toEqual({ user_id: userId, user_agent: null, ip_hash: "hmac-digest" });

    // A legal acceptance is proof and stays; the address digest goes at once, not after
    // the retention period (ADR-256 §4).
    const { rows: [acceptance] } = await store.pool.query(
      `select user_id, doc, sha256, user_agent, ip_hash
         from legal_acceptances where user_id = $1`,
      [userId],
    );
    expect(acceptance).toEqual({
      user_id: userId,
      doc: "terms",
      sha256: "d".repeat(64),
      user_agent: null,
      ip_hash: null,
    });

    expect(
      (await store.pool.query("select id from mail_outbox where user_id = $1", [userId])).rows,
    ).toEqual([]);
    expect(
      (await store.pool.query("select id from board_grants where subject_id = $1", [userId])).rows,
    ).toEqual([]);
    expect(
      (await store.pool.query("select id from files where org_id = $1", [personal])).rows,
    ).toEqual([]);
    expect(fileStore.deleted).toEqual(
      FILE_VARIANTS.map((variant) => fileKey(personal, fileId, variant)),
    );

    const { rows: audit } = await store.pool.query(
      "select action from audit_events where action = 'account.purged' and subject = $1",
      [userId],
    );
    expect(audit).toHaveLength(1);

    // The journal keeps the row and its action; the address became the tombstone id.
    const { rows: loginAudit } = await store.pool.query(
      "select subject from audit_events where actor_id = $1 and action = 'auth.login'",
      [userId],
    );
    expect(loginAudit).toEqual([{ subject: userId }]);

    // The address is free again: a new account with the same e-mail is accepted.
    const fresh = randomUUID();
    await store.pool.query(
      `insert into users (id, email, password_hash, name, handle)
       values ($1, $2, 'x', 'New Person', $3)`,
      [fresh, `del-${userId}@example.test`, `fresh-${fresh.slice(0, 8)}`],
    );
    users.push(fresh);
    expect((await store.pool.query("select id from users where id = $1", [fresh])).rows).toHaveLength(1);
  });

  it("keeps a personal organisation that payment history pins, as an anonymous shell", async () => {
    const userId = await seedUser({ name: "Paying Person" });
    const personal = await seedOrg({ kind: "personal", createdBy: userId, name: "Paying Person" });
    await join(personal, userId);
    await seedBoard(personal, userId);
    await store.pool.query(
      `insert into billing_accounts (org_id, billing_email, billing_name)
       values ($1, 'payer@example.test', 'Paying Person')`,
      [personal],
    );
    await store.withTenant(personal, () =>
      store.pool.query(
        `insert into payment_methods
           (org_id, connection_id, ref_ciphertext, ref_nonce, ref_dek_wrapped, ref_dek_nonce,
            ref_kek_id, display, autopay_consent_at, autopay_consent_version, created_by)
         values ($1, $2, $3, $4, $5, $6, 'test-kek',
                 '{"kind":"card","last4":"4242"}'::jsonb, now(), 'v1', $7)`,
        [
          personal,
          randomUUID(),
          Buffer.from("ref"),
          Buffer.from("nonce"),
          Buffer.from("dek"),
          Buffer.from("dek-nonce"),
          userId,
        ],
      ),
    );

    await callDelete(userId);
    await backdate(userId, 15);
    await purgeJob().runOnce();

    const { rows: [org] } = await store.pool.query(
      "select name, slug from orgs where id = $1",
      [personal],
    );
    expect(org.name).toBe("");
    expect(org.slug).toBe(`deleted-${personal}`);
    const { rows: [billing] } = await store.pool.query(
      "select billing_email, billing_name from billing_accounts where org_id = $1",
      [personal],
    );
    expect(billing.billing_email).toBe(`deleted-${personal}@invalid`);
    expect(billing.billing_name).toBeNull();
    expect(
      (await store.pool.query("select id from boards where org_id = $1", [personal])).rows,
    ).toEqual([]);

    // The card is revoked, not forgotten: its display stays for the accounting history.
    const { rows: [card] } = await store.withTenant(personal, () =>
      store.pool.query("select state, display from payment_methods where org_id = $1", [personal]),
    );
    expect(card.state).toBe("revoked");
    expect(card.display).toEqual({ kind: "card", last4: "4242" });
  });

  it("never purges an account that is not in the queue", async () => {
    const active = await seedUser({ state: "active", deletingSince: new Date(Date.now() - 30 * DAY) });
    // The date alone does not matter: the state does.
    await purgeJob().runOnce();
    const { rows: [row] } = await store.pool.query("select state, email from users where id = $1", [
      active,
    ]);
    expect(row.state).toBe("active");
    expect(row.email).toBe(`del-${active}@example.test`);
  });

  describe("HTTP surface (ADR-257 §2)", () => {
    const password = "correct horse battery";

    async function registered(api) {
      const address = `del-http-${randomUUID()}@example.test`;
      const response = await api("POST", "/auth/register", {
        email: address,
        password,
        name: "Leaving Person",
      });
      expect(response.status).toBe(201);
      users.push(response.body.user.id);
      orgs.push(response.body.org.id);
      return { address, userId: response.body.user.id };
    }

    it("checks the password and the phrase, then stops the account and sends the link", async () => {
      const api = client();
      const { address, userId } = await registered(api);

      const wrong = await api("POST", "/account/delete", {
        password: "not the password",
        phrase: "delete",
      });
      expect(wrong.status).toBe(403);
      expect(wrong.body.error).toBe("INVALID_CREDENTIALS");

      // The account's language is unset, so the server answered in the request's default
      // (en) and the Russian phrase is the wrong one.
      const phrase = await api("POST", "/account/delete", {
        password,
        phrase: "удалить",
      });
      expect(phrase.status).toBe(422);
      expect(phrase.body.error).toBe("BAD_PHRASE");

      const accepted = await api("POST", "/account/delete", { password, phrase: "delete" });
      expect(accepted.status).toBe(202);
      const due = new Date(accepted.body.deletionAt).getTime();
      expect(due).toBeGreaterThan(Date.now() + 13 * DAY);
      expect(due).toBeLessThan(Date.now() + 15 * DAY);
      expect(accepted.body.restoreToken).toEqual(expect.any(String));

      // The account stops working at once, including the session that asked.
      expect((await api("GET", "/auth/me")).status).toBe(401);
      expect(
        (await client()("POST", "/auth/login", { email: address, password })).status,
      ).toBe(401);

      const { rows: [user] } = await store.pool.query(
        "select state, deletion_requested_at from users where id = $1",
        [userId],
      );
      expect(user.state).toBe("deleting");
      expect(new Date(user.deletion_requested_at).getTime()).toBeGreaterThan(Date.now() - 60_000);

      const { rows: tokens } = await store.pool.query(
        "select purpose, used_at from auth_tokens where user_id = $1",
        [userId],
      );
      expect(tokens).toEqual([{ purpose: "account_restore", used_at: null }]);

      const { rows: [letter] } = await store.pool.query(
        `select template, locale, sealed_ciphertext is not null as sealed
           from mail_outbox where user_id = $1 and template = 'account_deletion'`,
        [userId],
      );
      expect(letter).toEqual({ template: "account_deletion", locale: "en", sealed: true });
    });

    it("cancels inside the fourteen days and lets the password work again", async () => {
      const api = client();
      const { address, userId } = await registered(api);
      const deleted = await api("POST", "/account/delete", { password, phrase: "delete" });
      expect(deleted.status).toBe(202);

      const cancelled = await client()("POST", "/account/delete/cancel", {
        token: deleted.body.restoreToken,
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({ ok: true, state: "active", changed: true });

      const { rows: [user] } = await store.pool.query(
        "select state, deletion_requested_at from users where id = $1",
        [userId],
      );
      expect(user).toEqual({ state: "active", deletion_requested_at: null });
      expect(
        (await client()("POST", "/auth/login", { email: address, password })).status,
      ).toBe(200);
      expect(
        (await store.pool.query(
          "select action from audit_events where actor_id = $1 and action = 'account.delete_cancelled'",
          [userId],
        )).rows,
      ).toHaveLength(1);

      // A second click on the same link changes nothing and is not a second audit row.
      const again = await client()("POST", "/account/delete/cancel", {
        token: deleted.body.restoreToken,
      });
      expect(again.status).toBe(400);
      expect(again.body.error).toBe("TOKEN_INVALID");
    });

    it("refuses a cancellation after the fourteen days", async () => {
      const api = client();
      const { userId } = await registered(api);
      const deleted = await api("POST", "/account/delete", { password, phrase: "delete" });
      expect(deleted.status).toBe(202);
      await backdate(userId, 15);

      const cancelled = await client()("POST", "/account/delete/cancel", {
        token: deleted.body.restoreToken,
      });
      expect(cancelled.status).toBe(410);
      expect(cancelled.body.error).toBe("TOO_LATE");
      const { rows: [user] } = await store.pool.query("select state from users where id = $1", [
        userId,
      ]);
      expect(user.state).toBe("deleting");
    });

    it("refuses the last administrator of a shared organisation with other members", async () => {
      const api = client();
      const { userId } = await registered(api);
      const shared = await seedOrg({ createdBy: userId, name: "Shared Studio" });
      await join(shared, userId);
      await makeAdmin(shared, userId);
      const colleague = await seedUser({ name: "Colleague" });
      await join(shared, colleague);

      const blocked = await api("POST", "/account/delete", { password, phrase: "delete" });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("LAST_ADMIN");
      expect(blocked.body.orgs).toEqual([
        expect.objectContaining({ id: shared, name: "Shared Studio" }),
      ]);
      const { rows: [user] } = await store.pool.query("select state from users where id = $1", [
        userId,
      ]);
      expect(user.state).toBe("active");
    });
  });

  describe("operator path (ADR-257 §4)", () => {
    const silent = { log() {}, error() {} };

    async function seedOperator() {
      const operatorId = await seedUser({ name: "Operator" });
      await store.grantInstanceOperator({ email: `del-${operatorId}@example.test` });
      return operatorId;
    }

    async function auditFor(userId) {
      const { rows } = await store.pool.query(
        `select action, actor_id, subject, reason, actor_type
           from audit_events
          where subject = $1
            and action in ('account.delete_operator', 'account.purged')
          order by at, id`,
        [userId],
      );
      return rows;
    }

    it("refuses a caller without the role and writes nothing", async () => {
      const target = await seedUser();
      const stranger = await seedUser();
      await expect(
        deleteAccountAsOperator({ store, userId: target, actorId: stranger }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

      const { rows: [user] } = await store.pool.query(
        "select state from users where id = $1",
        [target],
      );
      expect(user.state).toBe("active");
      expect(await auditFor(target)).toEqual([]);
    });

    it("stops and erases now, naming the operator and the reason", async () => {
      const operator = await seedOperator();
      const target = await seedUser({ name: "Anna Petrova" });
      const personal = await seedOrg({ kind: "personal", createdBy: target, name: "Anna" });
      await join(personal, target);
      const room = await seedBoard(personal, target);
      const fileId = randomUUID();
      await store.pool.query(
        `insert into files
           (id, org_id, board_id, uploaded_by, sha256, mime, bytes, stored_bytes, width, height, variants)
         values ($1, $2, $3, $4, 'sha', 'image/png', 1, 1, 1, 1, '{}'::jsonb)`,
        [fileId, personal, room, target],
      );
      const fileStore = { deleted: [], async delete(key) { this.deleted.push(key); } };

      await expect(
        deleteAccountAsOperator({
          store,
          userId: target,
          actorId: operator,
          reason: "privacy request",
          purgeNow: true,
          fileStore,
          log: silent,
        }),
      ).resolves.toMatchObject({ state: "deleted", purged: true, alreadyDeleted: false });

      const { rows: [user] } = await store.pool.query(
        "select email, name, state from users where id = $1",
        [target],
      );
      expect(user).toEqual({
        email: `deleted-${target}@invalid`,
        name: "",
        state: "deleted",
      });
      expect(
        (await store.pool.query("select id from orgs where id = $1", [personal])).rows,
      ).toEqual([]);
      expect(
        (await store.pool.query("select id from boards where id = $1", [room])).rows,
      ).toEqual([]);
      expect(fileStore.deleted).toEqual(
        FILE_VARIANTS.map((variant) => fileKey(personal, fileId, variant)),
      );

      const audit = await auditFor(target);
      const operatorRows = audit.filter((row) => row.action === "account.delete_operator");
      expect(operatorRows).toHaveLength(1);
      expect(operatorRows[0]).toMatchObject({
        actor_id: operator,
        subject: target,
        reason: "privacy request",
        actor_type: "user",
      });
      const purgedRows = audit.filter((row) => row.action === "account.purged");
      expect(purgedRows).toHaveLength(1);
      expect(purgedRows[0]).toMatchObject({ actor_id: null, actor_type: "system" });

      // Repeating --now on the tombstone is ok and writes no second row.
      await expect(
        deleteAccountAsOperator({
          store,
          userId: target,
          actorId: operator,
          reason: "again",
          purgeNow: true,
          log: silent,
        }),
      ).resolves.toMatchObject({ state: "deleted", alreadyDeleted: true, purged: false });
      expect(await auditFor(target)).toHaveLength(audit.length);
    });

    it("refuses to leave a shared organisation without an administrator", async () => {
      const operator = await seedOperator();
      const target = await seedUser();
      const colleague = await seedUser({ name: "Colleague" });
      const shared = await seedOrg({ createdBy: target, name: "Shared Studio" });
      await join(shared, target);
      await makeAdmin(shared, target);
      await join(shared, colleague);

      const error = await deleteAccountAsOperator({
        store,
        userId: target,
        actorId: operator,
        purgeNow: true,
      }).catch((e) => e);
      expect(error).toMatchObject({ code: "LAST_ADMIN", status: 409 });
      expect(error.details.orgs).toEqual([
        expect.objectContaining({ id: shared, name: "Shared Studio", members: 1 }),
      ]);
      const { rows: [user] } = await store.pool.query(
        "select state from users where id = $1",
        [target],
      );
      expect(user.state).toBe("active");
      expect(await auditFor(target)).toEqual([]);
    });

    it("lets a dry run describe the account without writing", async () => {
      const operator = await seedOperator();
      const target = await seedUser();
      const personal = await seedOrg({ kind: "personal", createdBy: target, name: "Anna" });
      await join(personal, target);
      const room = await seedBoard(personal, target);
      const shared = await seedOrg({ createdBy: target, name: "Shared Studio" });
      await join(shared, target);

      const preview = await deleteAccountAsOperator({
        store,
        userId: target,
        actorId: operator,
        dryRun: true,
      });
      expect(preview).toMatchObject({ dryRun: true, blocked: false });
      expect(preview.summary.user.state).toBe("active");
      expect(preview.summary.rooms).toEqual([
        expect.objectContaining({ id: room, title: "Room" }),
      ]);
      expect(preview.summary.sharedOrgs).toEqual([
        expect.objectContaining({ id: shared, name: "Shared Studio" }),
      ]);

      const { rows: [user] } = await store.pool.query(
        "select state from users where id = $1",
        [target],
      );
      expect(user.state).toBe("active");
      expect(await auditFor(target)).toEqual([]);
    });
  });
});
