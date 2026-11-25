/**
 * The consent journal against a real database (ADR-255 §4).
 *
 * Proves what the unit test cannot: schema 29 exists with the requested columns, the
 * table stays outside tenant RLS like `users` and `sessions`, two accounts' rows are read
 * apart, deleting an account removes its proof, and `POST /consent` writes one row per
 * change for a signed-in person.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POLICY_VERSION } from "@remo/consent";
import { handleConsentRoutes } from "./consent-api.mjs";
import { hashToken } from "./iam.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const opened = await testDatabaseStore("consent journal");
const store = opened?.store ?? null;
const suite = store ? describe : describe.skip;

const anna = randomUUID();
const boris = randomUUID();
const tokenAnna = `consent-token-anna-${randomUUID()}`;
const tokenBoris = `consent-token-boris-${randomUUID()}`;

function response() {
  const headers = new Map();
  return {
    status: 0,
    body: "",
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    writeHead(status, values = {}) {
      this.status = status;
      for (const [name, value] of Object.entries(values)) {
        headers.set(name.toLowerCase(), value);
      }
    },
    end(body) {
      this.body = body;
    },
    cookie() {
      const value = headers.get("set-cookie");
      const line = Array.isArray(value) ? value[0] : value;
      return line?.split(";")[0] ?? null;
    },
    json() {
      return this.body ? JSON.parse(this.body) : null;
    },
  };
}

function request({ cookie, body }) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method: "POST",
    headers: { cookie, "user-agent": "consent-db-test" },
    socket: { remoteAddress: "198.51.100.9" },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

async function post(cookie, choices) {
  const out = response();
  const handled = await handleConsentRoutes({
    request: request({
      cookie,
      body: { zone: "eu", choices, policyVersion: POLICY_VERSION },
    }),
    response: out,
    url: new URL("http://sync.test/consent"),
    store,
    zone: "eu",
    secure: false,
    log: { error() {} },
  });
  return { handled, out };
}

async function count(userId) {
  const { rows } = await store.pool.query(
    "select count(*)::int as total from consent_events where user_id = $1",
    [userId],
  );
  return rows[0].total;
}

suite("db:consent (ADR-255 §4)", () => {
  beforeAll(async () => {
    for (const [id, tag, token] of [
      [anna, "anna", tokenAnna],
      [boris, "boris", tokenBoris],
    ]) {
      await store.pool.query(
        `insert into users (id, email, password_hash, name, handle)
         values ($1, $2, 'x', $3, $4)`,
        [id, `consent-${tag}-${id}@example.test`, tag, `consent-${tag}-${id.slice(0, 8)}`],
      );
      await store.createSession({
        userId: id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        userAgent: "consent-db-test",
      });
    }
  });

  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from users where id = any($1::uuid[])", [[anna, boris]]);
    await store.close();
  });

  it("applies schema 29 with the consent journal and no tenant RLS", async () => {
    const { rows: meta } = await store.pool.query(
      "select version from schema_meta where id = 1",
    );
    expect(meta[0].version).toBe(40);

    const { rows: columns } = await store.pool.query(
      `select column_name, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'consent_events'
        order by ordinal_position`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      "id",
      "user_id",
      "zone",
      "choices",
      "policy_version",
      "user_agent",
      "ip_hash",
      "created_at",
    ]);
    expect(columns.find((row) => row.column_name === "user_id").is_nullable).toBe("YES");

    const { rows: index } = await store.pool.query(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'consent_events'`,
    );
    expect(index.map((row) => row.indexname)).toContain("consent_events_user_idx");

    const { rows: policy } = await store.pool.query(
      `select relrowsecurity, relforcerowsecurity from pg_class where relname = 'consent_events'`,
    );
    // Global identity, like `users` and `sessions`: no tenant policy to switch on.
    expect(policy[0]).toMatchObject({ relrowsecurity: false, relforcerowsecurity: false });
  });

  it("writes one row per change for a signed-in person, keyed to that account", async () => {
    const annaCookie = `remo_session=${tokenAnna}`;

    const first = await post(annaCookie, { analytics: true });
    expect(first.handled).toBe(true);
    expect(first.out.status).toBe(200);
    expect(first.out.cookie()).toBe(`remo_consent=v1.eu.${POLICY_VERSION}.a`);
    expect(await count(anna)).toBe(1);

    // The same choice from another tab is not a second decision.
    await post(annaCookie, { analytics: true });
    expect(await count(anna)).toBe(1);

    await post(annaCookie, { analytics: true, marketing: true });
    expect(await count(anna)).toBe(2);

    const latest = await store.latestConsentEvent(anna);
    expect(latest).toMatchObject({
      user_id: anna,
      zone: "eu",
      choices: { analytics: true, marketing: true },
      policy_version: POLICY_VERSION,
      user_agent: "consent-db-test",
      // No KEK in the test environment: a digest would be a rainbow-table hash, so null.
      ip_hash: null,
    });
  });

  it("shows one account nothing of another", async () => {
    await post(`remo_session=${tokenBoris}`, { marketing: true });

    const a = await store.latestConsentEvent(anna);
    const b = await store.latestConsentEvent(boris);
    expect(a.user_id).toBe(anna);
    expect(a.choices).toEqual({ analytics: true, marketing: true });
    expect(b.user_id).toBe(boris);
    expect(b.choices).toEqual({ analytics: false, marketing: true });
    expect(await count(anna)).toBe(2);
    expect(await count(boris)).toBe(1);
  });

  it("keeps a choice from becoming a guest row", async () => {
    const guest = await post("", { analytics: true });
    expect(guest.out.status).toBe(200);
    expect(guest.out.cookie()).toBe(`remo_consent=v1.eu.${POLICY_VERSION}.a`);
    const { rows } = await store.pool.query(
      "select count(*)::int as total from consent_events where user_id is null",
    );
    expect(rows[0].total).toBe(0);
  });

  it("removes the journal with the account", async () => {
    await store.pool.query("delete from users where id = $1", [boris]);
    const { rows } = await store.pool.query(
      "select count(*)::int as total from consent_events where user_id = $1",
      [boris],
    );
    expect(rows[0].total).toBe(0);
  });
});
