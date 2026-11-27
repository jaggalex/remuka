/**
 * The letters about payment and plan (ADR-319, `spec/mail.md` §6 «Письма об оплате и тарифе»).
 *
 * The copy is normative and written in an even voice: the fact first, then what changes and
 * when, then one action. Every value arrives formatted by the caller (`billing-notify.mjs`):
 * «590 ₽», «24 декабря», the space's name. The text version is the spec sentence word for
 * word; the HTML version is the same sentences, a summary block where the letter has one,
 * and one button whose link is also printed as text.
 */
import { bodyHtml, escapeHtml, money, param } from "./mail-template-kit.mjs";

// The link into the space is `spaceUrl`, not `link`: `link` is reserved for one-time
// tokens and must be sealed (`mail.mjs`), while these letters carry an ordinary address.

const LABELS = {
  ru: {
    open: (space) => `Открыть «${space}»`,
    invoice: "Посмотреть счёт",
    updateCard: "Обновить карту",
    pay: (plan) => `Оплатить ${plan}`,
    chooseRooms: "Выбрать комнаты",
    autopay: "Включить автопродление",
    people: "Открыть участников",
  },
  en: {
    open: (space) => `Open “${space}”`,
    invoice: "View invoice",
    updateCard: "Update card",
    pay: (plan) => `Pay for ${plan}`,
    chooseRooms: "Choose rooms",
    autopay: "Turn auto-renewal on",
    people: "Open people",
  },
};

/** Summary lines of `plan_activated`: an array of strings, each one fact. */
function linesOf(values, name) {
  const raw = values[name];
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return list
    .filter((line) => typeof line === "string" || typeof line === "number")
    .map((line) => String(line).replace(/[\r\n]+/g, " ").trim())
    .filter(Boolean);
}

/**
 * One letter: `body` sentences, then `«{linkText}: {link}»` in text, as the spec writes it.
 * `rows` become a summary block in HTML and stay sentences in text.
 */
function letter({ lang, subject, body, linkText, link, label, rows = [] }) {
  const sentence = (line) => (/[.!?…]$/.test(line) ? line : `${line}.`);
  const textRows = rows.map(sentence);
  const text = [...body.slice(0, 1), ...textRows, ...body.slice(1)].join(" ");
  return {
    subject,
    text: `${text} ${linkText}: ${link}`,
    html: bodyHtml({
      lang,
      paragraphs: body.map(escapeHtml),
      rows: rows.map(escapeHtml),
      link,
      label: escapeHtml(label),
    }),
  };
}

function planActivated(lang, values) {
  const plan = param(values, "plan");
  const space = param(values, "space");
  const date = param(values, "date");
  const limits = param(values, "limits");
  const nextDate = param(values, "nextDate", { required: false });
  const nextAmount = param(values, "nextAmount", { required: false });
  const link = param(values, "spaceUrl");
  const rows = linesOf(values, "summary");
  const next = nextDate && nextAmount;
  if (lang === "ru") {
    return letter({
      lang,
      subject: `Спасибо за оплату — ${plan} подключён в «${space}»`,
      body: [
        `С ${date} в «${space}» действует ${plan}: ${limits}.`,
        ...(next ? [`Следующее списание — ${nextDate}, ${nextAmount}.`] : []),
      ],
      rows,
      linkText: LABELS.ru.open(space),
      label: LABELS.ru.open(space),
      link,
    });
  }
  return letter({
    lang,
    subject: `Thanks for your payment — ${plan} is on for “${space}”`,
    body: [
      `From ${date}, “${space}” is on ${plan}: ${limits}.`,
      ...(next ? [`Next charge: ${nextAmount} on ${nextDate}.`] : []),
    ],
    rows,
    linkText: LABELS.en.open(space),
    label: LABELS.en.open(space),
    link,
  });
}

