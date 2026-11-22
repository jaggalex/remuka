/**
 * UTC days, weeks and months for the Pulse aggregates (`spec/pulse.md` §4.1).
 *
 * Every boundary here is UTC: the storage time zone is UTC and only UTC, and a Moscow
 * wall clock is a matter of the label on a screen, not of which day a row belongs to
 * (§4.2). A day is the string `YYYY-MM-DD`; comparisons are lexicographic, which keeps
 * the SQL parameters and the keys of a Map the same value.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** The storage and recompute window: 24 months (§4.5). */
export const PULSE_WINDOW_DAYS = 730;
/** Weeks of retention the panel draws, plus week zero (§1.2, §6). */
export const RETENTION_WEEKS = 12;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` of a Date or of a day string, in UTC. */
export function dayOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC of a day string; throws on anything that is not a real date. */
export function fromDay(day) {
  if (!DAY.test(String(day))) throw new Error(`not a UTC day: ${day}`);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || dayOf(date) !== day) throw new Error(`not a UTC day: ${day}`);
  return date;
}

export function addDays(day, delta) {
  return dayOf(new Date(fromDay(day).getTime() + delta * DAY_MS));
}

/** Monday of the week that contains `day` (ISO weeks, §4.1). */
export function startOfWeek(day) {
  const date = fromDay(day);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(day, -offset);
}

/** Sunday of the week that contains `day`: the day a weekly row is written on. */
export function endOfWeek(day) {
  return addDays(startOfWeek(day), 6);
}

export function startOfMonth(day) {
  return `${String(day).slice(0, 7)}-01`;
}

/** The last calendar day of the month that contains `day`. */
export function endOfMonth(day) {
  const date = fromDay(startOfMonth(day));
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return dayOf(new Date(next.getTime() - DAY_MS));
}

export function isWeekEnd(day) {
  return endOfWeek(day) === day;
}

export function isMonthEnd(day) {
  return endOfMonth(day) === day;
}

/** Every day from `from` to `to`, inclusive and ascending. */
export function eachDay(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function daysBetween(from, to) {
  return Math.round((fromDay(to).getTime() - fromDay(from).getTime()) / DAY_MS) + 1;
}

export function minDay(...days) {
  return days.filter(Boolean).sort()[0] ?? null;
}

export function maxDay(...days) {
  return days.filter(Boolean).sort().at(-1) ?? null;
}

/** The first day of the month, quarter or year an operator means by "month to month". */
export function monthKey(day) {
  return String(day).slice(0, 7);
}
