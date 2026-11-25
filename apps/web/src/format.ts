/** Small display helpers shared by the header and the organisation screen. */

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** A calendar date: "12 Mar 2026". Used where the year matters, e.g. board creation. */
export function formatDate(value: string, lang: "en" | "ru"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A precise moment with the year: "12 Mar 2026, 14:05". */
export function formatDateTime(value: string, lang: "en" | "ru"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A precise moment without the noise of seconds: "12 Mar, 14:05". */
export function formatMoment(value: string, lang: "en" | "ru"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * How long ago something happened, in words: "2 minutes ago", "вчера".
 *
 * The home tile says what changed and when, and a date-time there reads like a log line
 * (ADR-265 §2, rule 3). Beyond a week the exact date is kinder than "37 days ago", so the
 * calendar date takes over. `now` is injectable so the rule is tested without a clock.
 */
export function formatAgo(value: string, lang: "en" | "ru", now: number = Date.now()): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const seconds = Math.round((time - now) / 1000);
  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(0, "second");
  if (abs < 60 * 60) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 24 * 60 * 60) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 24 * 60 * 60) return relative.format(Math.round(seconds / 86400), "day");
  return formatDate(value, lang);
}