function paymentSucceeded(lang, values) {
  const plan = param(values, "plan");
  const periodEnd = param(values, "periodEnd");
  const amount = money(values);
  const last4 = param(values, "last4", { required: false });
  const space = param(values, "space");
  const period = param(values, "period");
  const invoice = param(values, "invoice");
  const link = param(values, "invoiceUrl");
  if (lang === "ru") {
    const card = last4 ? ` с карты •••• ${last4}` : "";
    return letter({
      lang,
      subject: `Подписка ${plan} продлена до ${periodEnd}`,
      body: [`Списали ${amount}${card} — «${space}» работает без перерыва.`, `Период: ${period}.`],
      linkText: `Счёт ${invoice}`,
      label: LABELS.ru.invoice,
      link,
    });
  }
  const card = last4 ? ` to card •••• ${last4}` : "";
  return letter({
    lang,
    subject: `Your ${plan} subscription is renewed until ${periodEnd}`,
    body: [`We charged ${amount}${card} — “${space}” carries on without a break.`, `Period: ${period}.`],
    linkText: `Invoice ${invoice}`,
    label: LABELS.en.invoice,
    link,
  });
}

function paymentFailed(lang, values) {
  const plan = param(values, "plan");
  const graceEnd = param(values, "graceEnd");
  const reason = param(values, "reason");
  const amount = money(values);
  const retries = param(values, "retries");
  const space = param(values, "space");
  const freeRooms = param(values, "freeRooms");
  const link = param(values, "billingUrl");
  if (lang === "ru") {
    return letter({
      lang,
      subject: `Оплата за ${plan} не прошла — обновите карту до ${graceEnd}`,
      body: [
        `${reason}, и мы не смогли списать ${amount} за продление ${plan}.`,
        `До ${graceEnd} всё работает как прежде: комнаты, участники и данные на месте.`,
        `Повторим попытку ${retries}.`,
        `Если оплата не пройдёт, ${graceEnd} «${space}» перейдёт на Бесплатный: активными останутся ${freeRooms} комнат, остальные станут только для чтения.`,
      ],
      linkText: LABELS.ru.updateCard,
      label: LABELS.ru.updateCard,
      link,
    });
  }
  return letter({
    lang,
    subject: `Payment for ${plan} didn't go through — update your card by ${graceEnd}`,
    body: [
      `${reason}, so we couldn't charge ${amount} for the ${plan} renewal.`,
      `Until ${graceEnd} everything works as before: rooms, people and data stay.`,
      `We'll try again on ${retries}.`,
      `If the payment still fails, on ${graceEnd} “${space}” moves to Free: ${freeRooms} rooms stay active, the rest become read-only.`,
    ],
    linkText: LABELS.en.updateCard,
    label: LABELS.en.updateCard,
    link,
  });
}

function paymentFinalAttempt(lang, values) {
  const plan = param(values, "plan");
  const date = param(values, "date");
  const amount = money(values);
  const last4 = param(values, "last4", { required: false });
  const graceEnd = param(values, "graceEnd");
  const space = param(values, "space");
  const freeRooms = param(values, "freeRooms");
  const rooms = param(values, "rooms");
  const link = param(values, "billingUrl");
  if (lang === "ru") {
    const card = last4 ? ` с карты •••• ${last4}` : "";
    return letter({
      lang,
      subject: `Завтра последняя попытка оплатить ${plan}`,
      body: [
        `${date} ещё раз попробуем списать ${amount}${card}.`,
        `Если не получится, ${graceEnd} «${space}» перейдёт на Бесплатный: активными останутся ${freeRooms} комнат из ${rooms}, данные сохранятся.`,
      ],
      linkText: LABELS.ru.updateCard,
      label: LABELS.ru.updateCard,
      link,
    });
  }
  const card = last4 ? ` to card •••• ${last4}` : "";
  return letter({
    lang,
    subject: `Tomorrow is the last try to pay for ${plan}`,
    body: [
      `On ${date} we'll try once more to charge ${amount}${card}.`,
      `If it fails, on ${graceEnd} “${space}” moves to Free: ${freeRooms} of ${rooms} rooms stay active, data stays.`,
    ],
    linkText: LABELS.en.updateCard,
    label: LABELS.en.updateCard,
    link,
  });
}

