/**
 * The second step of sign-in against a real database (ADR-260, `spec/totp.md` §5).
 *
 * What the pure test cannot show: a correct password really creates no session, the
 * challenge row holds only a digest, the session a code opens carries `mfa_at`, a code
 * cannot be spent twice, and a recovery code is single-use. The codes come from the same
 * RFC 6238 functions the server uses, at a step the seeded factor has not consumed.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetFailures } from "./attempts.mjs";
import { hashPassword } from "./iam.mjs";
import { handleIam } from "./iam-api.mjs";
import { totpCode, totpStep } from "./mfa.mjs";
import { testDatabaseStore } from "./test-db.mjs";

const database = await testDatabaseStore("mfa login");
const store = database?.store ?? null;
const reachable = store !== null;
const suite = reachable ? describe : describe.skip;

const KEK = { key: Buffer.alloc(32, 21), id: "test" };
const OLD_KEK = process.env.REMO_KEK;
const OLD_KEK_ID = process.env.REMO_KEK_ID;
const PASSWORD = "correct horse battery";
const users = [];
let server = null;
let base = "";

beforeAll(async () => {
  if (!reachable) return;
  // The routes read the key from the environment, like every other sealed secret.
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
    await store.pool.query("delete from audit_events where subject = any($1::text[])", [users]);
    await store.pool.query("delete from users where id = any($1::uuid[])", [users]);
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

/**
 * A confirmed factor whose last consumed step is the previous one, so the current step is
 * free for the sign-in that follows. Seeded through the store, not the route, because only
 * time can put `last_step` behind: the route always confirms "now".
 */
async function enrolledUser() {
  const id = randomUUID();
  const address = `mfa-login-${id}@example.test`;
  await store.pool.query(
    `insert into users (id, email, password_hash, name, handle, email_verified_at)
     values ($1, $2, $3, 'Second factor', $4, now())`,
    [id, address, await hashPassword(PASSWORD), `mfa-${id.slice(0, 8)}`],
  );
  users.push(id);
  const started = await store.beginMfaEnrollment({
    userId: id,
    kek: KEK,
    issuer: "Remuka (EU)",
    account: address,
  });
  const confirmed = await store.confirmMfaEnrollment({
    userId: id,
    code: totpCode(started.secret, totpStep(Date.now() - 30_000)),
    kek: KEK,
    now: new Date(Date.now() - 30_000),
  });
  return { id, email: address, secret: started.secret, recoveryCodes: confirmed.recoveryCodes };
}

async function signIn(person) {
  const api = client();
  const login = await api("POST", "/auth/login", { email: person.email, password: PASSWORD });
  return { api, login };
}

suite("second-factor sign-in", () => {
  it("answers a correct password with a challenge and no session", async () => {
    const person = await enrolledUser();
    const { api, login } = await signIn(person);
    expect(login.status).toBe(202);
    expect(login.body.mfaRequired).toBe(true);
    expect(typeof login.body.challenge).toBe("string");
    expect(login.headers.get("set-cookie")).toBeNull();
    expect((await api("GET", "/auth/me")).status).toBe(401);

    const { rows } = await store.pool.query(
      "select token_hash, purpose from mfa_challenges where user_id = $1",
      [person.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("login");
    // The row holds a digest, never the token that was handed out.
    expect(Buffer.from(rows[0].token_hash).toString("hex")).not.toContain(login.body.challenge);
  });

  it("refuses a wrong code without a cookie, then opens the session with a fresh one", async () => {
    const person = await enrolledUser();
    const { api, login } = await signIn(person);

    const wrong = await api("POST", "/auth/login/mfa", {
      challenge: login.body.challenge,
      code: "000000",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("MFA_INVALID");
    expect(wrong.headers.get("set-cookie")).toBeNull();

    const right = await api("POST", "/auth/login/mfa", {
      challenge: login.body.challenge,
      code: totpCode(person.secret, totpStep(new Date())),
    });
    expect(right.status).toBe(200);
    expect(right.body.user.email).toBe(person.email);
    expect(right.headers.get("set-cookie")).toContain("remo_session=");
    expect((await api("GET", "/auth/me")).status).toBe(200);

    const sessions = await store.pool.query(
      "select mfa_at from sessions where user_id = $1 and revoked_at is null",
      [person.id],
    );
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0].mfa_at).toBeTruthy();

    const { rows: audit } = await store.pool.query(
      "select action from audit_events where subject = $1 and action like 'mfa.%'",
      [person.email],
    );
    expect(audit.map((row) => row.action)).toContain("mfa.login");

    // The same code again, on a new challenge, is a replay: one code, one sign-in.
    const second = await signIn(person);
    const replay = await second.api("POST", "/auth/login/mfa", {
      challenge: second.login.body.challenge,
      code: totpCode(person.secret, totpStep(new Date())),
    });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe("MFA_INVALID");
  });

  it("spends a recovery code once and writes the audit row with the remainder", async () => {
    const person = await enrolledUser();
    const { api, login } = await signIn(person);
    const used = await api("POST", "/auth/login/mfa", {
      challenge: login.body.challenge,
      recoveryCode: person.recoveryCodes[0],
    });
    expect(used.status).toBe(200);
    expect(used.body.recoveryLeft).toBe(9);

    const { rows } = await store.pool.query(
      "select after from audit_events where subject = $1 and action = 'mfa.recovery_used'",
      [person.email],
    );
    expect(rows[0]?.after).toEqual({ remaining: 9 });

    const again = await signIn(person);
    const reused = await again.api("POST", "/auth/login/mfa", {
      challenge: again.login.body.challenge,
      recoveryCode: person.recoveryCodes[0],
    });
    expect(reused.status).toBe(401);
  });

  it("ends a challenge after five wrong codes and locks the account after ten in an hour", async () => {
    const person = await enrolledUser();
    const { api, login } = await signIn(person);
    let challenge = login.body.challenge;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await api("POST", "/auth/login/mfa", { challenge, code: "000000" });
      if (attempt < 4) expect(wrong.status).toBe(401);
      else expect(wrong.status).toBe(429);
    }
    // The challenge is gone; the token cannot be retried.
    const gone = await api("POST", "/auth/login/mfa", { challenge, code: "000000" });
    expect(gone.status).toBe(401);
    expect(gone.body.error).toBe("MFA_INVALID");

    // Four wrong answers are counted, then a second challenge spends the remaining six.
    challenge = (await api("POST", "/auth/login", { email: person.email, password: PASSWORD })).body
      .challenge;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await api("POST", "/auth/login/mfa", { challenge, code: "000000" });
    }
    challenge = (await api("POST", "/auth/login", { email: person.email, password: PASSWORD })).body
      .challenge;
    const locked = await api("POST", "/auth/login/mfa", { challenge, code: "000000" });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe("MFA_LOCKED");

    const { rows } = await store.pool.query(
      "select action from audit_events where subject = $1 and action = 'mfa.locked'",
      [person.id],
    );
    expect(rows).toHaveLength(1);

    // The password still works — the lock closes codes, not the account.
    const password = await api("POST", "/auth/login", { email: person.email, password: PASSWORD });
    expect(password.status).toBe(202);
  });
});
