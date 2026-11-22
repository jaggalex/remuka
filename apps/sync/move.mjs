/**
 * The planned move of the cloud to a new public address (ADR-254, `spec/rebrand.md` §6).
 *
 * A cookie belongs to the host that set it, so the day the address changes every person
 * signs in again. The browser warns them during the week before — but only when the
 * operator says both *where* and *when*: an address without a date cannot be phrased, and
 * a date without an address has nothing to point at. A half-set pair is a configuration
 * mistake, so it is logged once at start and the banner stays off.
 *
 * `GET /config` carries the pair; the client decides whether the notice is due yet.
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar day in `YYYY-MM-DD`, or null for a malformed or impossible date. */
export function moveDay(raw) {
  const value = String(raw ?? "").trim();
  const match = ISO_DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const at = new Date(Date.UTC(year, month - 1, day));
  if (
    at.getUTCFullYear() !== year ||
    at.getUTCMonth() !== month - 1 ||
    at.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

/** An absolute https origin without a path, query or fragment, or null. */
export function moveOrigin(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    // A malformed address is ignored rather than written into a banner.
    return null;
  }
}

/** `{ to, at }` when both variables are present and valid; otherwise null. */
export function resolveMove(env = process.env) {
  const to = moveOrigin(env.REMO_APP_MOVE_TO);
  const at = moveDay(env.REMO_APP_MOVE_AT);
  if (!to || !at) return null;
  return { to, at };
}

/**
 * One warning at start when the move variables cannot be used.
 *
 * Neither variable set is the normal state and says nothing; a partial or malformed pair
 * is the operator's typo and is the one thing this check says out loud.
 */
export function warnMove(env = process.env, log = console.warn) {
  const configured =
    String(env.REMO_APP_MOVE_TO ?? "").trim() || String(env.REMO_APP_MOVE_AT ?? "").trim();
  if (!configured || resolveMove(env)) return;
  log(
    "[sync] move: set both REMO_APP_MOVE_TO (an https origin) and REMO_APP_MOVE_AT (YYYY-MM-DD), or neither; the move banner stays off",
  );
}
