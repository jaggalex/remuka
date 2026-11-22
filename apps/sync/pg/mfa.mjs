/**
 * The second factor's rows (ADR-260, `spec/totp.md` §3).
 *
 * Three tables and one session column, all keyed by the account and outside tenant RLS
 * exactly like `sessions`: a second factor belongs to a person across every organisation,
 * so there is no `org_id` to scope it with. Every read names the `user_id`; an operator
 * never sees another account's row.
 *
 * The secret is sealed with the KEK before it is written (`encryptSecret`, scope `mfa`,
 * scope id = user id). Nothing here returns it to a caller outside this module:
 * `mfaSecretRow` exists for the verification path and its tests, and the eventual API
 * surface answers only status, `otpauth://` once and recovery codes once.
 *
 * The replay rule lives in the `update … where last_step is null or last_step < $2`: two
 * requests presenting the same code race at the database, and only one row changes
 * (`spec/totp.md` §1 rule 4).
 */
import { decryptSecret, encryptSecret } from "../secrets.mjs";
import {
  MFA_CHALLENGE_ATTEMPTS,
  MFA_CLI_LOCK_MS,
  MFA_RECOVERY_CODES,
  hashRecoveryCode,
  matchTotp,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
  TOTP_WINDOW,
} from "../mfa.mjs";

const SECRET_COLUMNS = `secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce,
                        kek_id, confirmed_at, last_step`;

/** The sealed row as `decryptSecret` expects it; the AAD binds it to this account. */
function sealedRow(row, userId) {
  return {
    scope: "mfa",
    scope_id: userId,
    provider: "totp",
    id: userId,
    ciphertext: row.secret_ciphertext,
    nonce: row.secret_nonce,
    dek_wrapped: row.secret_dek_wrapped,
    dek_nonce: row.secret_dek_nonce,
  };
}

