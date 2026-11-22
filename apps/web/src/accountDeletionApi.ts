import { call } from "./apiCall";

/**
 * The account-deletion calls (ADR-257, `spec/account-deletion.md` §2).
 *
 * Kept beside `api.ts` for the same reason as the mail calls: the main client is at its
 * file-size budget, and these are the only two routes that exist for leaving.
 */
export interface DeletionSchedule {
  /** The moment the data is erased; the link and the banner both count down to it. */
  deletionAt: string;
  /** The one-time cancellation token, held in memory for this screen only. */
  restoreToken?: string;
}

/** Stops the account at once; the person confirms with the password and the phrase. */
export function requestAccountDeletion(body: {
  password: string;
  phrase: string;
}): Promise<DeletionSchedule> {
  return call<DeletionSchedule>("/account/delete", { method: "POST", body });
}

/** Accepts the token from the letter or, while one exists, the current session. */
export function cancelAccountDeletion(
  body: { token?: string } = {},
): Promise<{ ok: true; state: string; changed: boolean }> {
  return call<{ ok: true; state: string; changed: boolean }>("/account/delete/cancel", {
    method: "POST",
    body,
  });
}
