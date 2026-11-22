/**
 * The operator's support card (`spec/operator.md` §3, §5, «Клиенты»).
 *
 * Split from `pg/operators.mjs` for the file-size ratchet. The card is metadata only: who
 * the customer is, which organisations, plan, subscription, invoices, payments, counts,
 * accepted documents and the operator's measures. It never selects a room title or content.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function mapOrg(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    createdAt: row.created_at,
    suspendedAt: row.suspended_at ?? null,
    suspensionRef: row.suspension_ref ?? null,
  };
}

export const operatorCustomerMethods = {
  /** The operator's support card for one account (`spec/operator.md` §3): metadata only. */
  async operatorCustomerByEmail(email) {
    const address = normalEmail(email);
    if (!address) return null;
    return this.withOwnerClient(async (client) => {
      const { rows: [user] } = await client.query(
        `select id, email, name, handle, state, lang, created_at, email_verified_at
           from users where lower(email) = $1`,
        [address],
      );
      if (!user) return null;
      const { rows: memberships } = await client.query(
        `select o.id, o.name, o.slug, o.kind, o.created_at, o.suspended_at, o.suspension_ref,
                m.relation, m.state,
                coalesce(array_agg(a.role order by a.role)
                  filter (where a.role is not null), '{}'::text[]) as roles
           from org_memberships m
           join orgs o on o.id = m.org_id
           left join admin_roles a on a.org_id = m.org_id and a.user_id = m.user_id
          where m.user_id = $1
          group by o.id, o.name, o.slug, o.kind, o.created_at, o.suspended_at,
                   o.suspension_ref, m.relation, m.state
          order by o.created_at`,
        [user.id],
      );
      const orgs = [];
      for (const membership of memberships) {
        orgs.push({
          ...mapOrg(membership),
          relation: membership.relation,
          membershipState: membership.state,
          roles: membership.roles ?? [],
          ...(await customerOrgDetails(client, membership.id, user.id)),
        });
      }
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          handle: user.handle,
          state: user.state,
          lang: user.lang,
          createdAt: user.created_at,
          emailVerifiedAt: user.email_verified_at,
        },
        orgs,
      };
    });
  },

  /** The same card by organisation id or slug; the administrators' acceptances are shown. */
  async operatorCustomerByOrg(orgRef) {
    const text = String(orgRef ?? "").trim();
    if (!text) return null;
    return this.withOwnerClient(async (client) => {
      const { rows: [org] } = UUID.test(text)
        ? await client.query(
            `select id, name, slug, kind, created_at, suspended_at, suspension_ref
               from orgs where id = $1`,
            [text],
          )
        : await client.query(
            `select id, name, slug, kind, created_at, suspended_at, suspension_ref
               from orgs where slug = $1`,
            [text],
          );
      if (!org) return null;
      const { rows: admins } = await client.query(
        `select u.id, u.email, u.name, u.lang
           from admin_roles a
           join users u on u.id = a.user_id
           join org_memberships m on m.org_id = a.org_id and m.user_id = a.user_id
          where a.org_id = $1 and a.role = 'org_admin'
            and m.state = 'active' and u.state = 'active'
          order by u.email`,
        [org.id],
      );
      const details = await customerOrgDetails(client, org.id, null);
      return {
        user: null,
        orgs: [
          {
            ...mapOrg(org),
            admins: admins.map((row) => ({
              id: row.id,
              email: row.email,
              name: row.name,
              lang: row.lang,
            })),
            ...details,
          },
        ],
      };
    });
  },

  /**
   * Search the support card's starting points (`spec/operator.md` §5, «Клиенты»).
   * One query over the three things an operator is given on the phone: an address, an
   * organisation, or an invoice number. Only metadata, never a room title.
   */
  async searchOperatorCustomers(raw, { limit = 30 } = {}) {
    const query = String(raw ?? "").trim().toLowerCase();
    if (query.length < 2) return [];
    // LIKE metacharacters are data here: an address with `_` must not match others.
    const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const capped = Math.min(Math.max(Number(limit) || 30, 1), 50);
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select 'user' as kind, u.id, u.email as label, u.name as detail, null::text as slug
           from users u
          where lower(u.email) like $1 or lower(coalesce(u.name, '')) like $1
         union all
         select 'org' as kind, o.id, o.name as label, null::text as detail, o.slug
           from orgs o
          where lower(o.slug) like $1 or lower(coalesce(o.name, '')) like $1
         union all
         select 'invoice' as kind, i.org_id as id, i.number as label, i.status as detail,
                null::text as slug
           from invoices i
          where lower(i.number) like $1
         limit $2`,
        [pattern, capped],
      );
      return rows.map((row) => ({
        kind: row.kind,
        id: row.id,
        label: row.label,
        detail: row.detail,
        slug: row.slug,
      }));
    });
  },
};

async function customerOrgDetails(client, orgId, userId) {
  const [{ rows: counts }, { rows: billing }, { rows: subscriptions }, { rows: invoices },
    { rows: payments }, { rows: credit }, { rows: acceptances }, { rows: actions }] =
    await Promise.all([
      client.query(
        `select
           (select count(*)::int from org_memberships
             where org_id = $1 and state = 'active' and relation = 'member') as members,
           (select count(*)::int from org_memberships
             where org_id = $1 and state = 'active' and relation = 'guest') as guests,
           (select count(*)::int from boards
             where org_id = $1 and archived_at is null) as rooms`,
        [orgId],
      ),
      client.query(
        `select billing_email, billing_name, currency, test_mode, country
           from billing_accounts where org_id = $1`,
        [orgId],
      ),
      client.query(
        `select plan, status, interval, amount, currency, current_period_start,
                current_period_end, trial_end, cancel_at_period_end
           from subscriptions
          where org_id = $1
          order by created_at desc
          limit 1`,
        [orgId],
      ),
      client.query(
        `select id, number, status, total, currency, period_start, period_end, paid_at, created_at
           from invoices
          where org_id = $1
          order by created_at desc
          limit 10`,
        [orgId],
      ),
      client.query(
        `select p.id, p.status, p.amount, p.currency, p.created_at,
                i.number as invoice_number,
                coalesce((select sum(r.amount) from refunds r
                           where r.payment_id = p.id and r.status in ('pending', 'succeeded')), 0)
                  as refunded
           from payments p
           join invoices i on i.id = p.invoice_id
          where p.org_id = $1
          order by p.created_at desc
          limit 10`,
        [orgId],
      ),
      client.query(
        `select currency, coalesce(sum(amount), 0)::text as balance
           from org_credit_ledger where org_id = $1 group by currency`,
        [orgId],
      ),
      userId
        ? client.query(
            `select zone, doc, version, event, accepted_at
               from legal_acceptances
              where user_id = $1
              order by accepted_at desc`,
            [userId],
          )
        : client.query(
            `select la.zone, la.doc, la.version, la.event, la.accepted_at,
                    u.email as user_email
               from legal_acceptances la
               join users u on u.id = la.user_id
               join admin_roles a on a.user_id = la.user_id and a.org_id = $1 and a.role = 'org_admin'
              order by la.accepted_at desc
              limit 40`,
            [orgId],
          ),
      client.query(
        `select a.id, a.kind, a.subject_type, a.reason_internal, a.reason_public,
                a.report_ref, a.created_at, a.reverted_at
           from operator_actions a
          where (a.subject_type = 'org' and a.subject_id = $1::text)
             or (a.subject_type in ('board', 'board_link')
                 and a.subject_id in (select id from boards where org_id = $1::uuid))
          order by a.created_at desc`,
        [orgId],
      ),
    ]);

  return {
    counts: counts[0] ?? { members: 0, guests: 0, rooms: 0 },
    billing: billing[0]
      ? {
          email: billing[0].billing_email,
          name: billing[0].billing_name,
          currency: billing[0].currency,
          country: billing[0].country,
          testMode: billing[0].test_mode,
        }
      : null,
    subscription: subscriptions[0] ?? null,
    invoices: invoices.map((row) => ({ ...row, total: Number(row.total) })),
    payments: payments.map((row) => ({
      ...row,
      amount: Number(row.amount),
      refunded: Number(row.refunded ?? 0),
    })),
    credit: credit.map((row) => ({ currency: row.currency, balance: Number(row.balance) })),
    acceptances,
    actions: actions.map((row) => ({
      id: row.id,
      kind: row.kind,
      subjectType: row.subject_type,
      reasonInternal: row.reason_internal,
      reasonPublic: row.reason_public,
      reportRef: row.report_ref,
      createdAt: row.created_at,
      revertedAt: row.reverted_at,
    })),
  };
}
