/**
 * The banner that announces a revision before it takes effect (ADR-256 §5).
 *
 * `/config` carries the date; `/account/legal` carries whether this person already
 * accepted the current revision. The banner is for the gap between them: a `reaccept`
 * document whose `effective` day is inside the notice window (30 days by default) and is
 * still ahead. On the effective day the blocking window owns the message, so the same
 * document must not be announced twice.
 *
 * Pure and date-injected, so the boundary days are tested without a clock.
 */

/** The same window the scheduled letter uses (`REMO_LEGAL_NOTICE_DAYS`, 30). */
export const LEGAL_UPCOMING_DAYS = 30;

export interface UpcomingInput {
  readonly doc: string;
  readonly version: number;
  readonly reaccept: boolean;
  readonly effective: string | null;
  readonly accepted?: boolean;
  readonly url: string;
}

export interface UpcomingDocument<T extends UpcomingInput> {
  readonly document: T;
  readonly daysUntil: number;
}

/** UTC calendar day of a date, as the registry writes it. */
function dayOf(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

/** Days from today to `effective`; negative once the date has passed. Null if unreadable. */
export function daysUntilEffective(
  effective: string | null | undefined,
  today: Date | string = new Date(),
): number | null {
  if (!effective || !/^\d{4}-\d{2}-\d{2}$/.test(effective)) return null;
  const at = Date.parse(`${effective}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return Math.round((at - Date.parse(`${dayOf(today)}T00:00:00Z`)) / 86_400_000);
}

/**
 * Every document inside the window, in registry order.
 *
 * `daysUntil` must be strictly positive: on the effective day the blocking window is the
 * right surface. An already accepted revision is quiet even when its date is ahead (a
 * fresh sign-up accepts the current revision, which may take effect later).
 */
export function upcomingRevisions<T extends UpcomingInput>(
  documents: readonly T[],
  today: Date | string = new Date(),
  days = LEGAL_UPCOMING_DAYS,
): UpcomingDocument<T>[] {
  const upcoming: UpcomingDocument<T>[] = [];
  for (const document of documents) {
    if (document.reaccept !== true || document.accepted === true) continue;
    const daysUntil = daysUntilEffective(document.effective, today);
    if (daysUntil === null || daysUntil <= 0 || daysUntil > days) continue;
    upcoming.push({ document, daysUntil });
  }
  return upcoming;
}

/** The first document to announce, or null. */
export function upcomingRevision<T extends UpcomingInput>(
  documents: readonly T[],
  today: Date | string = new Date(),
  days = LEGAL_UPCOMING_DAYS,
): UpcomingDocument<T> | null {
  return upcomingRevisions(documents, today, days)[0] ?? null;
}

/** The session key of a dismissed banner: it returns only in a new browser session (§5). */
export function legalUpcomingSessionKey(document: UpcomingInput): string {
  return `remo.legal.upcoming.${document.doc}@${document.version}`;
}
