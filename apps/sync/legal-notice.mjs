/**
 * The daily notice that a document gets a new revision (ADR-256 §5).
 *
 * Publishing is still a file change, not a service event, but the letter no longer waits
 * for an operator: every pass looks at the registry, finds a published `reaccept` document
 * whose `effective` date is inside the installation's notice window, and queues one
 * `legal_update` letter per active account.
 *
 * Exactly once per person and revision is the point. The outbox already carries `params`
 * in clear text, so the idempotency key lives there (`dedupe`) and the next pass asks the
 * outbox which keys it already has; no second mechanism, no schema change. A draft is
 * never sent, whatever `REMO_LEGAL_ALLOW_DRAFTS` says: that variable only lets a test
 * stand start with a draft, it does not turn a draft into a document people can accept.
 *
 * The interval is a day; an installation that restarts several times still sends one
 * letter because the key is checked before the insert.
 */
import { enqueueMail, pickLocale } from "./mail.mjs";

export const DEFAULT_LEGAL_NOTICE_DAYS = 30;
export const LEGAL_NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The notice window in days. A bad value stops the start instead of guessing (§5). */
export function legalNoticeDays(env = process.env) {
  const raw = String(env.REMO_LEGAL_NOTICE_DAYS ?? "").trim();
  if (raw === "") return DEFAULT_LEGAL_NOTICE_DAYS;
  if (!/^\d+$/.test(raw)) {
    throw new Error("[legal] REMO_LEGAL_NOTICE_DAYS must be a whole number of days");
  }
  return Number(raw);
}

/** The calendar day in UTC, as the registry writes it (`YYYY-MM-DD`). */
export function legalDay(now = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(value.getTime())) throw new Error("[legal] invalid current date");
  return value.toISOString().slice(0, 10);
}

/**
 * Whether this document is inside its notice window today.
 *
 * The window opens `days` before `effective` and closes when the document takes effect:
 * from the effective day the blocking window owns the message, not a banner or a letter.
 * A draft, a revision without an effective date, or one whose effective date is unknown
 * never produces a letter.
 */
export function legalNoticeDue(document, { today = new Date(), days = DEFAULT_LEGAL_NOTICE_DAYS } = {}) {
  if (!document || document.reaccept !== true) return null;
  if (document.status !== "published") return null;
  if (typeof document.effective !== "string" || !DATE.test(document.effective)) return null;
  const effective = document.effective;
  const effectiveAt = Date.parse(`${effective}T00:00:00Z`);
  if (Number.isNaN(effectiveAt)) return null;
  const todayAt = Date.parse(`${legalDay(today)}T00:00:00Z`);
  const daysUntil = Math.round((effectiveAt - todayAt) / 86_400_000);
  if (daysUntil < 0 || daysUntil > days) return null;
  return { effective, daysUntil };
}

/** The letter's date in words, in the recipient's language. */
export function formatEffective(date, locale) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * What would be sent: one item per active account, with the document title in that
 * person's language. Pure, so the command line, the loop and the tests read one plan.
 *
 * `dedupePrefix` is the revision key (`legal:<doc>:<version>`); when present the per-user
 * key travels in `params.dedupe`, which is what makes the next pass skip the same person.
 */
export function noticePlan({ document, title, effective, users, dedupePrefix = null }) {
  return (users ?? []).map((user) => {
    const locale = pickLocale({ userLang: user.lang });
    return {
      userId: user.id,
      toEmail: user.email,
      locale,
      params: {
        name: user.name ?? null,
        doc: title[locale] ?? Object.values(title)[0] ?? document,
        date: formatEffective(effective, locale),
        ...(dedupePrefix ? { dedupe: `${dedupePrefix}:${user.id}` } : {}),
      },
    };
  });
}

/** The idempotency key of one revision for one person; the outbox keeps it in `params`. */
export function legalNoticeKey(document, userId) {
  return `legal:${document.doc}:${document.version}:${userId}`;
}

/**
 * Queue the letters that are due and not queued yet. Returns how many were written.
 *
 * The store answers two questions: who is active, and which keys the outbox already has.
 * A missing method is the disk store, which has no outbox and no mail.
 */
export async function queueLegalNotices({
  store,
  legal,
  mailConfig,
  env = process.env,
  log = console,
  now = () => new Date(),
  kek = null,
}) {
  if (!mailConfig || mailConfig.driver === "disabled") return 0;
  if (typeof store.listActiveUsersForLegalNotice !== "function") return 0;
  if (typeof store.existingLegalNoticeKeys !== "function") return 0;
  const days = legalNoticeDays(env);
  const today = now();
  const due = [];
  for (const document of legal?.documents ?? []) {
    const window = legalNoticeDue(document, { today, days });
    if (window) due.push({ document, ...window });
  }
  if (!due.length) return 0;

  const users = await store.listActiveUsersForLegalNotice();
  if (!users.length) return 0;

  const candidates = [];
  for (const { document, effective } of due) {
    const dedupePrefix = `legal:${document.doc}:${document.version}`;
    const plan = noticePlan({
      document: document.doc,
      title: document.title ?? {},
      effective,
      users,
      dedupePrefix,
    });
    for (const item of plan) candidates.push({ document, item });
  }
  if (!candidates.length) return 0;

  const existing = await store.existingLegalNoticeKeys(
    candidates.map(({ item }) => item.params.dedupe),
  );
  let queued = 0;
  for (const { document, item } of candidates) {
    if (existing.has(item.params.dedupe)) continue;
    await enqueueMail(
      store,
      {
        userId: item.userId,
        toEmail: item.toEmail,
        template: "legal_update",
        locale: item.locale,
        params: item.params,
        linkParams: { link: document.url },
      },
      { config: mailConfig, kek },
    );
    queued += 1;
  }
  if (queued > 0) {
    log.log?.(`[legal] queued ${queued} notice letter(s) for ${due.map(({ document }) => document.doc).join(", ")}`);
  }
  return queued;
}

/** The daily pass; the same shape as the retention and account-purge loops. */
export function createLegalNoticeLoop({
  store,
  legal,
  mailConfig,
  env = process.env,
  log = console,
  now = () => new Date(),
  intervalMs = LEGAL_NOTICE_INTERVAL_MS,
  kek = null,
}) {
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running) return 0;
    running = true;
    try {
      return await queueLegalNotices({ store, legal, mailConfig, env, log, now, kek });
    } catch (error) {
      log.error?.("[legal] notice pass failed:", error?.message ?? error);
      return 0;
    } finally {
      running = false;
    }
  }

  function start() {
    if (!mailConfig || mailConfig.driver === "disabled") return;
    if (typeof store.existingLegalNoticeKeys !== "function") return;
    // A restart must not wait a day for the first pass; the dedupe key makes it safe.
    void runOnce();
    timer = setInterval(() => void runOnce(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  return { runOnce, start, stop };
}