function subscriptionSuspended(lang, values) {
  const space = param(values, "space");
  const plan = param(values, "plan");
  const date = param(values, "date");
  const freeRooms = param(values, "freeRooms");
  const rooms = param(values, "rooms");
  const link = param(values, "billingUrl");
  if (lang === "ru") {
    return letter({
      lang,
      subject: `«${space}» перешла на Бесплатный`,
      body: [
        `Оплата за ${plan} так и не прошла, поэтому с ${date} в «${space}» действует Бесплатный.`,
        `Активными остались ${freeRooms} комнат из ${rooms}, остальные — только для чтения, экспорт работает.`,
        "Участники на месте, новые приглашения закрыты.",
        `Ничего не удалено: оплата вернёт ${plan} сразу.`,
      ],
      linkText: LABELS.ru.pay(plan),
      label: LABELS.ru.pay(plan),
      link,
    });
  }
  return letter({
    lang,
    subject: `“${space}” has moved to Free`,
    body: [
      `The ${plan} payment never went through, so from ${date} “${space}” is on Free.`,
      `${freeRooms} of ${rooms} rooms stay active, the rest are read-only and export still works.`,
      "People stay; new invitations are paused.",
      `Nothing is deleted: paying brings ${plan} back at once.`,
    ],
    linkText: LABELS.en.pay(plan),
    label: LABELS.en.pay(plan),
    link,
  });
}

function paymentRecovered(lang, values) {
  const plan = param(values, "plan");
  const space = param(values, "space");
  const amount = money(values);
  const period = param(values, "period");
  const link = param(values, "spaceUrl");
  if (lang === "ru") {
    return letter({
      lang,
      subject: `Доступ к ${plan} в «${space}» вернулся`,
      body: [`Оплата ${amount} прошла — в «${space}» снова действует ${plan}, все комнаты активны.`, `Период: ${period}.`],
      linkText: LABELS.ru.open(space),
      label: LABELS.ru.open(space),
      link,
    });
  }
  return letter({
    lang,
    subject: `${plan} is back for “${space}”`,
    body: [`The ${amount} payment went through — “${space}” is on ${plan} again and every room is active.`, `Period: ${period}.`],
    linkText: LABELS.en.open(space),
    label: LABELS.en.open(space),
    link,
  });
}

function downgradeScheduled(lang, values) {
  const date = param(values, "date");
  const space = param(values, "space");
  const plan = param(values, "plan");
  const currentPlan = param(values, "currentPlan");
  const planNote = param(values, "planNote");
  const impact = param(values, "impact", { required: false });
  const link = param(values, "spaceUrl");
  if (lang === "ru") {
    return letter({
      lang,
      subject: `С ${date} в «${space}» — ${plan}`,
      body: [`До ${date} действует ${currentPlan}.`, planNote, ...(impact ? [impact] : [])],
      linkText: `Выбрать активные комнаты или отменить изменение можно до ${date}`,
      label: LABELS.ru.chooseRooms,
      link,
    });
  }
  return letter({
    lang,
    subject: `From ${date}, “${space}” moves to ${plan}`,
    body: [`${currentPlan} stays on until ${date}.`, planNote, ...(impact ? [impact] : [])],
    linkText: `You can choose active rooms or cancel the change until ${date}`,
    label: LABELS.en.chooseRooms,
    link,
  });
}

