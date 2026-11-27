/**
 * How a billing letter writes money and dates (ADR-319 §5, `spec/mail.md` §6).
 *
 * The ledger keeps minor units and instants; a letter reads «590 ₽» and «24 декабря». The
 * rouble keeps its sign after the number in both languages, because that is how the price
 * is written on the plan page; other currencies follow the reader's locale.
 */
const NBSP = " ";

const LOCALE_TAG = { ru: "ru-RU", en: "en-GB" };

function tagOf(lang) {
  return LOCALE_TAG[lang] ?? LOCALE_TAG.en;
}

export function formatMailMoney(minor, currency, lang) {
  const value = Number(minor) / 100;
  if (!Number.isFinite(value)) return "";
  const code = String(currency ?? "").toUpperCase();
  const whole = Number.isInteger(value);
  const digits = { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 };
  if (code === "RUB" || code === "") {
    const number = new Intl.NumberFormat(tagOf(lang), digits).format(value);
    return `${number}${NBSP}₽`.replace(/ /g, NBSP);
  }
  return new Intl.NumberFormat(tagOf(lang), {
    style: "currency", currency: code, currencyDisplay: "narrowSymbol", ...digits,
  }).format(value).replace(/ /g, NBSP);
}

/** A date in words; the year is written only when it is not the current one. */
export function formatMailDate(value, lang, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Intl.DateTimeFormat(tagOf(lang), {
    day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC",
  }).format(date).replace(/ /g, NBSP);
}
