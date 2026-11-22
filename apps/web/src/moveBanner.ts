/**
 * The planned move notice (`spec/rebrand-fixes.md` §1, `spec/rebrand.md` §6).
 *
 * `/config` may carry `{ to, at }`; this module decides whether the reader should see the
 * notice today, how the new host and the date are written, and whether the reader has
 * already closed it. It is pure except for the two sessionStorage helpers, so the decision
 * is tested without a browser and a board renders the same answer as the home.
 */

/** What `GET /config` may add: the new address and the day it happens. */
export interface MoveInfo {
  to: string;
  at: string;
}

/** Days before the move the notice appears, inclusive; anything outside is silent. */
export const MOVE_WINDOW_DAYS = 7;

/** The code name of the dismissal key: storage is a code surface (§2), so it keeps it. */
export const MOVE_BANNER_KEY = "remo.moveBanner.dismissed";

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of a `YYYY-MM-DD` day, or null for a malformed or impossible date. */
export function parseMoveDay(at: string): number | null {
  const match = ISO_DAY.exec(String(at ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = Date.UTC(year, month - 1, day);
  const check = new Date(value);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

/**
 * Whole days from the reader's calendar day to the move day.
 *
 * The reader's local date is compared with the UTC midnight of the configured day, so a
 * daylight-saving change cannot shift the count by a fraction of a day.
 */
export function daysUntilMove(at: string, today: Date = new Date()): number | null {
  const target = parseMoveDay(at);
  if (target === null) return null;
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - start) / DAY_MS);
}

/** The new host without a scheme, for a sentence that names it. */
export function moveHost(to: string): string {
  try {
    return new URL(to).host;
  } catch {
    return String(to ?? "");
  }
}

/** The move date in the interface language. */
export function moveDate(at: string, lang: "ru" | "en"): string {
  const day = parseMoveDay(at);
  if (day === null) return String(at ?? "");
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(day);
}

/**
 * Whether the notice is due: a valid https address, a valid day, and 0–7 days left.
 *
 * Earlier it would be noise; after the day the old host answers with a redirect, so the
 * notice has nothing left to ask.
 */
export function shouldShowMove(
  move: MoveInfo | null | undefined,
  today: Date = new Date(),
): move is MoveInfo {
  if (!move || typeof move.to !== "string" || typeof move.at !== "string") return false;
  let origin: URL;
  try {
    origin = new URL(move.to);
  } catch {
    return false;
  }
  if (origin.protocol !== "https:") return false;
  const left = daysUntilMove(move.at, today);
  return left !== null && left >= 0 && left <= MOVE_WINDOW_DAYS;
}

/** A dismissal lasts until the browser session ends, as the reminder does. */
export function moveBannerDismissed(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.sessionStorage,
): boolean {
  try {
    return storage?.getItem(MOVE_BANNER_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissMoveBanner(
  storage: Pick<Storage, "setItem"> | undefined = globalThis.sessionStorage,
): void {
  try {
    storage?.setItem(MOVE_BANNER_KEY, "1");
  } catch {
    // Private mode shows the notice again, which is the harmless direction.
  }
}
