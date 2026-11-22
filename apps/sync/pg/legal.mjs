/**
 * The legal-acceptance journal and the registration that writes it (ADR-256 §4).
 *
 * A row proves which revision of which document a person accepted, in which zone, and
 * when. It belongs to the person, not to an organisation: the table has no `org_id`, no
 * policy, and is listed as global in `scripts/rls-inventory.mjs` beside `users` and
 * `consent_events`. Two accounts never read each other's rows because every read is keyed
 * by `user_id`.
 *
 * The account and its acceptances are one transaction. A failed acceptance insert must
 * not leave an account that accepted nothing, which is exactly the state the journal
 * exists to make impossible.
 *
 * The address is only ever an HMAC digest (`ip_hash`), never an address. Deleting an
 * account keeps the proof and clears the address at once (ADR-257 §3); the retention pass
 * clears old digests on installations that keep them (ADR-256 §4).
 */
import { insertUser } from "./iam-users.mjs";

export const legalMethods = {
  /**
   * Create the account and the acceptance rows in one transaction.
   *
   * `acceptances` is built by `legalAcceptanceRows` from the registry, not echoed from the
   * request: a client cannot add a document the server did not ask for.
   */
  async createUserWithAcceptances({ email, passwordHash, name, handle, acceptances = [] }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const user = await insertUser(client, { email, passwordHash, name, handle });
      for (const acceptance of acceptances) {
        await client.query(
          `insert into legal_acceptances
             (user_id, zone, doc, version, sha256, ip_hash, user_agent)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            user.id,
            acceptance.zone,
            acceptance.doc,
            acceptance.version,
            acceptance.sha256,
            acceptance.ipHash ?? null,
            acceptance.userAgent ?? null,
          ],
        );
      }
      await client.query("commit");
      return user;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** Every acceptance of one person, oldest first: what the operator command prints. */
  async listLegalAcceptances(userId) {
    const { rows } = await this.pool.query(
      `select id, user_id, zone, doc, version, sha256, accepted_at, ip_hash, user_agent, event
         from legal_acceptances
        where user_id = $1
        order by accepted_at, id`,
      [userId],
    );
    return rows;
  },

  /**
   * The latest journal row of every document for one person.
   *
   * The newest row wins, so a withdrawal supersedes an acceptance and a new revision
   * supersedes the old one. The account screen and the re-acceptance window read one
   * question — "what is the state of this document for this person" — from one query.
   */
  async latestLegalAcceptances(userId) {
    const { rows } = await this.pool.query(
      `select distinct on (doc)
              id, user_id, zone, doc, version, sha256, accepted_at, ip_hash, user_agent, event
         from legal_acceptances
        where user_id = $1
        order by doc, accepted_at desc, id desc`,
      [userId],
    );
    return rows;
  },

  /**
   * Append acceptance or withdrawal rows and their audit records in one transaction.
   *
   * `rows` is built from the registry by the caller: a client cannot name a revision the
   * installation did not publish. One transaction covers the whole request, so a person
   * never ends up in a state where the journal says one document and the audit says
   * another.
   */
  async recordLegalAcceptances({
    userId,
    rows,
    ipHash = null,
    userAgent = null,
    requestId = null,
    sessionId = null,
  }) {
    if (!userId) throw new Error("recordLegalAcceptances needs a user id");
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const written = [];
      for (const row of rows) {
        const event = row.event === "withdraw" ? "withdraw" : "accept";
        const { rows: inserted } = await client.query(
          `insert into legal_acceptances
             (user_id, zone, doc, version, sha256, ip_hash, user_agent, event)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id, accepted_at, event`,
          [
            userId,
            row.zone,
            row.doc,
            row.version,
            row.sha256,
            ipHash,
            userAgent,
            event,
          ],
        );
        written.push({ ...row, ...inserted[0] });
        await client.query(
          `insert into audit_events
             (actor_id, action, subject, after, request_id, session_id)
           values ($1, $2, $3, $4::jsonb, $5, $6)`,
          [
            userId,
            event === "withdraw" ? "legal.withdraw" : "legal.accept",
            `${row.zone}/${row.doc}`,
            JSON.stringify({ version: row.version, sha256: row.sha256, event }),
            requestId,
            sessionId,
          ],
        );
      }
      await client.query("commit");
      return written;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** Active accounts this installation may write to; the operator notify command uses it. */
  async listActiveUsersForLegalNotice() {
    const { rows } = await this.pool.query(
      `select id, email, name, lang
         from users
        where state = 'active'
        order by id`,
    );
    return rows;
  },

  /**
   * Which `legal_update` notices the outbox already holds.
   *
   * The key travels in clear `params` (`legal:<doc>:<version>:<user>`), so a scheduled
   * pass can ask one question for every candidate before it inserts anything. A sent or
   * dead row still counts: the promise is one letter per person and revision, not one per
   * successful delivery.
   */
  async existingLegalNoticeKeys(keys = []) {
    if (!Array.isArray(keys) || keys.length === 0) return new Set();
    const { rows } = await this.pool.query(
      `select params->>'dedupe' as key
         from mail_outbox
        where template = 'legal_update'
          and params->>'dedupe' = any($1::text[])`,
      [keys],
    );
    return new Set(rows.map((row) => row.key).filter(Boolean));
  },

  /**
   * Clear address digests accepted before `cutoff`. The rows stay; only `ip_hash` goes.
   * Returns the number of rows changed so the pass can report something real.
   */
  async clearLegalIpBefore(cutoff) {
    const { rowCount } = await this.pool.query(
      `update legal_acceptances
          set ip_hash = null
        where ip_hash is not null and accepted_at < $1`,
      [cutoff],
    );
    return rowCount ?? 0;
  },
};