export const mfaMethods = {
  /** What the account's own screen may know; never the secret or `otpauth://`. */
  async mfaStatus(userId) {
    const { rows } = await this.pool.query(
      `select m.confirmed_at,
              (select count(*)::int
                 from user_mfa_recovery_codes c
                where c.user_id = m.user_id and c.used_at is null) as recovery_left
         from user_mfa m
        where m.user_id = $1`,
      [userId],
    );
    const row = rows[0];
    return {
      enrolled: Boolean(row?.confirmed_at),
      pending: Boolean(row && !row.confirmed_at),
      confirmedAt: row?.confirmed_at ?? null,
      recoveryLeft: row?.recovery_left ?? 0,
    };
  },

  /**
   * Start (or restart) enrolment: a fresh secret, sealed and pending.
   *
   * A confirmed row is never overwritten — a new secret would silently replace the factor
   * a person already relies on. The conditional `do update` is the guard, so two parallel
   * enrolments cannot both become pending.
   */
  async beginMfaEnrollment({ userId, kek, issuer, account }) {
    if (!userId) throw new Error("beginMfaEnrollment needs a user id");
    const secret = newTotpSecret();
    const sealed = encryptSecret(secret, {
      scope: "mfa",
      scopeId: userId,
      provider: "totp",
      id: userId,
      kek,
    });
    const { rowCount } = await this.pool.query(
      `insert into user_mfa
         (user_id, secret_ciphertext, secret_nonce, secret_dek_wrapped, secret_dek_nonce, kek_id)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id) do update
          set secret_ciphertext = excluded.secret_ciphertext,
              secret_nonce = excluded.secret_nonce,
              secret_dek_wrapped = excluded.secret_dek_wrapped,
              secret_dek_nonce = excluded.secret_dek_nonce,
              kek_id = excluded.kek_id
        where user_mfa.confirmed_at is null`,
      [userId, sealed.ciphertext, sealed.nonce, sealed.dekWrapped, sealed.dekNonce, sealed.kekId],
    );
    if (!rowCount) return { started: false, reason: "already_enabled" };
    return { started: true, secret, uri: otpauthUri({ secret, issuer, account }) };
  },

  /**
   * Prove the pending secret with one code: `confirmed_at` and `last_step` are written and
   * ten recovery codes issued in the same transaction (`spec/totp.md` §4). The codes come
   * back once, as plain text; only their digests stay.
   */
  async confirmMfaEnrollment({
    userId,
    code,
    kek,
    now = new Date(),
    recoveryCount = MFA_RECOVERY_CODES,
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        `select ${SECRET_COLUMNS} from user_mfa where user_id = $1 for update`,
        [userId],
      );
      const row = rows[0];
      if (!row) {
        await client.query("rollback");
        return { ok: false, reason: "not_started" };
      }
      if (row.confirmed_at) {
        await client.query("rollback");
        return { ok: false, reason: "already_enabled" };
      }
      const secret = decryptSecret(sealedRow(row, userId), { kek });
      const match = matchTotp({ secret, code, now, lastStep: row.last_step });
      if (!match.ok) {
        await client.query("rollback");
        return match;
      }
      await client.query(
        `update user_mfa set confirmed_at = now(), last_step = $2 where user_id = $1`,
        [userId, match.step],
      );
      await client.query("delete from user_mfa_recovery_codes where user_id = $1", [userId]);
      const codes = newRecoveryCodes(recoveryCount);
      const values = codes.map((_, index) => `($1, $${index + 2})`).join(", ");
      await client.query(
        `insert into user_mfa_recovery_codes (user_id, code_hash) values ${values}`,
        [userId, ...codes.map((entry) => hashRecoveryCode(entry))],
      );
      await client.query("commit");
      return { ok: true, step: match.step, recoveryCodes: codes };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** The sealed row. Internal: callers outside this module have no reason to see it. */
  async mfaSecretRow(userId) {
    const { rows } = await this.pool.query(
      `select ${SECRET_COLUMNS} from user_mfa where user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  },

  /**
   * Check a code against a confirmed secret and consume its step (`spec/totp.md` §5.3).
   *
   * The `last_step` update is the atomic part: `matchTotp` refuses a step at or below the
   * stored one, and the conditional update refuses a parallel request that read the same
   * row before the first commit. A refusal has a reason the caller can count.
   */
  async verifyMfaCode({ userId, code, kek, now = new Date(), window = TOTP_WINDOW }) {
    const row = await this.mfaSecretRow(userId);
    if (!row?.confirmed_at) return { ok: false, reason: "not_enrolled" };
    const secret = decryptSecret(sealedRow(row, userId), { kek });
    const match = matchTotp({ secret, code, now, lastStep: row.last_step, window });
    if (!match.ok) return match;
    const { rowCount } = await this.pool.query(
      `update user_mfa
          set last_step = $2
        where user_id = $1
          and (last_step is null or last_step < $2)`,
      [userId, match.step],
    );
    if (!rowCount) return { ok: false, reason: "replayed", step: match.step };
    return { ok: true, step: match.step };
  },

  /**
   * Use one recovery code. The row is the lock: `used_at is null` in the update means two
   * parallel requests cannot both spend the same code. The answer names how many are left
   * so the letter and the screen can say «осталось N» (`spec/totp.md` §5.4).
   */
  async verifyMfaRecoveryCode({ userId, code }) {
    const hash = hashRecoveryCode(code);
    if (!hash) return { ok: false, reason: "malformed" };
    const { rowCount } = await this.pool.query(
      `update user_mfa_recovery_codes
          set used_at = now()
        where user_id = $1 and code_hash = $2 and used_at is null`,
      [userId, hash],
    );
    if (!rowCount) {
      const { rows } = await this.pool.query(
        `select 1 from user_mfa_recovery_codes where user_id = $1 and code_hash = $2`,
        [userId, hash],
      );
      return { ok: false, reason: rows.length ? "used" : "mismatch" };
    }
    return { ok: true, remaining: await this.mfaRecoveryCodesLeft(userId) };
  },

  async mfaRecoveryCodesLeft(userId) {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from user_mfa_recovery_codes
        where user_id = $1 and used_at is null`,
      [userId],
    );
    return rows[0]?.n ?? 0;
  },

  /**
   * Replace the recovery codes after a code was proved. Old codes stop working in the same
   * transaction that writes the new ones, so a screen that failed halfway leaves neither
   * set silently usable.
   */
  async issueRecoveryCodes({ userId, count = MFA_RECOVERY_CODES }) {
    const codes = newRecoveryCodes(count);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from user_mfa_recovery_codes where user_id = $1", [userId]);
      const values = codes.map((_, index) => `($1, $${index + 2})`).join(", ");
      await client.query(
        `insert into user_mfa_recovery_codes (user_id, code_hash) values ${values}`,
        [userId, ...codes.map((entry) => hashRecoveryCode(entry))],
      );
      await client.query("commit");
      return codes;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /* -------------------------------------------------- shell failures -- */

  /**
   * Write one wrong second-factor code typed at the operator's shell (schema 39,
   * `spec/operator-actions.md` §5).
   *
   * The row is the counter: each `pnpm billing:*` command is a new process, so a map in
   * memory forgot every failure between runs. `at` is the caller's clock because the lock
   * is compared against the same instant the code was checked with.
   */
  async recordCliMfaFailure({ userId, at = new Date() }) {
    const { rows } = await this.pool.query(
      `insert into mfa_cli_attempts (user_id, at) values ($1, $2) returning id, at`,
      [userId, at],
    );
    return rows[0];
  },

  /** How many wrong codes this operator typed since `since`; five close the group. */
  async countCliMfaFailures({ userId, since }) {
    const { rows } = await this.pool.query(
      `select count(*)::int as n
         from mfa_cli_attempts
        where user_id = $1 and at > $2`,
      [userId, since],
    );
    return rows[0]?.n ?? 0;
  },

  /** A correct code proves the person again, so the operator starts with a clean slate. */
  async clearCliMfaFailures(userId) {
    const { rowCount } = await this.pool.query(
      "delete from mfa_cli_attempts where user_id = $1",
      [userId],
    );
    return rowCount ?? 0;
  },

  /* ------------------------------------------------------- sign-in state -- */

  /** A short-lived sign-in challenge; only the token digest is stored (§5.1). */
  async createMfaChallenge({ userId, purpose = "login", tokenHash, expiresAt }) {
    const { rows } = await this.pool.query(
      `insert into mfa_challenges (user_id, token_hash, purpose, expires_at)
       values ($1, $2, $3, $4)
       returning id, expires_at`,
      [userId, tokenHash, purpose, expiresAt],
    );
    return rows[0];
  },

  /** A live challenge by its digest, or null when it expired or was used. */
  async findMfaChallenge(tokenHash) {
    const { rows } = await this.pool.query(
      `select id, user_id, purpose, attempts, expires_at
         from mfa_challenges
        where token_hash = $1 and expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  /**
   * Count one wrong answer. The fifth deletes the challenge: the password has to be proved
   * again rather than guessing codes against the same token (§5.3).
   */
  async failMfaChallenge(id) {
    const { rows } = await this.pool.query(
      `update mfa_challenges set attempts = attempts + 1 where id = $1 returning attempts`,
      [id],
    );
    const attempts = rows[0]?.attempts ?? MFA_CHALLENGE_ATTEMPTS;
    if (attempts < MFA_CHALLENGE_ATTEMPTS) return { attempts, deleted: false };
    await this.pool.query("delete from mfa_challenges where id = $1", [id]);
    return { attempts, deleted: true };
  },

  async deleteMfaChallenge(tokenHash) {
    await this.pool.query("delete from mfa_challenges where token_hash = $1", [tokenHash]);
  },

  async deleteMfaChallengesForUser(userId) {
    await this.pool.query("delete from mfa_challenges where user_id = $1", [userId]);
  },

  /**
   * The hourly retention pass for the second factor (`spec/operator-actions.md` §6).
   *
   * An enrolment that was started and never proved is not a factor and must not sit in
   * the table forever; a challenge past its five minutes cannot be answered any more.
   * A shell failure older than the lock window counts for nothing and goes the same way
   * (schema 39). Bounded to 1000 rows per table, like the mail pass, so one sweep never
   * holds a long lock. It runs from the installation's existing retention timer, not a new
   * one.
   */
  async purgeExpiredMfa({ unconfirmedBefore, now = new Date() }) {
    const stale = await this.pool.query(
      `delete from user_mfa
        where user_id in (
          select user_id from user_mfa
           where confirmed_at is null and created_at < $1
           order by created_at
           limit 1000
        )`,
      [unconfirmedBefore],
    );
    const challenges = await this.pool.query(
      `delete from mfa_challenges
        where id in (
          select id from mfa_challenges
           where expires_at < $1
           order by expires_at
           limit 1000
        )`,
      [now],
    );
    const cliFailures = await this.pool.query(
      `delete from mfa_cli_attempts
        where id in (
          select id from mfa_cli_attempts
           where at < $1
           order by at
           limit 1000
        )`,
      [new Date(new Date(now).getTime() - MFA_CLI_LOCK_MS)],
    );
    return {
      unconfirmed: stale.rowCount,
      challenges: challenges.rowCount,
      cliFailures: cliFailures.rowCount,
    };
  },

  /** Record that this session proved a code; step-up and the console read it (§6). */
  async setSessionMfaAt(sessionId, at = new Date(), factor = null) {
    await this.pool.query(
      "update sessions set mfa_at = $2, mfa_factor = $3 where id = $1",
      [sessionId, at, factor],
    );
  },

  /**
   * Forget the factor: secret, recovery codes and every live challenge. Sessions are
   * revoked by the caller, because "a reset ends the sessions" is the command's promise,
   * not a property of one table (§7).
   */
  async resetMfa(userId) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const secret = await client.query("delete from user_mfa where user_id = $1", [userId]);
      const codes = await client.query(
        "delete from user_mfa_recovery_codes where user_id = $1",
        [userId],
      );
      const challenges = await client.query(
        "delete from mfa_challenges where user_id = $1",
        [userId],
      );
      await client.query("commit");
      return {
        hadSecret: secret.rowCount > 0,
        recoveryCodes: codes.rowCount ?? 0,
        challenges: challenges.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },
};
