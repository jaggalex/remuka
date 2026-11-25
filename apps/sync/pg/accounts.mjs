/**
 * Account deletion (ADR-257, `spec/account-deletion.md` §2–§3).
 *
 * Two steps, fourteen days apart. `beginAccountDeletion` stops the account at once and
 * keeps the row; `anonymiseAccount` turns that row into a tombstone and erases what
 * belongs to the person. Both run on the owner connection: one deletion spans every
 * organisation the person belonged to, so there is no tenant to select (ADR-178 — the
 * same reason migrations and the renewal pass use it). The erasure is one transaction; a
 * half-anonymised account would be worse than an untouched one.
 *
 * What the erasure does per column is the table in `spec/account-deletion.md` §3, mirrored
 * in `USER_REFERENCES` in `../account-deletion.mjs`. The database test walks
 * `information_schema`, so a new foreign key to `users` without a decision fails the gate
 * instead of silently keeping personal data.
 */
/**
 * The one query for "a shared organisation would be left without an administrator"
 * (§1.3). The confirmation screen, the operator's dry run and both delete paths read the
 * same rows, so they cannot disagree about who blocks a deletion.
 */
function blockerRows(client, userId) {
  return client
    .query(
      `select o.id, o.name, o.slug,
              (select count(*)::int
                 from org_memberships m
                where m.org_id = o.id and m.state = 'active' and m.user_id <> $1) as members
         from admin_roles a
         join orgs o on o.id = a.org_id
        where a.user_id = $1 and a.role = 'org_admin' and o.kind = 'shared'
          and exists (select 1
                        from org_memberships m
                       where m.org_id = o.id and m.state = 'active' and m.user_id <> $1)
          and not exists (select 1
                            from admin_roles other
                            join org_memberships om
                              on om.org_id = other.org_id and om.user_id = other.user_id
                           where other.org_id = o.id and other.role = 'org_admin'
                             and other.user_id <> $1 and om.state = 'active')
        order by o.name, o.id`,
      [userId],
    )
    .then((result) => result.rows);
}

