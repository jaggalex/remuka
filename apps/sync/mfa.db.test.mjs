import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMfaReset } from "../../scripts/mfa-reset.mjs";
import {
  CLI_MFA_ATTEMPTS,
  CLI_MFA_LOCK_MS,
  assertOperatorCliMfa,
} from "./operator-cli-mfa.mjs";
import { totpCode, totpStep } from "./mfa.mjs";
import { testDatabaseStore } from "./test-db.mjs";

/**
 * The second factor against a real database (ADR-260, `spec/totp.md` §3, §7).
 *
 * What a unit test cannot show: the secret is not readable without the KEK, the step is
 * consumed exactly once under the database's own lock, a recovery code is single-use, and
 * `mfa:reset` leaves neither a secret nor a session behind.
 */
const opened = await testDatabaseStore("mfa");
const store = opened?.store ?? null;

const KEK = { key: Buffer.alloc(32, 13), id: "test" };
const OTHER_KEK = { key: Buffer.alloc(32, 14), id: "test" };
const users = [];

async function seedUser({ email } = {}) {
  const id = randomUUID();
  const address = email ?? `mfa-${id}@example.test`;
  await store.pool.query(
    `insert into users (id, email, password_hash, name, handle, email_verified_at)
     values ($1, $2, 'x', 'Second factor', $3, now())`,
    [id, address, `mfa-${id.slice(0, 8)}`],
  );
  users.push(id);
  return { id, email: address };
}

async function seedSession(userId) {
  const { rows } = await store.pool.query(
    `insert into sessions (user_id, token_hash, expires_at)
     values ($1, $2, now() + interval '1 day')
     returning id`,
    [userId, randomBytes(24)],
  );
  return rows[0].id;
}