function downgradeApplied(lang, values) {
  const date = param(values, "date");
  const space = param(values, "space");
  const plan = param(values, "plan");
  // `{charged}` is « — списали 290 ₽ за месяц» or nothing for Free; the leading space is ours.
  const paid = param(values, "charged", { required: false });
  const charged = paid ? ` ${paid}` : "";
  const seats = param(values, "seats");
  const activeRooms = param(values, "activeRooms");
  const readOnly = param(values, "readOnly");
  const link = param(values, "spaceUrl");
  if (lang === "ru") {
    return letter({
      lang,
      subject: `«${space}» перешла на ${plan}`,
      body: [
        `С ${date} в «${space}» действует ${plan}${charged}.`,
        `Места: ${seats}.`,
        `Активные комнаты: ${activeRooms}; остальные ${readOnly} — только для чтения, экспорт работает.`,
      ],
      linkText: LABELS.ru.open(space),
      label: LABELS.ru.open(space),
      link,
    });
  }
  return letter({
    lang,
    subject: `“${space}” is now on ${plan}`,
    body: [
      `From ${date}, “${space}” is on ${plan}${charged}.`,
      `Seats: ${seats}.`,
      `Active rooms: ${activeRooms}; the other ${readOnly} are read-only and export still works.`,
    ],
    linkText: LABELS.en.open(space),
    label: LABELS.en.open(space),
    link,
  });
}

function autopayDisabled(lang, values) {
  const plan = param(values, "plan");
  const space = param(values, "space");
  const date = param(values, "date");
  const link = param(values, "spaceUrl");
  if (lang === "ru") {
    return letter({
      lang,
      subject: `Автопродление ${plan} выключено`,
      body: [
        "Списаний больше не будет.",
        `Доступ к ${plan} в «${space}» — до ${date}, потом пространство перейдёт на Бесплатный.`,
      ],
      linkText: "Если выключили не вы, включите автопродление снова и сообщите администраторам пространства",
      label: LABELS.ru.autopay,
      link,
    });
  }
  return letter({
    lang,
    subject: `Auto-renewal for ${plan} is off`,
    body: ["There will be no more charges.", `“${space}” keeps ${plan} until ${date}, then moves to Free.`],
    linkText: "If this wasn't you, turn auto-renewal back on and tell the workspace admins",
    label: LABELS.en.autopay,
    link,
  });
}

function seatsOverLimit(lang, values) {
  const space = param(values, "space");
  const used = param(values, "used");
  const plan = param(values, "plan");
  const limit = param(values, "limit");
  const date = param(values, "date");
  const link = param(values, "spaceUrl");
  if (lang === "ru") {
    return letter({
      lang,
      subject: `В «${space}» мест больше, чем в тарифе`,
      body: [
        `В «${space}» ${used} человек, а в ${plan} — ${limit} мест.`,
        "Никого не удаляем, но новые приглашения пока закрыты.",
        `Если до ${date} не освободить места или не сменить тариф, все комнаты станут только для чтения — содержимое сохранится.`,
      ],
      linkText: LABELS.ru.people,
      label: LABELS.ru.people,
      link,
    });
  }
  return letter({
    lang,
    subject: `“${space}” has more people than its plan allows`,
    body: [
      `“${space}” has ${used} people and ${plan} includes ${limit} seats.`,
      "Nobody is removed, but new invitations are paused.",
      `If seats aren't freed or the plan isn't changed by ${date}, all rooms become read-only — their content stays.`,
    ],
    linkText: LABELS.en.people,
    label: LABELS.en.people,
    link,
  });
}

export const BILLING_TEMPLATES = [
  "plan_activated",
  "payment_final_attempt",
  "payment_recovered",
  "downgrade_scheduled",
  "downgrade_applied",
  "autopay_disabled",
  "seats_over_limit",
];

export const BILLING_RENDERERS = {
  plan_activated: planActivated,
  payment_succeeded: paymentSucceeded,
  payment_failed: paymentFailed,
  payment_final_attempt: paymentFinalAttempt,
  subscription_suspended: subscriptionSuspended,
  payment_recovered: paymentRecovered,
  downgrade_scheduled: downgradeScheduled,
  downgrade_applied: downgradeApplied,
  autopay_disabled: autopayDisabled,
  seats_over_limit: seatsOverLimit,
};
