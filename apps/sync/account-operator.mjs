/**
 * The operator's side of `account.delete` (ADR-257, `spec/account-deletion.md` §4).
 *
 * A person deletes their own account through `deleteAccount`; this command acts on a
 * different account because the person wrote to the privacy address or a court asked. It
 * is not a flag on the self path: the role is checked first (`instance_operators`,
 * ADR-248), the audit row names the operator rather than the person, and `--now` skips the
 * fourteen days by calling the hourly job's own `purgeAccount` instead of a second copy of
 * the erasure.
 *
 * `--dry-run` reads the same summary the command uses to decide, so the preview and the
 * action cannot describe different data. Nothing is written before the permission, the
 * tombstone and the blocking organisations have been checked.
 */
import { AccountDeletionError } from "./account-deletion.mjs";
import { purgeAccount } from "./account-purge.mjs";

/** The exact function the hourly job uses; the CLI test proves it is not a copy. */
export { purgeAccount };

/**
 * Ask for an operator deletion, or perform the erasure at once when `purgeNow` is set.
 *
 * Idempotency is the tombstone's: a repeated `--now` on an account that is already
 * `deleted` answers `ok` without a second audit row, because the store refuses to write a
 * tombstone twice. A repeated request without `--now` is refused with `ACCOUNT_DELETED`.
 */
export async function deleteAccountAsOperator({
  store,
  userId,
  actorId,
  reason = null,
  now = () => new Date(),
  purgeNow = false,
  dryRun = false,
  fileStore = null,
  connections = null,
  log = console,
  requestId = null,
}) {
  if (!actorId) {
    throw new AccountDeletionError(
      "OPERATOR_REQUIRED",
      "name the operator with --operator or REMO_OPERATOR",
      401,
    );
  }
  if (typeof store.isInstanceOperator !== "function") {
    throw new AccountDeletionError(
      "ACCOUNT_DELETION_UNAVAILABLE",
      "accounts need the postgres store",
      501,
    );
  }
  if (!(await store.isInstanceOperator(actorId))) {
    throw new AccountDeletionError(
      "FORBIDDEN",
      "only an instance operator may delete another account",
      403,
    );
  }
  if (!userId) {
    throw new AccountDeletionError("ACCOUNT_NOT_FOUND", "account not found", 404);
  }
  if (typeof store.accountDeletionSummary !== "function") {
    throw new AccountDeletionError(
      "ACCOUNT_DELETION_UNAVAILABLE",
      "accounts need the postgres store",
      501,
    );
  }

  const summary = await store.accountDeletionSummary(userId);
  if (!summary?.user) {
    throw new AccountDeletionError("ACCOUNT_NOT_FOUND", "account not found", 404);
  }

  if (dryRun) {
    return { dryRun: true, blocked: summary.blockers.length > 0, summary };
  }

  if (summary.user.state === "deleted") {
    if (purgeNow) {
      return { state: "deleted", changed: false, alreadyDeleted: true, purged: false };
    }
    throw new AccountDeletionError("ACCOUNT_DELETED", "the account is already deleted", 409);
  }

  if (summary.blockers.length) {
    throw new AccountDeletionError(
      "LAST_ADMIN",
      "appoint another administrator in every shared organisation first",
      409,
      { orgs: summary.blockers },
    );
  }

  // The paid personal plan must not renew while the account is disappearing. The billing
  // module owns the flag, exactly as in the self path (§2.1).
  if (
    typeof store.personalOrgIds === "function" &&
    typeof store.cancelAtPeriodEnd === "function"
  ) {
    for (const orgId of await store.personalOrgIds(userId)) {
      await store.cancelAtPeriodEnd(orgId);
    }
  }

  const result = await store.beginAccountDeletion({
    userId,
    requestId,
    now: now(),
    actorId,
    action: "account.delete_operator",
    reason,
    auditWhenUnchanged: purgeNow,
  });
  if (result.state === "missing") {
    throw new AccountDeletionError("ACCOUNT_NOT_FOUND", "account not found", 404);
  }
  if (result.state === "deleted") {
    if (purgeNow) {
      return { state: "deleted", changed: false, alreadyDeleted: true, purged: false };
    }
    throw new AccountDeletionError("ACCOUNT_DELETED", "the account is already deleted", 409);
  }

  if (!purgeNow) return { ...result, purged: false };

  const erased = await purgeAccount({ store, userId, fileStore, connections, log });
  if (erased.state !== "deleted") {
    // A cancellation that raced this command won the row; the operator must see that the
    // erasure did not happen rather than a success that did not.
    throw new AccountDeletionError(
      "ACCOUNT_NOT_DELETED",
      "the account was not erased; it may have been restored",
      409,
      { state: erased.state },
    );
  }
  return { ...erased, changed: true, alreadyDeleted: false, purged: true };
}
