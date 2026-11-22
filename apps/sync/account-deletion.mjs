/**
 * The `account.delete` command (ADR-257, `spec/account-deletion.md` §2).
 *
 * One mechanism for the settings screen and, later, the operator command: the caller is
 * the account itself, the answer names the organisations that block it, and the store does
 * the work in one transaction with an audit row. `cancelAccountDeletion` is the other half
 * of the same promise: a stopped account can come back while its fourteen days last, by
 * the link from the letter or by a still-valid session. Both commands are the only place
 * that decides, so the HTTP layer only turns their answers into status codes.
 */
/** Fourteen days to change one's mind, then the backups' own fourteen (§1.5). */
export const ACCOUNT_DELETION_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

/** A refusal the future HTTP layer turns into `{ error, message }` with this status. */
export class AccountDeletionError extends Error {
  constructor(code, message, status = 422, details = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** When the fourteen days run out; the job compares this with its own clock. */
export function deletionDueAt(requestedAt) {
  const at = requestedAt instanceof Date ? requestedAt : new Date(requestedAt);
  if (Number.isNaN(at.getTime())) throw new Error("deletionDueAt needs a date");
  return new Date(at.getTime() + ACCOUNT_DELETION_GRACE_MS);
}

/**
 * Every foreign key to `users` and what the purge does with it, one line per column of
 * `spec/account-deletion.md` §3. A new reference without an entry fails
 * `account-deletion.db.test.mjs`, which walks `information_schema`; that is the test the
 * specification asks for. `conditional` means the row decides: a pending invitation goes,
 * an accepted one stays as the organisation's history.
 */
export const USER_REFERENCES = {
  // The author of a room stays its author; the column keeps pointing at the tombstone.
  "boards.created_by": "keep",
  "sessions.user_id": "delete",
  "auth_tokens.user_id": "delete",
  // The second factor belongs to the account alone and is destroyed with it (ADR-260 §3):
  // a tombstone keeps no secret, no recovery code and no pending challenge.
  "user_mfa.user_id": "delete",
  "user_mfa_recovery_codes.user_id": "delete",
  "mfa_challenges.user_id": "delete",
  // Wrong shell codes are a counter, not history (schema 39, `spec/operator-actions.md` §5):
  // a tombstone keeps none of them.
  "mfa_cli_attempts.user_id": "delete",
  // The journal stays as proof; `user_agent` is cleared, `ip_hash` is already a digest.
  "consent_events.user_id": "keep",
  // The acceptance stays as proof too; the purge clears its address digest (§3, ADR-256).
  "legal_acceptances.user_id": "keep",
  // A shared organisation keeps its creator; a personal one is deleted or shelled.
  "orgs.created_by": "keep",
  "org_memberships.user_id": "delete",
  "admin_roles.user_id": "delete",
  // A grant somebody else received from this person is their access, not his.
  "admin_roles.granted_by": "keep",
  "team_memberships.user_id": "delete",
  "board_grants.granted_by": "keep",
  "board_links.created_by": "keep",
  "invitations.created_by": "conditional",
  "invitations.accepted_by": "keep",
  // The agent, its keys and its history belong to its owner and go with the account.
  "agents.owner_id": "delete",
  "agents.created_by": "keep",
  "agent_tokens.created_by": "keep",
  "agent_skills.created_by": "keep",
  "agent_skills.published_by": "keep",
  "agent_schedules.created_by": "keep",
  "agent_tasks.created_by": "keep",
  "ai_credentials.created_by": "keep",
  "agent_change_sets.created_by": "keep",
  "agent_task_plans.approved_by": "keep",
  "agent_task_plans.rejected_by": "keep",
  "org_webhooks.created_by": "keep",
  "mail_outbox.user_id": "delete",
  "integration_tokens.owner_id": "delete",
  "integration_tokens.created_by": "keep",
  "org_apps.installed_by": "keep",
  "comment_threads.resolved_by": "keep",
  // The thread stays with the room; the copied names are cleared by the purge.
  "comment_threads.created_by": "keep",
  "comments.author_id": "keep",
  "board_agents.assigned_by": "keep",
  "agent_threads.created_by": "keep",
  "agent_thread_messages.author_id": "keep",
  "prices.created_by": "keep",
  "price_events.actor_id": "keep",
  "payment_connections.created_by": "keep",
  "payment_connection_events.actor_id": "keep",
  "instance_operators.user_id": "delete",
  "instance_operators.granted_by": "keep",
  // A measure's journal row stays after its author leaves, without the author's id.
  "operator_actions.created_by": "keep",
  "operator_actions.reverted_by": "keep",
  // An idempotency row is a form's memory for 30 days, not history: it goes with the
  // operator's account (schema 37, `spec/operator-actions.md` §3.3).
  "operator_requests.operator_id": "delete",
  "payment_methods.created_by": "keep",
  "refunds.created_by": "keep",
  "org_credit_ledger.created_by": "keep",
  "files.uploaded_by": "keep",
};

/**
 * Ask for the account to be stopped. The caller is the account itself (§2.1); the operator
 * path that acts for somebody is a separate stage and its own permission, not a flag here.
 *
 * Blocking organisations are refused before anything is written, so the screen can show
 * them and the person can appoint another administrator; the store checks nothing, because
 * one mechanism must decide (§1.4).
 */
export async function deleteAccount({
  store,
  userId,
  actorId,
  requestId = null,
  now = () => new Date(),
}) {
  if (!userId) {
    throw new AccountDeletionError("AUTH_REQUIRED", "sign in first", 401);
  }
  if (!actorId || actorId !== userId) {
    throw new AccountDeletionError(
      "FORBIDDEN",
      "an account can only delete itself",
      403,
    );
  }
  if (typeof store.accountDeletionBlockers !== "function") {
    throw new AccountDeletionError(
      "ACCOUNT_DELETION_UNAVAILABLE",
      "accounts need the postgres store",
      501,
    );
  }
  const blockers = await store.accountDeletionBlockers(userId);
  if (blockers.length) {
    throw new AccountDeletionError(
      "LAST_ORG_ADMIN",
      "appoint another administrator in every shared organisation first",
      409,
      { orgs: blockers },
    );
  }
  // A paid personal plan must not renew while the account is on its way out (§2.1). The
  // billing module owns the flag and the event that records it, so the command calls it
  // instead of writing `subscriptions` a second way; resuming is that module's route too.
  if (
    typeof store.personalOrgIds === "function" &&
    typeof store.cancelAtPeriodEnd === "function"
  ) {
    for (const orgId of await store.personalOrgIds(userId)) {
      await store.cancelAtPeriodEnd(orgId);
    }
  }
  const result = await store.beginAccountDeletion({ userId, requestId, now: now() });
  if (result.state === "missing") {
    throw new AccountDeletionError("ACCOUNT_NOT_FOUND", "account not found", 404);
  }
  if (result.state === "deleted") {
    throw new AccountDeletionError("ACCOUNT_DELETED", "the account is already deleted", 409);
  }
  return result;
}

/**
 * Undo a request that has not reached its deadline (§2.4). The store locks the row and
 * compares the request date with the cutoff, so a cancellation that raced the purge loses
 * honestly: the erasure already owns the row and the answer is `TOO_LATE`.
 *
 * A subscription stays `cancel_at_period_end`: the promise of §2.1 is that deletion does
 * not renew a plan, and undoing the deletion does not silently buy another period. The
 * person can resume the plan through the billing screen if they want it back.
 */
export async function cancelAccountDeletion({
  store,
  userId,
  actorId,
  requestId = null,
  now = () => new Date(),
}) {
  if (!userId) {
    throw new AccountDeletionError("AUTH_REQUIRED", "sign in first", 401);
  }
  if (!actorId || actorId !== userId) {
    throw new AccountDeletionError(
      "FORBIDDEN",
      "an account can only cancel its own deletion",
      403,
    );
  }
  if (typeof store.cancelAccountDeletion !== "function") {
    throw new AccountDeletionError(
      "ACCOUNT_DELETION_UNAVAILABLE",
      "accounts need the postgres store",
      501,
    );
  }
  const at = now();
  const result = await store.cancelAccountDeletion({
    userId,
    cutoff: new Date(at.getTime() - ACCOUNT_DELETION_GRACE_MS),
    requestId,
  });
  if (result.state === "missing") {
    throw new AccountDeletionError("ACCOUNT_NOT_FOUND", "account not found", 404);
  }
  if (result.state === "deleted") {
    throw new AccountDeletionError("TOO_LATE", "the account is already erased", 410);
  }
  if (result.state === "expired") {
    throw new AccountDeletionError(
      "TOO_LATE",
      "the fourteen days for cancelling are over",
      410,
    );
  }
  return result;
}
