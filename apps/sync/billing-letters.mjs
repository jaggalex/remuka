/**
 * Letters that follow a decision or the calendar, not a payment (ADR-319, `spec/billing.md` §7).
 *
 * A scheduled downgrade, an applied one and auto-renewal turned off are billing events; a
 * trial, a yearly renewal and a card expiry are dates. Every ten minutes this loop reads
 * both and asks `notify` for the letter, with a deduplication key made of the event id or
 * the reminder's window, so a tick that sees the same row again queues nothing new.
 *
 * Plan letters go to every admin of the space; money reminders go to the billing address,
 * like the payment letters themselves (`remuka-mail`: «письма о тарифе — администраторам»).
 */
import { PLANS, PLAN_NAMES } from "./billing-catalog.mjs";
import { formatMailMoney } from "./billing-format.mjs";
import { planLabel } from "./billing-notify.mjs";

const DAY_MS = 86_400_000;

/** How far back a decision is still announced; older events predate this loop. */
export const EVENT_WINDOW_MS = 2 * DAY_MS;

/** The card reminders: thirty and seven days before the end of the expiry month (§7). */
export const CARD_NOTICE_DAYS = Object.freeze([30, 7]);

const INTERVAL_WORD = { ru: { month: "месяц", year: "год" }, en: { month: "month", year: "year" } };

function isDowngrade(from, to) {
  return PLAN_NAMES.indexOf(to) >= 0 && PLAN_NAMES.indexOf(to) < PLAN_NAMES.indexOf(from);
}

/** `{planNote}` and `{impact}` of downgrade_scheduled, in the letter's language. */
export function downgradeNotes({ to, from, amount, currency, interval }, lang) {
  const target = planLabel(to, lang);
  const sum = formatMailMoney(amount, currency, lang);
  const per = INTERVAL_WORD[lang]?.[interval] ?? INTERVAL_WORD[lang]?.month;
  const before = PLANS[from];
  const after = PLANS[to];
  const impact = [];
  if (before && after && after.seats < before.seats) {
    impact.push(lang === "ru"
      ? `Мест станет ${after.seats} вместо ${before.seats}.`
      : `Seats go down to ${after.seats} from ${before.seats}.`);
  }
  if (after && after.rooms !== null && (before?.rooms === null || after.rooms < before.rooms)) {
    impact.push(lang === "ru"
      ? `Активными останутся ${after.rooms} комнат, остальные станут только для чтения.`
      : `${after.rooms} rooms stay active; the rest become read-only.`);
  }
  if (lang === "ru") {
    return {
      planNote: to === "free"
        ? "Списаний больше не будет."
        : `${target} начнёт действовать после оплаты продления — ${sum} в ${per}.`,
      impact: impact.join(" "),
    };
  }
  return {
    planNote: to === "free"
      ? "There will be no more charges."
      : `${target} starts once the renewal is paid — ${sum} a ${per}.`,
    impact: impact.join(" "),
  };
}

/** The first instant after a card's expiry month: the card works through that month. */
export function cardExpiresAt(expMonth, expYear) {
  return new Date(Date.UTC(Number(expYear), Number(expMonth), 1));
}

