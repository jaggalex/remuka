/**
 * The anonymisation job (ADR-257, `spec/account-deletion.md` §2.5).
 *
 * Same shape as the mail drain: a timer, one pass at a time, a failure logged and retried
 * on the next pass. It picks only rows that are `deleting` and whose fourteen days are
 * over, so a restored account is never touched; `anonymiseAccount` checks the state again
 * under a row lock for the same reason.
 *
 * Object bytes go first, as in `files-gc`: a crash between the keys and the transaction
 * leaves rows that a retry finishes, while the opposite order would leave bytes nothing
 * can name. A missing key is already gone, never an error.
 *
 * A live room is the one writer that can race the erasure: a client update after the
 * `boards` row is gone would try to flush against a deleted foreign key. The job therefore
 * closes the person's sockets and flushes the personal rooms through the store's own
 * `writeState` before it deletes anything (the mechanism `close()` and the last-socket
 * teardown already use), not a second room lifecycle.
 */
import { ACCOUNT_DELETION_GRACE_MS } from "./account-deletion.mjs";
import { FILE_VARIANTS, fileKey } from "./files-store.mjs";

/** An hour is soon enough for a deadline measured in days; boot does not wait for it. */
export const ACCOUNT_PURGE_INTERVAL_MS = 60 * 60 * 1000;

function short(id) {
  return String(id ?? "").slice(0, 8);
}

async function eraseFiles({ store, fileStore, log }, userId) {
  if (!fileStore || typeof store.accountFilesToErase !== "function") return 0;
  const files = await store.accountFilesToErase(userId);
  for (const file of files) {
    for (const variant of FILE_VARIANTS) {
      try {
        await fileStore.delete(fileKey(file.org_id, file.id, variant));
      } catch (error) {
        // Best effort per key: the erasure must not stop because one object is missing.
        log.error?.(
          `[account] file ${variant} for ${file.id}: ${error?.code ?? error?.message ?? "ERROR"}`,
        );
      }
    }
  }
  return files.length;
}

/**
 * Close the sockets of the person and flush the personal rooms before their rows go.
 * Rooms are keyed by board id; a disk store or a board that was never loaded has
 * nothing to flush and needs no special case.
 */
async function unloadRooms({ store, connections }, userId) {
  if (typeof store.accountBoardIds !== "function") return 0;
  const ids = await store.accountBoardIds(userId);
  if (!ids.length) return 0;
  connections?.closeUserConnections?.(userId);
  if (typeof store.writeState === "function") {
    for (const boardId of ids) {
      const room = store.rooms?.get?.(boardId);
      if (room?.ydoc) await store.writeState(boardId, room.ydoc);
    }
  }
  return ids.length;
}

/**
 * A saved card must not stay chargeable after the person is gone. The billing module
 * owns the revocation (state and subscription in one transaction), so the job calls it
 * and keeps the `display` for the accounting history, as §3 says.
 */
async function revokeCards({ store }, userId) {
  if (
    typeof store.personalOrgIds !== "function" ||
    typeof store.revokePaymentMethod !== "function"
  ) {
    return 0;
  }
  let revoked = 0;
  for (const orgId of await store.personalOrgIds(userId)) {
    const result = await store.revokePaymentMethod(orgId);
    revoked += result?.revoked ?? 0;
  }
  return revoked;
}

/**
 * The one purge of one account: unload the rooms, stop the card, erase the bytes, then
 * anonymise in one transaction. The hourly job and the operator's `--now` both call this,
 * so the order exists once; a second copy would be a second lifecycle to keep in step.
 */
export async function purgeAccount({
  store,
  userId,
  fileStore = null,
  connections = null,
  log = console,
}) {
  await unloadRooms({ store, connections }, userId);
  await revokeCards({ store }, userId);
  await eraseFiles({ store, fileStore, log }, userId);
  return store.anonymiseAccount({ userId });
}

export function createAccountPurge({
  store,
  fileStore = null,
  connections = null,
  log = console,
  metrics = null,
  now = () => new Date(),
  intervalMs = ACCOUNT_PURGE_INTERVAL_MS,
  graceMs = ACCOUNT_DELETION_GRACE_MS,
}) {
  let timer = null;
  let running = false;

  async function purgeOne(user) {
    return purgeAccount({ store, userId: user.id, fileStore, connections, log });
  }

  /** One pass; returns how many accounts became tombstones. */
  async function runOnce({ limit = 50 } = {}) {
    if (running) return 0;
    if (typeof store.accountsDueForDeletion !== "function") return 0;
    running = true;
    try {
      const due = await store.accountsDueForDeletion({
        cutoff: new Date(now().getTime() - graceMs),
        limit,
      });
      let purged = 0;
      for (const user of due) {
        try {
          const result = await purgeOne(user);
          if (result.state !== "deleted") continue;
          purged += 1;
          metrics?.inc("remo_account_purged_total");
          log.log(`[account] purged ${short(user.id)}`);
        } catch (error) {
          const code = error?.code ?? error?.name ?? "ACCOUNT_PURGE_ERROR";
          metrics?.inc("remo_account_purge_failed_total", { code });
          log.error(`[account] purge ${short(user.id)} failed: ${error?.message ?? code}`);
        }
      }
      return purged;
    } catch (error) {
      log.error("[account] purge pass failed:", error.message);
      return 0;
    } finally {
      running = false;
    }
  }

  /** Called once on listen; a disk store has no `users` table and does nothing. */
  function start() {
    if (typeof store.accountsDueForDeletion !== "function") return;
    timer = setInterval(() => void runOnce(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { runOnce, start, stop };
}
