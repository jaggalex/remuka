/**
 * Enrolment, recovery codes and turning the factor off through the account routes
 * (ADR-260, `spec/totp.md` §4, §7).
 *
 * The store tests prove the tables; this file proves the screen's contract: the secret is
 * returned once and never by a read, a wrong password or code changes nothing, confirming
 * ends the other sessions, and an operator cannot switch the factor off under the role.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetFailures } from "./attempts.mjs";
import { handleIam } from "./iam-api.mjs";
import { hashRecoveryCode, totpCode, totpStep } from "./mfa.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("mfa routes");
const store = database?.store ?? null;
const reachable = store !== null;
const suite = reachable ? describe : describe.skip;

const KEK = { key: Buffer.alloc(32, 22), id: "test" };
const OLD_KEK = process.env.REMO_KEK;
const OLD_KEK_ID = process.env.REMO_KEK_ID;
const PASSWORD = "correct horse battery";
const email = () => `mfa-routes-${randomUUID()}@example.test`;
let server = null;
let base = "";

beforeAll(async () => {
  if (!reachable) return;
  process.env.REMO_KEK = KEK.key.toString("base64");
  process.env.REMO_KEK_ID = KEK.id;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (await handleIam({ request, response, url, store })) return;
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not handled in this test" }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (store) {
    // The run owns its database (`testDatabaseStore`), exactly like the IAM API suite:
    // registration creates organisations whose creator reference keeps the user rows.
    await store.close();
  }
  if (OLD_KEK === undefined) delete process.env.REMO_KEK;
  else process.env.REMO_KEK = OLD_KEK;
  if (OLD_KEK_ID === undefined) delete process.env.REMO_KEK_ID;
  else process.env.REMO_KEK_ID = OLD_KEK_ID;
});

beforeEach(() => resetFailures());

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
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };
}

async function register(tag) {
  const api = client();
  const address = email();
  const created = await api("POST", "/auth/register", {
    email: address,
    password: PASSWORD,
    name: tag,
  });
  expect(created.status).toBe(201);
  return { api, id: created.body.user.id, email: address };
}

/** Pretend the code for the previous step was the last one spent: only time moves this. */
async function rewindStep(userId) {
  await store.pool.query(
    "update user_mfa set last_step = last_step - 1 where user_id = $1",
    [userId],
  );
}

suite("the second factor's account routes", () => {
  it("returns the secret once, never from a read, and only after the password", async () => {
    const person = await register("Routes");
    expect((await person.api("POST", "/account/mfa/begin", { password: "wrong" })).status).toBe(403);

    const begun = await person.api("POST", "/account/mfa/begin", { password: PASSWORD });
    expect(begun.status).toBe(200);
    expect(begun.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(begun.body.uri).toMatch(/^otpauth:\/\/totp\//);
    // The secret must not be stored by a proxy or the browser (`spec/operator-actions.md` §2).
    expect(begun.headers.get("cache-control")).toBe("no-store");

    const status = await person.api("GET", "/account/mfa");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enrolled: false, pending: true, recoveryLeft: 0 });
    expect(JSON.stringify(status.body)).not.toContain(begun.body.secret);
    expect(JSON.stringify(status.body)).not.toContain("otpauth://");

    const wrong = await person.api("POST", "/account/mfa/confirm", { code: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("MFA_INVALID");

    const confirmed = await person.api("POST", "/account/mfa/confirm", {
      code: totpCode(begun.body.secret, totpStep(new Date())),
    });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.recoveryCodes).toHaveLength(10);
    expect(confirmed.headers.get("cache-control")).toBe("no-store");

    const after = await person.api("GET", "/account/mfa");
    expect(after.body).toMatchObject({ enrolled: true, pending: false, recoveryLeft: 10 });
    expect(JSON.stringify(after.body)).not.toContain(begun.body.secret);

    const { rows } = await store.pool.query(
      "select action from audit_events where subject = $1 and action = 'mfa.enabled'",
      [person.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("ends every other session when the factor is confirmed", async () => {
    const person = await register("Other sessions");
    const elsewhere = client();
    const second = await elsewhere("POST", "/auth/login", {
      email: person.email,
      password: PASSWORD,
    });
    expect(second.status).toBe(200);

    const begun = await person.api("POST", "/account/mfa/begin", { password: PASSWORD });
    await person.api("POST", "/account/mfa/confirm", {
      code: totpCode(begun.body.secret, totpStep(new Date())),
    });
    expect((await person.api("GET", "/auth/me")).status).toBe(200);
    expect((await elsewhere("GET", "/auth/me")).status).toBe(401);

    const { rows } = await store.pool.query(
      "select mfa_at from sessions where user_id = $1 and revoked_at is null",
      [person.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].mfa_at).toBeTruthy();
  });

  it("replaces the recovery codes only with a code, and the old list stops working", async () => {
    const person = await register("Recovery");
    const begun = await person.api("POST", "/account/mfa/begin", { password: PASSWORD });
    const confirmed = await person.api("POST", "/account/mfa/confirm", {
      code: totpCode(begun.body.secret, totpStep(new Date())),
    });
    const oldCode = confirmed.body.recoveryCodes[0];

    const refused = await person.api("POST", "/account/mfa/recovery", { code: "000000" });
    expect(refused.status).toBe(401);

    await rewindStep(person.id);
    const fresh = await person.api("POST", "/account/mfa/recovery", {
      code: totpCode(begun.body.secret, totpStep(new Date())),
    });
    expect(fresh.status).toBe(201);
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect(await store.verifyMfaRecoveryCode({ userId: person.id, code: oldCode })).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
    expect(
      await store.pool.query(
        "select 1 from user_mfa_recovery_codes where user_id = $1 and code_hash = $2",
        [person.id, hashRecoveryCode(oldCode)],
      ),
    ).toHaveProperty("rowCount", 0);
  });

  it("refuses to switch the factor off while the operator role is held", async () => {
    const person = await register("Role");
    const begun = await person.api("POST", "/account/mfa/begin", { password: PASSWORD });
    await person.api("POST", "/account/mfa/confirm", {
      code: totpCode(begun.body.secret, totpStep(new Date())),
    });

    await store.pool.query("insert into instance_operators (user_id, granted_by) values ($1, $1)", [
      person.id,
    ]);
    await rewindStep(person.id);
    const refused = await person.api("POST", "/account/mfa/disable", {
      code: totpCode(begun.body.secret, totpStep(new Date())),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("MFA_OPERATOR_ROLE");

    await store.pool.query("delete from instance_operators where user_id = $1", [person.id]);
    await rewindStep(person.id);
    const off = await person.api("POST", "/account/mfa/disable", {
      code: totpCode(begun.body.secret, totpStep(new Date())),
    });
    expect(off.status).toBe(200);
    expect((await person.api("GET", "/account/mfa")).body).toMatchObject({
      enrolled: false,
      pending: false,
    });

    const { rows } = await store.pool.query(
      "select action from audit_events where subject = $1 and action = 'mfa.disabled'",
      [person.id],
    );
    expect(rows).toHaveLength(1);
  });
});
