/**
 * The product-side reads of the Pulse aggregator (`spec/pulse.md` §4.3).
 *
 * The aggregator writes to the separate metrics database but needs three facts that only
 * the product database holds: when an organisation was created (and its first-touch
 * source), when invitations were sent and accepted, and the live billing state for a
 * money snapshot. Each read is cross-tenant by nature, so it runs on the owner connection
 * like every other maintenance command (ADR-178). No e-mail, name or room content is
 * selected: the aggregate needs counts and dates.
 */
export const pulseMethods = {
  /**
   * Organisations created in a window. `orgs.source` arrives with stage 1 (`spec/pulse.md`
   * §3); an installation that predates the column still answers, with `source = null`.
   */
  async pulseOrgs({ from, to }) {
    return this.withOwnerClient(async (client) => {
      if (this.pulseOrgSourceColumn === undefined) {
        const { rows } = await client.query(
          `select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'orgs' and column_name = 'source'`,
        );
        this.pulseOrgSourceColumn = rows.length > 0;
      }
      const source = this.pulseOrgSourceColumn ? "source" : "null::text as source";
      const { rows } = await client.query(
        `select id, created_at, ${source}
           from orgs
          where created_at >= ($1::date::timestamp at time zone 'UTC')
            and created_at < (($2::date + 1)::timestamp at time zone 'UTC')`,
        [from, to],
      );
      return rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        source: row.source,
      }));
    });
  },

  /** Invitations by creation and acceptance date; the address is never selected. */
  async pulseInvitations({ from, to }) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select created_at, accepted_at
           from invitations
          where (created_at >= ($1::date::timestamp at time zone 'UTC')
                 and created_at < (($2::date + 1)::timestamp at time zone 'UTC'))
             or (accepted_at >= ($1::date::timestamp at time zone 'UTC')
                 and accepted_at < (($2::date + 1)::timestamp at time zone 'UTC'))`,
        [from, to],
      );
      return rows.map((row) => ({ createdAt: row.created_at, acceptedAt: row.accepted_at }));
    });
  },

  /** Live paid subscriptions: the state a money snapshot records (§1.3). */
  async pulseSubscriptions() {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select org_id, plan, amount, currency, interval, status
           from subscriptions
          where status in ('active', 'past_due') and plan <> 'free'`,
      );
      return rows.map((row) => ({
        orgId: row.org_id,
        plan: row.plan,
        amount: Number(row.amount),
        currency: row.currency,
        interval: row.interval,
        status: row.status,
      }));
    });
  },
};