describe.skipIf(!store)("second factor (ADR-260)", () => {
  beforeAll(async () => {
    const { rows } = await store.pool.query("select version from schema_meta where id = 1");
    expect(rows[0].version).toBe(40);
  });

  afterAll(async () => {
    if (!store) return;
    await store.pool.query("delete from audit_events where subject = any($1::text[])", [users]);
    await store.pool.query("delete from users where id = any($1::uuid[])", [users]);
    await store.close();
  });

  it("seals the secret so the row holds no readable key and only the KEK opens it", async () => {
    const person = await seedUser();
    const started = await store.beginMfaEnrollment({
      userId: person.id,
      kek: KEK,
      issuer: "Remuka (EU)",
      account: person.email,
    });
    expect(started.started).toBe(true);
    expect(started.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(decodeURIComponent(new URL(started.uri).searchParams.get("issuer"))).toBe("Remuka (EU)");

    const { rows } = await store.pool.query(
      `select secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce, kek_id
         from user_mfa where user_id = $1`,
      [person.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].secret_ciphertext.toString("utf8")).not.toContain(started.secret);
    expect(rows[0].secret_dek_wrapped).toBeTruthy();
    expect(rows[0].kek_id).toBe("test");

    // The envelope is bound to the account: the same code cannot be verified with another
    // key, and the failure is a decryption failure rather than a wrong code.
    const step = totpStep(new Date());
    expect(
      await store.confirmMfaEnrollment({
        userId: person.id,
        code: totpCode(started.secret, step),
        kek: KEK,
      }),
    ).toMatchObject({ ok: true });
    await expect(
      store.verifyMfaCode({
        userId: person.id,
        code: totpCode(started.secret, step + 1),
        kek: OTHER_KEK,
        now: new Date(Date.now() + 30_000),
      }),
    ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("confirms only after a code, issues ten codes once and refuses a second confirmation", async () => {
    const person = await seedUser();
    expect(await store.mfaStatus(person.id)).toEqual({
      enrolled: false,
      pending: false,
      confirmedAt: null,
      recoveryLeft: 0,
    });

    const started = await store.beginMfaEnrollment({
      userId: person.id,
      kek: KEK,
      issuer: "Remuka (EU)",
      account: person.email,
    });
    // Pending, not enrolled: nobody can sign in with half a factor.
    expect(await store.mfaStatus(person.id)).toMatchObject({ enrolled: false, pending: true });

    const now = new Date("2026-11-23T10:00:00Z");
    const step = totpStep(now);
    const confirmed = await store.confirmMfaEnrollment({
      userId: person.id,
      code: totpCode(started.secret, step),
      kek: KEK,
      now,
    });
    expect(confirmed.ok).toBe(true);
    expect(confirmed.recoveryCodes).toHaveLength(10);

    const status = await store.mfaStatus(person.id);
    expect(status.enrolled).toBe(true);
    expect(status.recoveryLeft).toBe(10);

    const again = await store.confirmMfaEnrollment({
      userId: person.id,
      code: totpCode(started.secret, step),
      kek: KEK,
      now,
    });
    expect(again).toEqual({ ok: false, reason: "already_enabled" });

    // A confirmed factor is never replaced by a new enrolment.
    expect(
      await store.beginMfaEnrollment({
        userId: person.id,
        kek: KEK,
        issuer: "Remuka (EU)",
        account: person.email,
      }),
    ).toEqual({ started: false, reason: "already_enabled" });
  });

  it("consumes the step exactly once and accepts the next one", async () => {
    const person = await seedUser();
    const started = await store.beginMfaEnrollment({
      userId: person.id,
      kek: KEK,
      issuer: "Remuka (EU)",
      account: person.email,
    });
    const start = new Date("2026-11-23T11:00:00Z");
    const step = totpStep(start);
    await store.confirmMfaEnrollment({
      userId: person.id,
      code: totpCode(started.secret, step),
      kek: KEK,
      now: start,
    });

    const late = new Date(start.getTime() + 30_000);
    const first = await store.verifyMfaCode({
      userId: person.id,
      code: totpCode(started.secret, step + 1),
      kek: KEK,
      now: late,
    });
    expect(first).toEqual({ ok: true, step: step + 1 });

    const replayed = await store.verifyMfaCode({
      userId: person.id,
      code: totpCode(started.secret, step + 1),
      kek: KEK,
      now: late,
    });
    expect(replayed).toEqual({ ok: false, reason: "replayed", step: step + 1 });

    // The code used at confirmation is refused too: it is behind `last_step` for ever.
    const old = await store.verifyMfaCode({
      userId: person.id,
      code: totpCode(started.secret, step),
      kek: KEK,
      now: late,
    });
    expect(old).toMatchObject({ ok: false, reason: "replayed" });
  });

  it("spends a recovery code once and reports how many are left", async () => {
    const person = await seedUser();
    const started = await store.beginMfaEnrollment({
      userId: person.id,
      kek: KEK,
      issuer: "Remuka (EU)",
      account: person.email,
    });
    const step = totpStep(new Date());
    const confirmed = await store.confirmMfaEnrollment({
      userId: person.id,
      code: totpCode(started.secret, step),
      kek: KEK,
    });
    const code = confirmed.recoveryCodes[0];

    expect(await store.verifyMfaRecoveryCode({ userId: person.id, code })).toEqual({
      ok: true,
      remaining: 9,
    });
    expect(await store.verifyMfaRecoveryCode({ userId: person.id, code })).toEqual({
      ok: false,
      reason: "used",
    });
    expect(
      await store.verifyMfaRecoveryCode({ userId: person.id, code: "AAAAA-AAAAA" }),
    ).toMatchObject({ ok: false, reason: "mismatch" });
    expect(await store.mfaRecoveryCodesLeft(person.id)).toBe(9);

    // Regeneration invalidates the old list in the same transaction that writes the new.
    const fresh = await store.issueRecoveryCodes({ userId: person.id });
    expect(fresh).toHaveLength(10);
    expect(await store.verifyMfaRecoveryCode({ userId: person.id, code })).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
    expect(await store.verifyMfaRecoveryCode({ userId: person.id, code: fresh[0] })).toEqual({
      ok: true,
      remaining: 9,
    });
  });

  it("ends a challenge after five wrong answers", async () => {
    const person = await seedUser();
    const tokenHash = randomBytes(32);
    const challenge = await store.createMfaChallenge({
      userId: person.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    expect(await store.findMfaChallenge(tokenHash)).toMatchObject({
      id: challenge.id,
      user_id: person.id,
      attempts: 0,
    });
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(await store.failMfaChallenge(challenge.id)).toEqual({ attempts: attempt, deleted: false });
    }
    expect(await store.failMfaChallenge(challenge.id)).toEqual({ attempts: 5, deleted: true });
    expect(await store.findMfaChallenge(tokenHash)).toBeNull();
  });

  it("records the code in the session, for step-up", async () => {
    const person = await seedUser();
    const sessionId = await seedSession(person.id);
    const at = new Date("2026-11-23T12:00:00Z");
    await store.setSessionMfaAt(sessionId, at);
    const { rows } = await store.pool.query("select mfa_at from sessions where id = $1", [
      sessionId,
    ]);
    expect(rows[0].mfa_at.toISOString()).toBe(at.toISOString());
  });

  it("mfa:reset removes the factor, the codes, the challenges and every session", async () => {
    const person = await seedUser();
    const admin = await seedUser();
    await store.pool.query("insert into instance_operators (user_id) values ($1)", [admin.id]);
    const started = await store.beginMfaEnrollment({
      userId: person.id,
      kek: KEK,
      issuer: "Remuka (EU)",
      account: person.email,
    });
    const step = totpStep(new Date());
    await store.confirmMfaEnrollment({
      userId: person.id,
      code: totpCode(started.secret, step),
      kek: KEK,
    });
    await store.createMfaChallenge({
      userId: person.id,
      tokenHash: randomBytes(32),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    await seedSession(person.id);
    await seedSession(person.id);

    const result = await runMfaReset({
      argv: ["--email", person.email, "--reason", "lost the phone", "--as", admin.email],
      store,
      out: () => {},
      err: () => {},
    });
    expect(result).toBe(0);

    expect(await store.mfaStatus(person.id)).toMatchObject({ enrolled: false, pending: false });
    const { rows: counts } = await store.pool.query(
      `select
         (select count(*)::int from user_mfa where user_id = $1) as secrets,
         (select count(*)::int from user_mfa_recovery_codes where user_id = $1) as codes,
         (select count(*)::int from mfa_challenges where user_id = $1) as challenges,
         (select count(*)::int from sessions
           where user_id = $1 and revoked_at is null) as sessions`,
      [person.id],
    );
    expect(counts[0]).toEqual({ secrets: 0, codes: 0, challenges: 0, sessions: 0 });

    const { rows: audit } = await store.pool.query(
      `select action, reason, actor_id from audit_events
        where subject = $1 and action = 'mfa.reset'`,
      [person.id],
    );
    expect(audit).toEqual([
      { action: "mfa.reset", reason: "lost the phone", actor_id: admin.id },
    ]);
  });
  it("removes an enrolment nobody proved and a challenge past its time", async () => {
    const person = await seedUser();
    // One pending enrolment from two days ago: not a factor yet.
    await store.pool.query(
      `insert into user_mfa
         (user_id, secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce,
          kek_id, created_at)
       values ($1, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea,
               'test', now() - interval '2 days')`,
      [person.id],
    );
    const fresh = await seedUser();
    await store.pool.query(
      `insert into user_mfa
         (user_id, secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce,
          kek_id)
       values ($1, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'test')`,
      [fresh.id],
    );
    await store.createMfaChallenge({
      userId: person.id,
      tokenHash: randomBytes(32),
      expiresAt: new Date(Date.now() - 60_000),
    });
    await store.createMfaChallenge({
      userId: fresh.id,
      tokenHash: randomBytes(32),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });

    const purged = await store.purgeExpiredMfa({ unconfirmedBefore: new Date(Date.now() - 86_400_000) });
    expect(purged.unconfirmed).toBe(1);
    expect(purged.challenges).toBe(1);
    const { rows } = await store.pool.query(
      `select (select count(*)::int from user_mfa where user_id = $1) as old_rows,
              (select count(*)::int from user_mfa where user_id = $2) as fresh_rows,
              (select count(*)::int from mfa_challenges where user_id = $2) as live_challenges`,
      [person.id, fresh.id],
    );
    expect(rows[0]).toEqual({ old_rows: 0, fresh_rows: 1, live_challenges: 1 });
  });

  /* -------------------------------------- shell failures (D1, schema 39) -- */

  it("keeps shell failures in the database and clears them on a correct code", async () => {
    const person = await seedUser();
    const started = await store.beginMfaEnrollment({
      userId: person.id,
      kek: KEK,
      issuer: "Remuka (EU)",
      account: person.email,
    });
    const t0 = new Date("2026-11-23T12:00:00Z");
    await store.confirmMfaEnrollment({
      userId: person.id,
      code: totpCode(started.secret, totpStep(t0)),
      kek: KEK,
      now: t0,
    });

    const attempt = (seconds, code) =>
      assertOperatorCliMfa({
        store,
        actor: person,
        code,
        env: {},
        kek: KEK,
        now: () => new Date(t0.getTime() + seconds * 1000),
      });

    for (let index = 0; index < CLI_MFA_ATTEMPTS; index += 1) {
      const failure = await attempt(index, "000000").catch((error) => error);
      expect(failure.code).toBe(index < CLI_MFA_ATTEMPTS - 1 ? "MFA_REQUIRED" : "MFA_LOCKED");
    }

    // The rows are really there: five wrong answers, each with its own moment.
    const { rows: written } = await store.pool.query(
      "select at from mfa_cli_attempts where user_id = $1 order by at",
      [person.id],
    );
    expect(written).toHaveLength(CLI_MFA_ATTEMPTS);

    // A sixth run with the *right* code is refused before the code is checked.
    const later = new Date(t0.getTime() + 6_000);
    const locked = await assertOperatorCliMfa({
      store,
      actor: person,
      code: totpCode(started.secret, totpStep(later)),
      env: {},
      kek: KEK,
      now: () => later,
    }).catch((error) => error);
    expect(locked.code).toBe("MFA_LOCKED");
    const { rows: stillFive } = await store.pool.query(
      "select count(*)::int as n from mfa_cli_attempts where user_id = $1",
      [person.id],
    );
    expect(stillFive[0].n).toBe(CLI_MFA_ATTEMPTS);

    // Sixteen minutes after the fifth row the window has passed: the code works and the
    // operator's rows are gone.
    const after = new Date(t0.getTime() + 16 * 60_000);
    const proof = await assertOperatorCliMfa({
      store,
      actor: person,
      code: totpCode(started.secret, totpStep(after)),
      env: {},
      kek: KEK,
      now: () => after,
    });
    expect(proof).toMatchObject({ mfa: "totp", skipped: false });
    const { rows: cleared } = await store.pool.query(
      "select count(*)::int as n from mfa_cli_attempts where user_id = $1",
      [person.id],
    );
    expect(cleared[0].n).toBe(0);
  });

  it("counts only failures inside the window and the retention pass drops the rest", async () => {
    const person = await seedUser();
    const t0 = new Date("2026-11-23T13:00:00Z");
    await store.recordCliMfaFailure({ userId: person.id, at: t0 });
    await store.recordCliMfaFailure({ userId: person.id, at: new Date(t0.getTime() + 1_000) });

    expect(
      await store.countCliMfaFailures({
        userId: person.id,
        since: new Date(t0.getTime() - CLI_MFA_LOCK_MS),
      }),
    ).toBe(2);
    expect(
      await store.countCliMfaFailures({
        userId: person.id,
        since: new Date(t0.getTime() + 500),
      }),
    ).toBe(1);

    const purged = await store.purgeExpiredMfa({
      unconfirmedBefore: new Date(0),
      now: new Date(t0.getTime() + CLI_MFA_LOCK_MS + 5_000),
    });
    expect(purged.cliFailures).toBe(2);
    expect(
      (await store.pool.query("select 1 from mfa_cli_attempts where user_id = $1", [person.id]))
        .rows,
    ).toHaveLength(0);
  });
});