export const accountMethods = {
  /**
   * Shared organisations where this person is the last active administrator and somebody
   * else is still there (§1.3). An empty answer is what allows the confirmation button.
   */
  async accountDeletionBlockers(userId) {
    if (!userId) return [];
    return this.withOwnerClient((client) => blockerRows(client, userId));
  },

  /**
   * What the operator's `--dry-run` and command need to know before anything is written:
   * the account, the blocking organisations, the shared organisations whose membership
   * goes, the personal rooms that are deleted, and the subscription that will not renew.
   * Read-only; the command still makes its own decision.
   */
  async accountDeletionSummary(userId) {
    if (!userId) return null;
    return this.withOwnerClient(async (client) => {
      const { rows: [user] } = await client.query(
        `select id, email, name, state, deletion_requested_at
           from users where id = $1`,
        [userId],
      );
      if (!user) {
        return { user: null, blockers: [], sharedOrgs: [], rooms: [], subscription: null };
      }
      const blockers = await blockerRows(client, userId);
      const { rows: sharedOrgs } = await client.query(
        `select o.id, o.name, o.slug,
                exists (select 1
                          from admin_roles a
                         where a.org_id = o.id and a.user_id = $1 and a.role = 'org_admin')
                  as admin
           from org_memberships m
           join orgs o on o.id = m.org_id
          where m.user_id = $1 and m.state = 'active' and o.kind = 'shared'
          order by o.name, o.id`,
        [userId],
      );
      const { rows: rooms } = await client.query(
        `select b.id, b.title, b.archived_at
           from boards b
           join orgs o on o.id = b.org_id
          where o.kind = 'personal' and o.created_by = $1
          order by b.title, b.id`,
        [userId],
      );
      const { rows: [subscription] } = await client.query(
        `select s.plan, s.status, s.current_period_end, s.cancel_at_period_end
           from subscriptions s
           join orgs o on o.id = s.org_id
          where o.kind = 'personal' and o.created_by = $1
          order by s.created_at desc
          limit 1`,
        [userId],
      );
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          state: user.state,
          deletionRequestedAt: user.deletion_requested_at,
        },
        blockers,
        sharedOrgs: sharedOrgs.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          admin: row.admin,
        })),
        rooms: rooms.map((row) => ({
          id: row.id,
          title: row.title,
          archived: row.archived_at != null,
        })),
        subscription: subscription
          ? {
              plan: subscription.plan,
              status: subscription.status,
              currentPeriodEnd: subscription.current_period_end,
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
            }
          : null,
      };
    });
  },

  /**
   * The `account.delete` command's write: stop the account now (§2.3), end every session
   * and key, write the audit row. The paid plan is cancelled by `deleteAccount` before
   * this call, through the billing module's own flag; the cancellation e-mail is a later
   * stage. The step already makes the account unusable and is idempotent, so a repeated
   * request changes nothing.
   *
   * `state: 'deleting'` with `changed: false` is a success, not an error: the first request
   * has already done the work. An operator acting for somebody passes its own `action`,
   * `actorId`, `reason` and `auditWhenUnchanged`, so the journal names the operator even
   * when the account was already on its way out; a tombstone is never written twice.
   */
  async beginAccountDeletion({
    userId,
    requestId = null,
    now = new Date(),
    actorId = null,
    action = "account.delete",
    reason = null,
    actorType = "user",
    auditWhenUnchanged = false,
  }) {
    if (!userId) throw new Error("beginAccountDeletion needs a user id");
    return this.withOwnerClient(async (client) => {
      await client.query("begin");
      const audit = (before, after) =>
        client.query(
          `insert into audit_events
             (actor_id, action, subject, before, after, request_id, reason, actor_type)
           values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
          [
            actorId ?? userId,
            action,
            userId,
            JSON.stringify(before),
            JSON.stringify(after),
            requestId,
            reason,
            actorType,
          ],
        );
      try {
        const { rows: [user] } = await client.query(
          "select id, email, state, deletion_requested_at from users where id = $1 for update",
          [userId],
        );
        if (!user) {
          await client.query("rollback");
          return { state: "missing", changed: false };
        }
        if (user.state === "deleted") {
          await client.query("rollback");
          return { state: "deleted", changed: false };
        }
        if (user.state === "deleting") {
          // A repeated self-request is a no-op; an operator's purge still records that the
          // operator acted on an account somebody else had already stopped.
          if (auditWhenUnchanged) {
            await audit(
              { state: "deleting", deletionRequestedAt: user.deletion_requested_at },
              { state: "deleting", deletionRequestedAt: user.deletion_requested_at },
            );
          } else {
            await client.query("rollback");
            return {
              state: "deleting",
              changed: false,
              deletionRequestedAt: user.deletion_requested_at,
            };
          }
          await client.query("commit");
          return {
            state: "deleting",
            changed: false,
            deletionRequestedAt: user.deletion_requested_at,
          };
        }

        const { rows: [updated] } = await client.query(
          `update users
              set state = 'deleting', deletion_requested_at = $2, updated_at = now()
            where id = $1
            returning deletion_requested_at`,
          [userId, now],
        );

        // The account stops working: no session, no reset link, no integration or agent
        // token may outlive this command (§2.3).
        await client.query("delete from sessions where user_id = $1", [userId]);
        await client.query("delete from auth_tokens where user_id = $1", [userId]);
        await client.query("delete from integration_tokens where owner_id = $1", [userId]);
        await client.query(
          `delete from agent_tokens
            where agent_id in (select id from agents where owner_id = $1)`,
          [userId],
        );

        await audit(
          { state: user.state },
          { state: "deleting", deletionRequestedAt: updated.deletion_requested_at },
        );

        await client.query("commit");
        return {
          state: "deleting",
          changed: true,
          deletionRequestedAt: updated.deletion_requested_at,
        };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  },

  /**
   * Undo a request before its deadline (§2.4), under the same row lock as the purge. The
   * cutoff comes from the command, so the fourteen days live in one place. A row that is
   * already a tombstone is `deleted`; a request older than the cutoff is `expired` and is
   * left exactly as it was.
   */
  async cancelAccountDeletion({ userId, cutoff, requestId = null }) {
    if (!userId) throw new Error("cancelAccountDeletion needs a user id");
    if (!(cutoff instanceof Date)) throw new Error("cancelAccountDeletion needs a cutoff date");
    return this.withOwnerClient(async (client) => {
      await client.query("begin");
      try {
        const { rows: [user] } = await client.query(
          "select id, state, deletion_requested_at from users where id = $1 for update",
          [userId],
        );
        if (!user) {
          await client.query("rollback");
          return { state: "missing", changed: false };
        }
        if (user.state === "deleted") {
          await client.query("rollback");
          return { state: "deleted", changed: false };
        }
        if (user.state !== "deleting") {
          await client.query("rollback");
          return { state: user.state, changed: false };
        }
        if (!user.deletion_requested_at || user.deletion_requested_at <= cutoff) {
          await client.query("rollback");
          return { state: "expired", changed: false };
        }

        await client.query(
          `update users
              set state = 'active', deletion_requested_at = null, updated_at = now()
            where id = $1`,
          [userId],
        );
        // The letter is spent with the request it undid: a second click changes nothing.
        await client.query(
          `update auth_tokens set used_at = now()
            where user_id = $1 and purpose = 'account_restore' and used_at is null`,
          [userId],
        );
        await client.query(
          `insert into audit_events
             (actor_id, action, subject, before, after, request_id, actor_type)
           values ($1, 'account.delete_cancelled', $2, $3::jsonb, $4::jsonb, $5, 'user')`,
          [
            userId,
            userId,
            JSON.stringify({
              state: "deleting",
              deletionRequestedAt: user.deletion_requested_at,
            }),
            JSON.stringify({ state: "active" }),
            requestId,
          ],
        );
        await client.query("commit");
        return { state: "active", changed: true };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  },

  /** The one organisation every account gets (ADR-167); the command cancels its plan. */
  async personalOrgIds(userId) {
    if (!userId) return [];
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        "select id from orgs where kind = 'personal' and created_by = $1",
        [userId],
      );
      return rows.map((row) => row.id);
    });
  },

  /** Accounts whose fourteen days are over, oldest first. A cancelled deletion is not here. */
  async accountsDueForDeletion({ cutoff, limit = 50 }) {
    if (!(cutoff instanceof Date)) throw new Error("accountsDueForDeletion needs a cutoff date");
    const { rows } = await this.pool.query(
      `select id, email, deletion_requested_at
         from users
        where state = 'deleting'
          and deletion_requested_at is not null
          and deletion_requested_at <= $1
        order by deletion_requested_at, id
        limit $2`,
      [cutoff, Math.min(Math.max(Number(limit) || 1, 1), 500)],
    );
    return rows;
  },

  /**
   * Rooms of the personal organisation, read before the erasure so the job can unload
   * them from memory. A later flush of such a room would write a `boards` row the erasure
   * has already deleted, which is a foreign-key failure, not a harmless no-op.
   */
  async accountBoardIds(userId) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select b.id
           from boards b
           join orgs o on o.id = b.org_id
          where o.kind = 'personal' and o.created_by = $1`,
        [userId],
      );
      return rows.map((row) => row.id);
    });
  },

  /**
   * The files whose bytes go with the personal organisation. Read before the erasure:
   * object storage cannot join a transaction, and the keys must be deleted before the
   * rows, or a crash leaves bytes nothing can name (the `files-gc` order).
   */
  async accountFilesToErase(userId) {
    return this.withOwnerClient(async (client) => {
      const { rows } = await client.query(
        `select f.id, f.org_id
           from files f
           join orgs o on o.id = f.org_id
          where o.kind = 'personal' and o.created_by = $1`,
        [userId],
      );
      return rows;
    });
  },

  /**
   * The irreversible step: personal data goes, the rows history needs stay (§3). Runs only
   * on a row still in `deleting`, so a cancellation that arrived in the meantime wins.
   */
  async anonymiseAccount({ userId, requestId = null }) {
    if (!userId) throw new Error("anonymiseAccount needs a user id");
    return this.withOwnerClient(async (client) => {
      await client.query("begin");
      try {
        const { rows: [user] } = await client.query(
          "select id, email, state from users where id = $1 for update",
          [userId],
        );
        if (!user) {
          await client.query("rollback");
          return { state: "missing" };
        }
        if (user.state !== "deleting") {
          await client.query("rollback");
          return { state: user.state };
        }

        // A name copied into content outlives the account unless it is cleared here.
        await client.query(
          "update comments set author_name = '', author_handle = '' where author_id = $1",
          [userId],
        );
        await client.query(
          "update comment_threads set created_by_name = '' where created_by = $1",
          [userId],
        );
        await client.query(
          "update agent_thread_messages set author_name = '' where author_id = $1",
          [userId],
        );
        await client.query(
          "update vote_sessions set created_by_name = '' where created_by = $1",
          [userId],
        );
        await client.query(
          "delete from comment_reads where subject_id = $1",
          [`user:${userId}`],
        );

        // Rows that exist only to let this person in or act for them.
        await client.query("delete from sessions where user_id = $1", [userId]);
        await client.query("delete from auth_tokens where user_id = $1", [userId]);
        // The second factor is destroyed with the account (ADR-260 §3): a tombstone holds
        // no secret, no recovery code and no challenge that could be finished later.
        await client.query("delete from user_mfa where user_id = $1", [userId]);
        await client.query("delete from user_mfa_recovery_codes where user_id = $1", [userId]);
        await client.query("delete from mfa_challenges where user_id = $1", [userId]);
        // The shell lock's rows are a counter, not history (schema 39): they go too.
        await client.query("delete from mfa_cli_attempts where user_id = $1", [userId]);
        await client.query("delete from integration_tokens where owner_id = $1", [userId]);
        await client.query("delete from admin_roles where user_id = $1", [userId]);
        await client.query("delete from org_memberships where user_id = $1", [userId]);
        await client.query("delete from team_memberships where user_id = $1", [userId]);
        await client.query(
          "delete from board_grants where subject_type = 'user' and subject_id = $1",
          [userId],
        );
        await client.query("delete from instance_operators where user_id = $1", [userId]);

        // An invitation nobody accepted is the sender's row (§3); an accepted one is the
        // organisation's history and stays, pointing at the tombstone.
        await client.query(
          "delete from invitations where created_by = $1 and accepted_at is null",
          [userId],
        );
        await client.query(
          "delete from mail_outbox where user_id = $1 or lower(to_email) = lower($2)",
          [userId, user.email],
        );

        // The agent and its keys belong to its owner; the organisation's own keys stay.
        await client.query("delete from agents where owner_id = $1", [userId]);
        await client.query(
          "delete from ai_credentials where scope = 'user' and scope_id = $1",
          [userId],
        );

        // Rooms in a shared organisation lose their owner and go through the claim flow;
        // the personal organisation's rooms are deleted with it, bypassing the bin (§3).
        await client.query("update boards set owner_id = null where owner_id = $1", [userId]);
        const { rows: personal } = await client.query(
          "select id from orgs where kind = 'personal' and created_by = $1",
          [userId],
        );
        const personalIds = personal.map((row) => row.id);
        let boards = 0;
        if (personalIds.length) {
          const { rowCount } = await client.query(
            "delete from boards where org_id = any($1::uuid[])",
            [personalIds],
          );
          boards = rowCount ?? 0;
          // The bytes went before this transaction (`accountFilesToErase`); the rows must
          // go even when a money-pinned organisation stays, or the shell keeps file
          // metadata for objects that no longer exist.
          await client.query("delete from files where org_id = any($1::uuid[])", [personalIds]);
        }

        // Money keeps an organisation alive (`on delete restrict`, ADR-247); its rooms are
        // gone anyway, so only a shell with an anonymised name and contact remains.
        let keptOrgs = 0;
        if (personalIds.length) {
          const { rows: pinned } = await client.query(
            `select o.id
               from orgs o
              where o.id = any($1::uuid[])
                and (exists (select 1 from billing_accounts where org_id = o.id)
                  or exists (select 1 from payment_methods where org_id = o.id)
                  or exists (select 1 from subscriptions where org_id = o.id)
                  or exists (select 1 from invoices where org_id = o.id)
                  or exists (select 1 from payments where org_id = o.id)
                  or exists (select 1 from refunds where org_id = o.id)
                  or exists (select 1 from org_credit_ledger where org_id = o.id)
                  or exists (select 1 from billing_events where org_id = o.id))`,
            [personalIds],
          );
          const keptIds = pinned.map((row) => row.id);
          const removable = personalIds.filter((id) => !keptIds.includes(id));
          if (removable.length) {
            await client.query("delete from orgs where id = any($1::uuid[])", [removable]);
          }
          if (keptIds.length) {
            keptOrgs = keptIds.length;
            await client.query(
              `update orgs set name = '', slug = 'deleted-' || id where id = any($1::uuid[])`,
              [keptIds],
            );
            await client.query(
              `update billing_accounts
                  set billing_email = 'deleted-' || org_id::text || '@invalid',
                      billing_name = null
                where org_id = any($1::uuid[])`,
              [keptIds],
            );
          }
        }

        // The journal is append-only in meaning, not in bytes: the address it recorded as
        // a subject is personal data, so it becomes the tombstone id. The row, its action
        // and its result stay (§3).
        await client.query("update audit_events set subject = $1 where subject = $2", [
          userId,
          user.email,
        ]);

        // The consent journal stays as proof of a choice: the tombstone id is the
        // pseudonym, the user agent goes, and `ip_hash` is already a keyed digest (§3).
        await client.query(
          "update consent_events set user_agent = null where user_id = $1",
          [userId],
        );

        // A legal acceptance is proof too, but the erasure does not wait for the retention
        // period: the address digest goes now. The row, the revision and the hash stay.
        await client.query(
          "update legal_acceptances set user_agent = null, ip_hash = null where user_id = $1",
          [userId],
        );

        // `handle` and `password_hash` are NOT NULL, so the tombstone is an unguessable
        // random handle and an empty hash rather than null.
        const { rows: [erased] } = await client.query(
          `update users
              set email = 'deleted-' || id::text || '@invalid',
                  name = '',
                  handle = 'deleted-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
                  password_hash = '',
                  support_id = null,
                  theme = null,
                  lang = null,
                  motion = null,
                  email_verified_at = null,
                  state = 'deleted',
                  updated_at = now()
            where id = $1
            returning id, state, email`,
          [userId],
        );

        await client.query(
          `insert into audit_events
             (actor_id, action, subject, before, after, request_id, actor_type)
           values (null, 'account.purged', $1, $2::jsonb, $3::jsonb, $4, 'system')`,
          [
            userId,
            JSON.stringify({ state: "deleting" }),
            JSON.stringify({ boards, personalOrgs: personalIds.length, keptOrgs }),
            requestId,
          ],
        );

        await client.query("commit");
        return {
          state: "deleted",
          email: erased.email,
          boards,
          personalOrgs: personalIds.length,
          keptOrgs,
        };
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  },
};
