/**
 * The console's money screen (`spec/operator-actions.md` §4.2).
 *
 * Four read-only tables: connections (never their secrets), webhooks that could not be
 * processed, the latest refunds and credits/manual payments. Every write still goes
 * through the action routes or the shell; this module only answers questions.
 */
const LIMIT_MAX = 200;

function cap(limit) {
  return Math.min(Math.max(Number(limit) || 50, 1), LIMIT_MAX);
}

export const operatorMoneyMethods = {
  async operatorMoneyOverview({ limit = 50 } = {}) {
    const capped = cap(limit);
    return this.withOwnerClient(async (client) => {
      const { rows: connections } = await client.query(
        `select c.id, c.provider, c.name, c.mode, c.status,
                (select max(e.received_at) from billing_provider_events e
                  where e.connection_id = c.id) as last_event_at,
                c.last_health_at, c.last_health_error
           from payment_connections c
          order by c.priority asc, c.created_at asc`,
      );
      const { rows: dead } = await client.query(
        `select e.id, e.org_id, o.name as org_name, c.provider, c.name as connection_name,
                e.type, e.last_error, e.attempts, e.dead_at
           from billing_provider_events e
           join payment_connections c on c.id = e.connection_id
           left join orgs o on o.id = e.org_id
          where e.dead_at is not null
          order by e.dead_at desc
          limit $1`,
        [capped],
      );
      const { rows: refunds } = await client.query(
        `select r.id, r.org_id, o.name as org_name, o.slug as org_slug,
                r.amount, r.currency, r.status, r.created_at,
                u.email as author_email, u.id as author_id,
                (select e.channel from audit_events e
                  where e.action = 'billing.refunded'
                    and e.after->>'refundId' = r.id::text
                  order by e.at desc limit 1) as channel
           from refunds r
           join orgs o on o.id = r.org_id
           left join users u on u.id = r.created_by
          order by r.created_at desc
          limit $1`,
        [capped],
      );
      const { rows: movements } = await client.query(
        `select * from (
           select 'credit'::text as kind, l.id::text as id, l.org_id, o.name as org_name,
                  o.slug as org_slug, l.amount, l.currency, l.note as reason,
                  l.created_at, u.email as author_email, u.id as author_id
             from org_credit_ledger l
             join orgs o on o.id = l.org_id
             left join users u on u.id = l.created_by
            where l.kind in ('goodwill', 'refund_to_credit')
           union all
           select 'manual'::text as kind, e.id::text as id, e.org_id, o.name as org_name,
                  o.slug as org_slug,
                  coalesce((e.after->>'amount')::bigint, 0) as amount,
                  coalesce(e.after->>'currency', '') as currency,
                  e.reason, e.at as created_at, u.email as author_email, u.id as author_id
             from audit_events e
             join orgs o on o.id = e.org_id
             left join users u on u.id = e.actor_id
            where e.action = 'billing.invoice_marked_paid'
         ) movement
         order by movement.created_at desc
         limit $1`,
        [capped],
      );

      return {
        connections: connections.map((row) => ({
          id: row.id,
          provider: row.provider,
          name: row.name,
          mode: row.mode,
          status: row.status,
          lastEventAt: row.last_event_at,
          lastHealthAt: row.last_health_at,
          lastHealthError: row.last_health_error,
        })),
        deadEvents: dead.map((row) => ({
          id: row.id,
          orgId: row.org_id,
          orgName: row.org_name,
          provider: row.provider,
          connectionName: row.connection_name,
          type: row.type,
          error: row.last_error,
          attempts: row.attempts,
          deadAt: row.dead_at,
        })),
        refunds: refunds.map((row) => ({
          id: row.id,
          orgId: row.org_id,
          orgName: row.org_name,
          orgSlug: row.org_slug,
          amount: Number(row.amount),
          currency: row.currency,
          status: row.status,
          createdAt: row.created_at,
          authorId: row.author_id,
          authorEmail: row.author_email,
          channel: row.channel,
        })),
        movements: movements.map((row) => ({
          kind: row.kind,
          id: String(row.id),
          orgId: row.org_id,
          orgName: row.org_name,
          orgSlug: row.org_slug,
          amount: Number(row.amount),
          currency: row.currency,
          reason: row.reason,
          createdAt: row.created_at,
          authorId: row.author_id,
          authorEmail: row.author_email,
        })),
      };
    });
  },
};
