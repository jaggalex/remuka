/**
 * The installation operator's data (ADR-259, `spec/operator.md` §2, §4).
 *
 * The role is a global table granted only from a shell command, so `grant` and `revoke`
 * live here rather than in a route module (rule 1). A measure against abuse is a row in
 * `operator_actions`; access reads the open row, and `abuse:revert` closes it, so the same
 * mechanism serves the CLI now and the complaints screen later.
 *
 * Cross-tenant reads (a customer card, an organisation's measures) run on the owner
 * connection, exactly like the other maintenance commands (ADR-178). Writes to an
 * organisation row are in one transaction with the measure, so a suspension without its
 * journal row cannot exist.
 */

import {
  mapOrg,
  normalEmail,
  operatorCustomerMethods,
} from "./operator-customer.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codedError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function mapAction(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    reasonInternal: row.reason_internal,
    reasonPublic: row.reason_public,
    reportRef: row.report_ref,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revertedBy: row.reverted_by,
    revertedAt: row.reverted_at,
  };
}

const OPEN_ACTIONS = `select * from operator_actions
                      where reverted_at is null
                        and ((subject_type in ('board', 'board_link') and subject_id = $1)
                          or (subject_type = 'org' and subject_id = $2))`;

export const operatorMethods = {
  /** The global operator role (`spec/operator.md` §2). */
  async isInstanceOperator(userId) {
    const { rows } = await this.pool.query(
      "select 1 from instance_operators where user_id = $1",
      [userId],
    );
    return rows.length > 0;
  },

  /**
   * Grant the role by email, because the command is run from a shell and the operator
   * knows the address, not the uuid. Re-granting is idempotent and keeps the original
   * `granted_at`: the journal should show when the role first appeared.
   *
   * The verified-address rule belongs to the command: the store is also the fixture path
   * for tests that seed an operator before the mail module exists.
   */
  async grantInstanceOperator({ email, grantedBy = null }) {
    const address = normalEmail(email);
    if (!address) throw new Error("--email is required");
    const { rows: [user] } = await this.pool.query(
      "select id, email from users where lower(email) = $1",
      [address],
    );
    if (!user) throw new Error(`no account with the address ${address}`);
    const { rows: [row] } = await this.pool.query(
      `insert into instance_operators (user_id, granted_by)
       values ($1, $2)
       on conflict (user_id) do update set granted_by = excluded.granted_by
       returning user_id, granted_at, granted_by`,
      [user.id, grantedBy],
    );
    return {
      userId: row.user_id,
      email: user.email,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
    };
  },

  /**
   * Remove the role. The last operator cannot be revoked: an installation without one has
   * nobody who can grant the next (ADR-259).
   */
  async revokeInstanceOperator({ email }) {
    const address = normalEmail(email);
    if (!address) throw new Error("--email is required");
    return this.withOwnerClient(async (client) => {
      await client.query("begin");
      try {
        const { rows: [user] } = await client.query(
          "select id, email from users where lower(email) = $1",
          [address],
        );
        if (!user) throw codedError("ACCOUNT_NOT_FOUND", `no account with the address ${address}`);
        const { rows: [current] } = await client.query(
          "select user_id, granted_at from instance_operators where user_id = $1",
          [user.id],
        );
        if (!current) {
          await client.query("commit");
          return { removed: false, userId: user.id, email: user.email };
        }
        const { rows: [count] } = await client.query(
          "select count(*)::int as n from instance_operators",
        );
        if ((count?.n ?? 0) <= 1) {
          throw codedError(
            "LAST_OPERATOR",
            "this is the last operator; grant another one before revoking this role",
          );
        }
        await client.query("delete from instance_operators where user_id = $1", [user.id]);
        await client.query("commit");
        return { removed: true, userId: user.id, email: user.email };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  },

  async listInstanceOperators() {
    const { rows } = await this.pool.query(
      `select o.user_id, u.email, u.name, o.granted_at, o.granted_by,
              g.email as granted_by_email
         from instance_operators o
         join users u on u.id = o.user_id
         left join users g on g.id = o.granted_by
        order by o.granted_at`,
    );
    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      name: row.name,
      grantedAt: row.granted_at,
      grantedBy: row.granted_by,
      grantedByEmail: row.granted_by_email ?? null,
    }));
  },

  /**
   * The open measures for one room and its organisation. `accessFacts` calls this before a
   * decision so an operator's action is an input to the one access function, not a second
   * rule inside a route.
   */
  async openOperatorActionsForBoard(boardId, orgId = null) {
    const { rows } = await this.pool.query(OPEN_ACTIONS, [boardId, orgId]);
    return rows.map(mapAction);
  },

  /**
   * Apply one measure: the journal row and, for an organisation, the suspension flags in
   * the same transaction. A repeated measure returns the open row instead of a second one.
   */
  async recordOperatorAction({
    kind,
    subjectType,
    subjectId,
    reasonInternal,
    reasonPublic,
    reportRef = null,
    createdBy = null,
  }) {
    if (!kind || !subjectId) throw new TypeError("recordOperatorAction needs a kind and a subject");
    return this.withOwnerClient(async (client) => {
      await client.query("begin");
      try {
        const { rows: [existing] } = await client.query(
          `select * from operator_actions
            where kind = $1 and subject_id = $2 and reverted_at is null
            for update`,
          [kind, String(subjectId)],
        );
        if (existing) {
          await client.query("commit");
          return { action: mapAction(existing), created: false };
        }
        const { rows: [row] } = await client.query(
          `insert into operator_actions
             (kind, subject_type, subject_id, reason_internal, reason_public, report_ref, created_by)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning *`,
          [kind, subjectType, String(subjectId), reasonInternal, reasonPublic, reportRef, createdBy],
        );
        if (kind === "org_suspend") {
          const { rowCount } = await client.query(
            `update orgs set suspended_at = now(), suspension_ref = $2
              where id = $1 and suspended_at is null`,
            [subjectId, reportRef],
          );
          if (rowCount === 0) {
            throw codedError("ORG_NOT_FOUND", "no organisation with this id");
          }
        }
        await client.query("commit");
        return { action: mapAction(row), created: true };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  },

  /** Close one measure; an organisation suspension is lifted in the same transaction. */
  async revertOperatorAction({ id, revertedBy = null }) {
    if (!UUID.test(String(id ?? ""))) throw codedError("BAD_ACTION_ID", "the action id must be a uuid");
    return this.withOwnerClient(async (client) => {
      await client.query("begin");
      try {
        const { rows: [row] } = await client.query(
          "select * from operator_actions where id = $1 for update",
          [id],
        );
        if (!row) throw codedError("ACTION_NOT_FOUND", "no operator action with this id");
        if (row.reverted_at) {
          await client.query("commit");
          return { action: mapAction(row), changed: false };
        }
        const { rows: [updated] } = await client.query(
          `update operator_actions
              set reverted_at = now(), reverted_by = $2
            where id = $1
            returning *`,
          [id, revertedBy],
        );
        if (row.kind === "org_suspend") {
          await client.query(
            "update orgs set suspended_at = null, suspension_ref = null where id = $1",
            [row.subject_id],
          );
        }
        await client.query("commit");
        return { action: mapAction(updated), changed: true };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  },

  /** One measure by id, for a revert that must not depend on a page of the list. */
  async operatorAction(id) {
    const { rows: [row] } = await this.pool.query("select * from operator_actions where id = $1", [
      id,
    ]);
    return mapAction(row);
  },

  async listOperatorActions({ openOnly = false, limit = 100 } = {}) {    const capped = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select a.*, b.title as board_title, o.name as org_name, u.email as created_by_email
           from operator_actions a
           left join boards b on a.subject_type in ('board', 'board_link') and b.id = a.subject_id
           left join orgs o on a.subject_type = 'org' and o.id::text = a.subject_id
           left join users u on u.id = a.created_by
          ${openOnly ? "where a.reverted_at is null" : ""}
          order by a.created_at desc
          limit $1`,
        [capped],
      );
      return rows.map((row) => ({
        ...mapAction(row),
        // Names are for the operator's own list only: a room title is metadata, never
        // content, and the customer card never shows it.
        boardTitle: row.board_title ?? null,
        orgName: row.org_name ?? null,
        createdByEmail: row.created_by_email ?? null,
      }));
    });
  },

  /** A room's organisation and whether it has an enabled public link. */
  async operatorBoard(boardId) {
    return this.withOwnerClient(async (client) => {
      const { rows: [board] } = await client.query(
        "select id, org_id from boards where id = $1",
        [boardId],
      );
      if (!board) return null;
      const { rows: [link] } = await client.query(
        "select enabled, expires_at from board_links where board_id = $1",
        [boardId],
      );
      return {
        id: board.id,
        orgId: board.org_id,
        linkEnabled: Boolean(link?.enabled),
        linkExpiresAt: link?.expires_at ?? null,
      };
    });
  },

  /** A payment without knowing its tenant yet, with the invoice and the remaining
   * refundable amount. The refund command needs all three before it can ask a provider.
   */
  async operatorPayment(paymentId) {
    const id = String(paymentId ?? "").trim();
    if (!id) return null;
    return this.withOwnerClient(async (client) => {
      const { rows: [payment] } = await client.query(
        `select p.id, p.org_id, p.invoice_id, p.connection_id, p.provider_payment_id,
                p.amount, p.currency, p.status, p.created_at,
                i.number as invoice_number, i.period_start, i.period_end,
                i.subscription_id,
                coalesce((select sum(r.amount) from refunds r
                           where r.payment_id = p.id and r.status in ('pending', 'succeeded')), 0)
                  as refunded
           from payments p
           join invoices i on i.id = p.invoice_id
          where p.id = $1`,
        [id],
      );
      if (!payment) return null;
      return {
        ...payment,
        amount: Number(payment.amount),
        refunded: Number(payment.refunded ?? 0),
      };
    });
  },

  /**
   * The refund state of one payment under a row lock (`spec/operator-actions.md` §1.1).
   *
   * A repeated command must prove what it thinks is already returned, and it must do that
   * in a transaction that holds the payment: two operators checking at once would both
   * read the same sum otherwise. The lock is released before the provider is called —
   * holding a database transaction across a network request would be worse than the race
   * it prevents — and the write repeats the same comparison inside `recordRefund`.
   */
  async operatorRefundState({ paymentId }) {
    const id = String(paymentId ?? "").trim();
    if (!id) return null;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        `select p.id, p.org_id, p.amount, p.currency, p.status,
                coalesce((select sum(r.amount) from refunds r
                           where r.payment_id = p.id
                             and r.status in ('pending', 'succeeded')), 0) as refunded
           from payments p
          where p.id = $1
          for update of p`,
        [id],
      );
      const row = rows[0];
      if (!row) {
        await client.query("rollback");
        return null;
      }
      const state = {
        id: row.id,
        orgId: row.org_id,
        amount: Number(row.amount),
        currency: row.currency,
        status: row.status,
        refunded: Number(row.refunded ?? 0),
      };
      await client.query("commit");
      return state;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  /** Who else returned money on the payment: the concurrent warning names both people. */
  async operatorRefundAuthors({ paymentId, excludeUserId = null }) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select distinct u.id, u.email
           from refunds r
           left join users u on u.id = r.created_by
          where r.payment_id = $1
            and r.status in ('pending', 'succeeded')
            and ($2::uuid is null or r.created_by is distinct from $2::uuid)`,
        [paymentId, excludeUserId],
      );
      return rows.map((row) => ({ id: row.id ?? null, email: row.email ?? null }));
    });
  },

  /** The currency of an organisation's billing book, or the installation's first one. */
  async operatorBillingCurrency(orgId) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        "select currency from billing_accounts where org_id = $1",
        [orgId],
      );
      return rows[0]?.currency ?? null;
    });
  },

  /** The organisation behind a measure, so a letter can name its administrators. */
  async operatorActionOrg(action) {
    if (action.subjectType === "org") return action.subjectId;
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query("select org_id from boards where id = $1", [
        action.subjectId,
      ]);
      return rows[0]?.org_id ?? null;
    });
  },

  /** Active `org_admin` holders, the people an abuse letter must reach (§4). */
  async operatorOrgAdmins(orgId) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select u.id, u.email, u.name, u.lang
           from admin_roles a
           join users u on u.id = a.user_id
           join org_memberships m on m.org_id = a.org_id and m.user_id = a.user_id
          where a.org_id = $1 and a.role = 'org_admin'
            and m.state = 'active' and u.state = 'active'
          order by u.email`,
        [orgId],
      );
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        lang: row.lang,
      }));
    });
  },

  async operatorOrg(orgRef) {
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
      return mapOrg(org);
    });
  },

  /**
   * The operator's journal: every action an operator took, across tenants, with filters
   * (`spec/operator.md` §5, «Журнал»). Reasons are part of the row, because the journal
   * is where "why" is answered.
   */
  async operatorJournal({ action = null, actor = null, org = null, from = null, to = null, limit = 100 } = {}) {
    const capped = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select e.id, e.at, e.actor_id, u.email as actor_email, u.name as actor_name,
                e.org_id, o.name as org_name, e.action, e.subject, e.reason, e.after,
                e.channel, e.mfa
           from audit_events e
           left join users u on u.id = e.actor_id
           left join orgs o on o.id = e.org_id
          where ($1::text is null or e.action like $1)
            and ($2::uuid is null or e.actor_id = $2)
            and ($3::uuid is null or e.org_id = $3)
            and ($4::timestamptz is null or e.at >= $4)
            and ($5::timestamptz is null or e.at < $5)
          order by e.at desc
          limit $6`,
        [action, actor, org, from, to, capped],
      );
      return rows.map((row) => ({
        id: String(row.id),
        at: row.at,
        actorId: row.actor_id,
        actorEmail: row.actor_email,
        actorName: row.actor_name,
        orgId: row.org_id,
        orgName: row.org_name,
        action: row.action,
        subject: row.subject,
        reason: row.reason,
        after: row.after,
        // Which surface and which factor (ADR-262 §3.1 rule 5); older rows are null.
        channel: row.channel,
        mfa: row.mfa,
      }));
    });
  },

  /**
   * How many rows of one operator action exist. The metrics scrape uses it for actions
   * that only a CLI process performs (`mfa.reset`): a per-process counter cannot see
   * another process, and the audit table is the one place the act is recorded.
   */
  async countOperatorAuditAction(action) {
    const { rows } = await this.pool.query(
      "select count(*)::int as n from audit_events where action = $1",
      [action],
    );
    return rows[0]?.n ?? 0;
  },

  /** Record the password re-entry that opens changing actions (ADR-259 §1 rule 6). */
  async confirmOperatorSession(sessionId) {
    const { rows } = await this.pool.query(
      `update sessions set operator_confirmed_at = now()
        where id = $1
        returning operator_confirmed_at`,
      [sessionId],
    );
    return rows[0]?.operator_confirmed_at ?? null;
  },

  /** Organisations created since a moment: the pulse's new-organisation series. */
  async operatorPulseOrgs({ since }) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        "select id, created_at from orgs where created_at >= $1 order by created_at",
        [since],
      );
      return rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
    });
  },

  /** Live paid subscriptions: the source of MRR and of the paying-organisation count. */
  async operatorPulseSubscriptions() {
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

  /** Invitations created since a moment: the growth funnel's second step, without content. */
  async operatorPulseInvitationsSince({ since }) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        "select count(*)::int as n from invitations where created_at >= $1",
        [since],
      );
      return rows[0]?.n ?? 0;
    });
  },

  /** Undelivered letters in the window; the health block reads this number. */
  async operatorMailDeadSince(since) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        "select count(*)::int as n from mail_outbox where dead_at is not null and dead_at >= $1",
        [since],
      );
      return rows[0]?.n ?? 0;
    });
  },
};

// The support card lives in its own module for the file-size ratchet; the object is one.
Object.assign(operatorMethods, operatorCustomerMethods);