export function createBillingLetters({
  store,
  notify,
  log = console,
  now = () => new Date(),
  intervalMs = 600_000,
}) {
  const clock = () => {
    const value = typeof now === "function" ? now() : now;
    return value instanceof Date ? value : new Date(value);
  };

  async function admins(orgId) {
    return typeof store.orgAdminEmails === "function" ? store.orgAdminEmails(orgId) : [];
  }

  /** One letter per admin; the key carries the address so each admin gets one copy. */
  async function toAdmins(type, orgId, payload, key) {
    for (const email of await admins(orgId)) {
      await notify(type, { ...payload, orgId, toEmail: email, dedupeKey: `${key}:${email}` });
    }
  }

  async function announceEvent(event) {
    const { orgId, data, subscription } = event;
    if (event.type === "subscription.change_scheduled") {
      const to = data?.to;
      const from = to?.fromPlan ?? subscription?.plan;
      // Cancelling a schedule writes the same event with `to: null`; an upgrade is never
      // scheduled. Only a planned downgrade is a letter.
      if (!to?.plan || !isDowngrade(from, to.plan)) return;
      await toAdmins("downgrade_scheduled", orgId, {
        subscription,
        params: ({ locale, date, plan }) => ({
          date: date(to.effectiveAt ?? subscription?.current_period_end),
          plan: plan(to.plan),
          currentPlan: plan(from),
          ...downgradeNotes({ to: to.plan, from, amount: to.amount, currency: to.currency, interval: to.interval }, locale),
        }),
      }, event.id);
      return;
    }
    if (event.type === "subscription.change_applied") {
      if (!isDowngrade(data?.from, data?.to)) return;
      const facts = typeof store.billingLetterFacts === "function" ? await store.billingLetterFacts(orgId) : null;
      const seats = typeof store.seatUsage === "function"
        ? await store.withTenant(orgId, () => store.seatUsage(orgId))
        : null;
      const used = typeof seats === "number" ? seats : seats?.seats;
      await toAdmins("downgrade_applied", orgId, {
        subscription,
        params: ({ locale, date, money, plan }) => ({
          date: date(data.periodStart ?? event.occurredAt),
          plan: plan(data.to),
          charged: data.to === "free" || !subscription?.amount
            ? ""
            : locale === "ru"
              ? `— списали ${money(subscription.amount, subscription.currency)} за ${INTERVAL_WORD.ru[subscription.interval] ?? "месяц"}`
              : `— charged ${money(subscription.amount, subscription.currency)} for the ${INTERVAL_WORD.en[subscription.interval] ?? "month"}`,
          seats: `${used ?? 0} ${locale === "ru" ? "из" : "of"} ${PLANS[data.to]?.seats ?? ""}`,
          activeRooms: String(Math.max(0, (facts?.rooms ?? 0) - (facts?.frozen ?? 0))),
          readOnly: String(facts?.frozen ?? 0),
        }),
      }, event.id);
      return;
    }
    if (event.type === "subscription.canceled_at_period_end") {
      await toAdmins("autopay_disabled", orgId, {
        subscription,
        params: ({ date, plan }) => ({
          date: date(data?.currentPeriodEnd ?? subscription?.current_period_end),
          plan: plan(subscription?.plan),
        }),
      }, event.id);
    }
  }

  async function remind(at) {
    const { trials = [], renewals = [], cards = [] } = await store.billingReminders({ now: at });
    for (const trial of trials) {
      await toAdmins("trial_ending", trial.org_id, {
        subscription: { plan: trial.plan },
        params: ({ date }) => ({ date: date(trial.trial_end) }),
      }, `${trial.id}:${new Date(trial.trial_end).toISOString()}`);
    }
    for (const renewal of renewals) {
      await notify("renewal_upcoming", {
        orgId: renewal.org_id,
        subscription: { plan: renewal.plan },
        params: ({ date, money }) => ({
          date: date(renewal.current_period_end),
          amount: money(renewal.amount, renewal.currency),
          currency: renewal.currency,
        }),
        dedupeKey: `${renewal.id}:${new Date(renewal.current_period_end).toISOString()}`,
      });
    }
    for (const card of cards) {
      const left = cardExpiresAt(card.exp_month, card.exp_year) - at;
      if (left <= 0) continue;
      // The nearest window that is open: a card seen first at day 5 gets the seven-day letter.
      const window = [...CARD_NOTICE_DAYS].reverse().find((days) => left <= days * DAY_MS);
      if (!window) continue;
      await notify("payment_method_expiring", {
        orgId: card.org_id,
        params: {
          last4: card.last4 ?? "",
          expMonth: String(card.exp_month).padStart(2, "0"),
          expYear: String(card.exp_year),
        },
        dedupeKey: `${card.id}:${window}`,
      });
    }
  }

  let ticking = false;

  async function tick() {
    if (ticking || !notify) return { events: 0 };
    ticking = true;
    try {
      const at = clock();
      const events = (await store.billingLetterEvents({ since: new Date(at - EVENT_WINDOW_MS) })) ?? [];
      for (const event of events) {
        try {
          await announceEvent(event);
        } catch (error) {
          log.error?.(`[billing] letter for event ${event.id}: ${error?.code ?? "ERROR"}`);
        }
      }
      try {
        await remind(at);
      } catch (error) {
        log.error?.(`[billing] reminders failed (${error?.code ?? "ERROR"})`);
      }
      return { events: events.length };
    } finally {
      ticking = false;
    }
  }

  let timer = null;
  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => void tick().catch(() => {}), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
