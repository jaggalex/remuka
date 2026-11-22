/**
 * The week window of the Pulse panel (`spec/pulse.md` §6).
 *
 * Monday–Sunday, UTC. The bucket list ends with the week that contains `now`; the panel
 * draws only the complete ones, because a running week is not a fall and must not look
 * like one (§4.2).
 */
import { dayOf, startOfWeek as mondayOf, addDays } from "./time.mjs";

export const PULSE_WEEKS = Object.freeze([4, 12, 26]);
/** Paid teams needed to break even before the operator sets `REMO_PULSE_BREAKEVEN`. */
export const PULSE_BREAKEVEN = 43;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week a moment belongs to. */
export function startOfWeek(moment) {
  return new Date(`${mondayOf(dayOf(moment))}T00:00:00.000Z`);
}

/** The `weeks` buckets ending with the week that contains `now`, oldest first. */
export function weekWindow(weeks, now = new Date()) {
  const last = startOfWeek(now);
  const buckets = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const start = new Date(last.getTime() - index * WEEK_MS);
    buckets.push({ start, end: new Date(start.getTime() + WEEK_MS) });
  }
  return buckets;
}

/** Monday of the week a moment belongs to, as `YYYY-MM-DD`. */
export function weekKey(moment) {
  return mondayOf(dayOf(moment));
}

/** A ratio in percent, one decimal; `null` when the cohort is empty. */
export function percent(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** The first day after a bucket's last day, for callers that walk by day. */
export function nextDay(day) {
  return addDays(day, 1);
}
