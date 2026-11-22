/**
 * The consent journal (ADR-255, `spec/cookies.md` §4).
 *
 * A row is proof that a signed-in person chose which optional categories may run. It is
 * not tenant data: the choice belongs to the person across every organisation, so the
 * table has no `org_id`, no policy and is listed as global in `scripts/rls-inventory.mjs`
 * next to `users` and `sessions`. Two accounts never read each other's rows because every
 * query here is keyed by `user_id`.
 */
export const consentMethods = {
  /** Append one change. The caller decides whether the choice actually changed. */
  async recordConsentEvent({
    userId,
    zone,
    choices,
    policyVersion,
    userAgent = null,
    ipHash = null,
  }) {
    const { rows } = await this.pool.query(
      `insert into consent_events (user_id, zone, choices, policy_version, user_agent, ip_hash)
       values ($1, $2, $3::jsonb, $4, $5, $6)
       returning id, created_at`,
      [userId, zone, JSON.stringify(choices), policyVersion, userAgent, ipHash],
    );
    return rows[0] ?? null;
  },

  /** The last choice of one account, so a repeated post is not a second journal row. */
  async latestConsentEvent(userId) {
    const { rows } = await this.pool.query(
      `select id, user_id, zone, choices, policy_version, user_agent, ip_hash, created_at
         from consent_events
        where user_id = $1
        order by created_at desc, id desc
        limit 1`,
      [userId],
    );
    return rows[0] ?? null;
  },
};
