/**
 * What the billing letter loop reads (ADR-319, `spec/billing.md` §7).
 *
 * Two kinds of letters do not follow a payment: those that follow a decision (a scheduled
 * downgrade, an applied one, auto-renewal turned off) and reminders that follow the
 * calendar (a trial, a yearly renewal, a card). Both are read here across organisations,
 * as the renewal loop reads due subscriptions; the letter's id is derived from the event
 * or the reminder's window, so rereading a row is harmless.
 */

const EVENT_TYPES = [
  "subscription.change_scheduled",
  "subscription.change_applied",
  "subscription.canceled_at_period_end",
];

function mapEvent(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    type: row.type,
    data: row.data ?? {},
    occurredAt: row.occurred_at,
    subscription: row.subscription_id
      ? {
          id: row.subscription_id,
          plan: row.plan,
          amount: Number(row.amount),
          currency: row.currency,
          interval: row.interval,
          current_period_end: row.current_period_end,
        }
      : null,
  };
}

export const billingLetterMethods = {
  /**
   * What a billing letter says about the space (ADR-319): its name or «Личное», how many
   * rooms it has, and the last four digits of the card that pays. One read, under the tenant.
   */
  async billingLetterFacts(orgId) {
    return this.withTenant(orgId, async () => {
      const { rows } = await this.pool.query(
        `select o.name, o.kind,
                (select count(*)::int from boards b
                  where b.org_id = o.id and b.archived_at is null) as rooms,
                (select count(*)::int from boards b
                  where b.org_id = o.id and b.archived_at is null and b.frozen_at is not null) as frozen,
                (select pm.display->>'last4' from payment_methods pm
                  where pm.org_id = o.id and pm.state = 'active'
                  order by pm.created_at desc, pm.id desc limit 1) as last4
           from orgs o where o.id = $1`,
        [orgId],
      );
      const row = rows[0];
      return row
        ? { name: row.name, kind: row.kind, rooms: row.rooms, frozen: row.frozen, last4: row.last4 ?? null }
        : null;
    });
  },

  /** Plan decisions since `since`, oldest first, with the subscription they concern. */
  async billingLetterEvents({ since, limit = 100 } = {}) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select e.id, e.org_id, e.type, e.data, e.occurred_at,
                s.id as subscription_id, s.plan, s.amount, s.currency, s.interval,
                s.current_period_end
           from billing_events e
           left join subscriptions s on s.id = e.subject_id
          where e.type = any($1::text[]) and e.occurred_at >= $2
          order by e.occurred_at asc, e.id asc
          limit $3`,
        [EVENT_TYPES, since, Math.min(Math.max(Number(limit) || 100, 1), 500)],
      );
      return rows.map(mapEvent);
    });
  },

  /**
   * Subscriptions and cards whose reminder window is open at `now`: a trial ending within
   * three days, a yearly renewal within seven, a card whose expiry month ends within thirty.
   */
  async billingReminders({ now = new Date() } = {}) {
    return this.withOwnerClient(async (client) => {
      const { rows: trials } = await client.query(
        `select id, org_id, plan, trial_end from subscriptions
          where status = 'trialing' and trial_end > $1 and trial_end <= $1 + interval '3 days'`,
        [now],
      );
      const { rows: renewals } = await client.query(
        `select id, org_id, plan, amount, currency, current_period_end from subscriptions
          where status = 'active' and interval = 'year' and not cancel_at_period_end
            and pending_change is null
            and current_period_end > $1 and current_period_end <= $1 + interval '7 days'`,
        [now],
      );
      const { rows: cards } = await client.query(
        `select pm.id, pm.org_id, pm.display->>'last4' as last4,
                (pm.display->>'expMonth')::int as exp_month, (pm.display->>'expYear')::int as exp_year
           from payment_methods pm
          where pm.state = 'active'
            and pm.display->>'expMonth' ~ '^[0-9]{1,2}$' and pm.display->>'expYear' ~ '^[0-9]{4}$'
            and exists (select 1 from subscriptions s where s.org_id = pm.org_id
                         and s.status in ('active', 'past_due') and not s.cancel_at_period_end)`,
      );
      return { trials, renewals, cards };
    });
  },

  /** Addresses of the space's active admins: plan letters go to all of them (ADR-319). */
  async orgAdminEmails(orgId) {
    const { rows } = await this.pool.query(
      `select distinct u.email
         from admin_roles a
         join org_memberships m on m.org_id = a.org_id and m.user_id = a.user_id
         join users u on u.id = a.user_id
        where a.org_id = $1 and a.role = 'org_admin'
          and m.state = 'active' and m.relation = 'member'
        order by u.email`,
      [orgId],
    );
    return rows.map((row) => row.email);
  },
};
