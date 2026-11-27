/**
 * Transactional mail templates in RU and EN (ADR-246, `spec/mail.md` §6).
 *
 * The copy below is normative: changing a word means changing the spec. The renderer only
 * substitutes values, escapes them for HTML and keeps every line participants can click on
 * available as plain text too, because a text/plain letter is not a stub for the HTML one.
 *
 * There are no tracking pixels and no rewritten links: the URL the caller passes is the URL
 * the recipient sees.
 */
import { BRAND, brandName } from "@remo/brand";

export const MAIL_TEMPLATES = [
  "verify_email",
  "password_reset",
  "password_changed",
  "invitation",
  "payment_succeeded",
  "payment_failed",
  "trial_ending",
  "renewal_upcoming",
  "subscription_suspended",
  "subscription_canceled",
  "payment_method_expiring",
  "price_change",
  "payment_method_migrate",
  "account_deletion",
  "legal_update",
  "payment_refunded",
  "operator_action",
  "mfa_enabled",
  "mfa_disabled",
  "mfa_reset",
  "mfa_recovery_regenerated",
  "mfa_recovery_used",
  // Payment and plan (ADR-319) and the welcome letter.
  ...BILLING_TEMPLATES,
  "welcome",
];

import {
  BUTTON_LABELS,
  LOCALES,
  bodyHtml,
  mailDocument,
  escapeHtml,
  money,
  notification,
  param,
  ruNoun,
  templateError,
} from "./mail-template-kit.mjs";
import { BILLING_RENDERERS, BILLING_TEMPLATES } from "./mail-templates-billing.mjs";
import { renderInvitation } from "./mail-templates-invitation.mjs";
import { MFA_RENDERERS } from "./mail-templates-mfa.mjs";
import { stageSubject } from "./stage.mjs";

function verifyEmail(lang, values) {
  const link = param(values, "link");
  const name = param(values, "name", { required: false });
  const product = values.product;

  if (lang === "ru") {
    const greeting = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
    const confirm = "Подтвердите, что это ваш адрес";
    const notice = `Ссылка действует 24 часа. Если вы не регистрировались в ${ruNoun(lang, values, "prepositional")}, просто удалите это письмо.`;
    return {
      subject: `Подтвердите почту для ${ruNoun(lang, values, "genitive")}`,
      text: `${greeting} ${confirm}. ${BUTTON_LABELS[lang].verify_email}: ${link}\n\n${notice}`,
      html: bodyHtml({
        lang,
        paragraphs: [escapeHtml(greeting), escapeHtml(`${confirm}.`)],
        footer: escapeHtml(notice),
        link,
        label: escapeHtml(BUTTON_LABELS[lang].verify_email),
      }),
    };
  }

  const greeting = name ? `Hi ${name},` : "Hi,";
  const confirm = "please confirm this is your address";
  const notice = `The link works for 24 hours. If you didn't sign up for ${product}, you can ignore this email.`;
  return {
    subject: `Confirm your email for ${product}`,
    text: `${greeting} ${confirm}. ${BUTTON_LABELS[lang].verify_email}: ${link}\n\n${notice}`,
    html: bodyHtml({
      lang,
      paragraphs: [escapeHtml(greeting), escapeHtml(`${confirm}.`)],
      footer: escapeHtml(notice),
      link,
      label: escapeHtml(BUTTON_LABELS[lang].verify_email),
    }),
  };
}

function passwordReset(lang, values) {
  const link = param(values, "link");
  const product = values.product;

  if (lang === "ru") {
    const who = "Кто-то (надеемся, вы) запросил сброс пароля.";

    const notice =
      "Ссылка действует 60 минут и сработает один раз. Если это были не вы, ничего не делайте: пароль останется прежним.";
    return {
      subject: `Сброс пароля в ${ruNoun(lang, values, "prepositional")}`,
      text: `${who} ${BUTTON_LABELS[lang].password_reset}: ${link}\n\n${notice}`,
      html: bodyHtml({
        lang,
        paragraphs: [escapeHtml(who)],
        footer: escapeHtml(notice),
        link,
        label: escapeHtml(BUTTON_LABELS[lang].password_reset),
      }),
    };
  }

  const who = "Someone (hopefully you) asked to reset your password.";

  const notice =
    "The link works once, for 60 minutes. If it wasn't you, do nothing — your password stays the same.";
  return {
    subject: `Reset your ${product} password`,
    text: `${who} ${BUTTON_LABELS[lang].password_reset}: ${link}\n\n${notice}`,
    html: bodyHtml({
      lang,
      paragraphs: [escapeHtml(who)],
      footer: escapeHtml(notice),
      link,
      label: escapeHtml(BUTTON_LABELS[lang].password_reset),
    }),
  };
}

function passwordChanged(lang, values) {
  const email = param(values, "email");
  const forgotLink = param(values, "forgotLink");
  const product = values.product;

  if (lang === "ru") {
    const changed = `Пароль вашего аккаунта ${email} только что изменили, все сеансы завершены.`;
    const advice = "Если это были не вы, сразу сбросьте пароль.";
    return {
      subject: `Пароль в ${ruNoun(lang, values, "prepositional")} изменён`,
      text: `${changed} ${advice} ${BUTTON_LABELS[lang].password_changed}: ${forgotLink}`,
      html: bodyHtml({
        lang,
        paragraphs: [escapeHtml(changed)],
        footer: escapeHtml("Если это были не вы, сразу сбросьте пароль."),
        link: forgotLink,
        label: escapeHtml(BUTTON_LABELS[lang].password_changed),
      }),
    };
  }

  const changed = `The password for ${email} was just changed and all sessions were signed out.`;
  const advice = "If this wasn't you, reset your password now.";
  return {
    subject: `Your ${product} password was changed`,
    text: `${changed} ${advice} ${BUTTON_LABELS[lang].password_changed}: ${forgotLink}`,
    html: bodyHtml({
      lang,
      paragraphs: [escapeHtml(changed)],
      footer: escapeHtml("If this wasn't you, reset your password now."),
      link: forgotLink,
      label: escapeHtml(BUTTON_LABELS[lang].password_changed),
    }),
  };
}

function trialEnding(lang, values) {
  const date = param(values, "date");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Пробный период в ${ruNoun(lang, values, "prepositional")} заканчивается ${date}`,
      body: [`Пробный период в ${ruNoun(lang, values, "prepositional")} заканчивается ${date}.`],
      notice: "Если тариф не выбрать, пространство перейдёт на Бесплатный. Данные останутся на месте.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].trial_ending,
    });
  }

  return notification(lang, {
    subject: `Your ${product} trial ends on ${date}`,
    body: [`Your trial ends on ${date}.`],
    notice: "Without a plan the workspace moves to Free. Your data stays where it is.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].trial_ending,
  });
}

function renewalUpcoming(lang, values) {
  const date = param(values, "date");
  const amount = money(values);
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Годовая подписка ${ruNoun(lang, values, "genitive")} продлится ${date}`,
      body: [`${date} годовая подписка продлится на ${amount}.`],
      notice:
        "Продление произойдёт автоматически. Отключить автоплатёж можно в разделе «Тариф и оплата».",
      link: billingUrl,
      label: BUTTON_LABELS[lang].renewal_upcoming,
    });
  }

  return notification(lang, {
    subject: `Your yearly ${product} subscription renews on ${date}`,
    body: [`On ${date} your yearly subscription renews for ${amount}.`],
    notice:
      "The renewal happens automatically. You can turn off auto-payment under plan and payment settings.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].renewal_upcoming,
  });
}

function subscriptionCanceled(lang, values) {
  const date = param(values, "date");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Подписка ${ruNoun(lang, values, "genitive")} закончилась`,
      body: [
        `Подписка закончилась ${date}.`,
        "Пространство теперь на Бесплатном. Данные на месте.",
      ],
      notice: "Вы можете возобновить подписку в любой момент.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].subscription_canceled,
    });
  }

  return notification(lang, {
    subject: `Your ${product} subscription has ended`,
    body: [
      `The subscription ended on ${date}.`,
      "The workspace is now on Free. Your data is still here.",
    ],
    notice: "You can resume the subscription at any time.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].subscription_canceled,
  });
}

function paymentMethodExpiring(lang, values) {
  const last4 = param(values, "last4");
  const expMonth = param(values, "expMonth");
  const expYear = param(values, "expYear");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Срок карты в ${ruNoun(lang, values, "prepositional")} истекает`,
      body: [`Срок карты •••• ${last4} истекает в ${expMonth}/${expYear}.`],
      notice: "Если карта уже обновлена у платёжного сервиса, ничего делать не нужно.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].payment_method_expiring,
    });
  }

  return notification(lang, {
    subject: `The card on your ${product} subscription expires soon`,
    body: [`The card ending in ${last4} expires ${expMonth}/${expYear}.`],
    notice: "If the card is already updated with the payment provider, nothing needs doing.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].payment_method_expiring,
  });
}

function priceChange(lang, values) {
  const oldAmount = money(values, "oldAmount");
  const newAmount = money(values, "newAmount");
  const date = param(values, "date");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Новая цена подписки ${ruNoun(lang, values, "genitive")}`,
      body: [`С ${date} подписка будет стоить ${newAmount} вместо ${oldAmount}.`],
      notice: "Новая цена применяется при первом продлении после этой даты.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].price_change,
    });
  }

  return notification(lang, {
    subject: `A new price for your ${product} subscription`,
    body: [`From ${date} the subscription will cost ${newAmount} instead of ${oldAmount}.`],
    notice: "The new price applies at the first renewal after that date.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].price_change,
  });
}

function paymentMethodMigrate(lang, values) {
  const date = param(values, "date");
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    return notification(lang, {
      subject: `Введите карту заново в ${ruNoun(lang, values, "prepositional")}`,
      body: [
        `Платёжное подключение, через которое вы платили, выводится из работы с ${date}.`,
        "Введите карту заново, чтобы подписка продолжилась.",
      ],
      notice: "Данные карты вводятся на стороне платёжного сервиса и к нам не попадают.",
      link: billingUrl,
      label: BUTTON_LABELS[lang].payment_method_migrate,
    });
  }

  return notification(lang, {
    subject: `Enter your card again for ${product}`,
    body: [
      `The payment connection you used is being retired on ${date}.`,
      "Enter your card again so the subscription continues.",
    ],
    notice: "Card details are entered on the payment provider's side and never reach us.",
    link: billingUrl,
    label: BUTTON_LABELS[lang].payment_method_migrate,
  });
}

/**
 * The cancellation letter of ADR-257 §2.4. It is sent after the account has already
 * stopped, so its only job is to say when the data goes and how to change one's mind.
 */
function accountDeletion(lang, values) {
  const date = param(values, "date");
  const link = param(values, "link");
  const name = param(values, "name", { required: false });
  const product = values.product;

  if (lang === "ru") {
    const greeting = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
    const body = [
      greeting,
      `Аккаунт в ${ruNoun(lang, values, "prepositional")} перестанет работать сразу, а данные будут уничтожены ${date}.`,
    ];
    return {
      subject: `Аккаунт будет удалён ${date}`,
      text: `${body.join(" ")} Передумали? ${BUTTON_LABELS[lang].account_deletion}: ${link}\n\nСсылка действует 14 дней и сработает один раз.`,
      html: bodyHtml({
        lang,
        paragraphs: body.map(escapeHtml),
        footer: escapeHtml("Ссылка действует 14 дней и сработает один раз."),
        link,
        label: escapeHtml(BUTTON_LABELS[lang].account_deletion),
      }),
    };
  }

  const greeting = name ? `Hi ${name},` : "Hi,";
  const body = [
    greeting,
    `Your ${product} account has stopped working; the data will be erased on ${date}.`,
  ];
  return {
    subject: `Your ${product} account will be deleted on ${date}`,
    text: `${body.join(" ")} Changed your mind? ${BUTTON_LABELS[lang].account_deletion}: ${link}\n\nThe link works for 14 days and only once.`,
    html: bodyHtml({
      lang,
      paragraphs: body.map(escapeHtml),
      footer: escapeHtml("The link works for 14 days and only once."),
      link,
      label: escapeHtml(BUTTON_LABELS[lang].account_deletion),
    }),
  };
}

/**
 * The notice that a document got a new revision (ADR-256 §5). It is sent by the operator
 * command `pnpm legal:notify`, never at start: publishing a file is not an event the
 * service can guess. The link is the public page; the letter never asks for consent,
 * because consent is given by an action after signing in.
 */
function legalUpdate(lang, values) {
  const doc = param(values, "doc");
  const date = param(values, "date");
  const link = param(values, "link");
  const name = param(values, "name", { required: false });
  const product = values.product;
  const summary = param(values, "changes", { required: false });
  const changeNote = summary ? `${lang === "ru" ? "Что изменилось." : "What changed."} ${summary}` : undefined;
  if (lang === "ru") {
    const body = [
      name ? `Здравствуйте, ${name}!` : "Здравствуйте!",
      `Мы опубликовали новую редакцию документа «${doc}». Она вступает в силу ${date}.`,
      ...(changeNote ? [changeNote] : []),
      `При входе в ${ruNoun(lang, values, "accusative")} после этой даты сервис попросит прочитать и принять её.`,
    ];
    return {
      subject: `Новая редакция: ${doc}`,
      text: `${body.join(" ")} ${BUTTON_LABELS[lang].legal_update}: ${link}`,
      html: bodyHtml({
        lang,
        paragraphs: body.map(escapeHtml),
        highlight: changeNote && escapeHtml(changeNote),
        footer: escapeHtml("Если вы уже приняли эту редакцию, ничего делать не нужно."),
        link,
        label: escapeHtml(BUTTON_LABELS[lang].legal_update),
      }),
    };
  }
  const body = [
    name ? `Hi ${name},` : "Hi,",
    `We have published a new revision of “${doc}”. It takes effect on ${date}.`,
    ...(changeNote ? [changeNote] : []),
    `The next time you sign in to ${product} after that date, the service will ask you to read and accept it.`,
  ];
  return {
    subject: `A new revision: ${doc}`,
    text: `${body.join(" ")} ${BUTTON_LABELS[lang].legal_update}: ${link}`,
    html: bodyHtml({
      lang,
      paragraphs: body.map(escapeHtml),
      highlight: changeNote && escapeHtml(changeNote),
      footer: escapeHtml("If you have already accepted this revision, nothing needs doing."),
      link,
      label: escapeHtml(BUTTON_LABELS[lang].legal_update),
    }),
  };
}

/**
 * The refund letter of ADR-259 §4.3: the operator decided the money goes back, and the
 * payer hears it from the same product that took it. The bank's timing is stated because
 * "returned" and "visible on the statement" are different days.
 */
function paymentRefunded(lang, values) {
  const amount = param(values, "amount");
  const currency = param(values, "currency");
  const invoice = param(values, "invoice");
  const reason = param(values, "reason", { required: false });
  const billingUrl = param(values, "billingUrl");
  const product = values.product;

  if (lang === "ru") {
    const body = [
      "Здравствуйте!",
      `Мы вернули ${amount} (${currency}) по счёту ${invoice}.`,
      reason ? `Причина: ${reason}` : "",
      "Деньги вернутся на способ оплаты, которым вы платили; банк может зачислить их в течение нескольких дней.",
    ].filter(Boolean);
    return {
      subject: `Возврат по счёту ${invoice}`,
      text: `${body.join(" ")} ${BUTTON_LABELS[lang].payment_refunded}: ${billingUrl}`,
      html: bodyHtml({
        lang,
        paragraphs: body.map(escapeHtml),
        footer: escapeHtml("Если возврат не пришёл за десять рабочих дней, ответьте на это письмо."),
        link: billingUrl,
        label: escapeHtml(BUTTON_LABELS[lang].payment_refunded),
      }),
    };
  }

  const body = [
    "Hi,",
    `We refunded ${amount} (${currency}) for invoice ${invoice}.`,
    reason ? `Reason: ${reason}` : "",
    "The money returns to the payment method you used; your bank may take a few days to show it.",
  ].filter(Boolean);
  return {
    subject: `Refund for invoice ${invoice}`,
    text: `${body.join(" ")} ${BUTTON_LABELS[lang].payment_refunded}: ${billingUrl}`,
    html: bodyHtml({
      lang,
      paragraphs: body.map(escapeHtml),
      footer: escapeHtml("If the refund has not arrived within ten business days, reply to this email."),
      link: billingUrl,
      label: escapeHtml(BUTTON_LABELS[lang].payment_refunded),
    }),
  };
}

/**
 * The welcome letter (ADR-319): once, after the first confirmation of an address. It is the
 * one loud letter; the three steps are the first session, not a tour of the product.
 */
function welcome(lang, values) {
  const link = param(values, "appUrl");
  const name = param(values, "name", { required: false });
  const product = values.product;
  if (lang === "ru") {
    const greeting = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
    const lead = "Почта подтверждена — можно собирать первую комнату и звать коллег.";
    const steps = [
      "1. Создайте комнату — пустую или из шаблона ретро.",
      "2. Позовите коллег: ссылкой или по почте.",
      "3. Включите таймер в «Провести» — и начинайте.",
    ];
    const open = `Открыть ${ruNoun(lang, values, "accusative")}`;
    const notice = "Появился вопрос — просто ответьте на это письмо, его прочитает человек.";
    return {
      subject: `Добро пожаловать в ${ruNoun(lang, values, "accusative")}`,
      text: `${greeting} ${lead} ${steps.join(" ")} ${open}: ${link} ${notice}`,
      html: bodyHtml({
        lang,
        paragraphs: [escapeHtml(greeting), escapeHtml(lead)],
        rows: steps.map(escapeHtml),
        footer: escapeHtml(notice),
        link,
        label: escapeHtml(open),
      }),
    };
  }
  const greeting = name ? `Hi ${name},` : "Hi,";
  const lead = "your email is confirmed — you can start your first room and invite people.";
  const steps = [
    "1. Create a room — blank or from the retro template.",
    "2. Invite people by link or by email.",
    "3. Turn on the timer in Run — and begin.",
  ];
  const open = `Open ${product}`;
  const notice = "Got a question? Just reply to this email — a person reads it.";
  return {
    subject: `Welcome to ${product}`,
    text: `${greeting} ${lead} ${steps.join(" ")} ${open}: ${link} ${notice}`,
    html: bodyHtml({
      lang,
      paragraphs: [escapeHtml(greeting), escapeHtml(lead)],
      rows: steps.map(escapeHtml),
      footer: escapeHtml(notice),
      link,
      label: escapeHtml(open),
    }),
  };
}

const OPERATOR_ACTION_LABEL = {
  ru: {
    link_disable: "публичная ссылка на комнату отключена",
    board_hide: "комната скрыта из общего доступа",
    org_suspend: "работа организации приостановлена",
  },
  en: {
    link_disable: "the public link to a room has been turned off",
    board_hide: "a room has been hidden from general access",
    org_suspend: "the organisation has been suspended",
  },
};

/**
 * A measure against abuse, and its reversal (ADR-259 §4). The rules of use and the DSA
 * promise a reason and a way to appeal, so the letter is the measure's other half: it
 * names what changed, gives the public reason and an address to answer.
 */
function operatorAction(lang, values) {
  const kind = param(values, "kind");
  const reason = param(values, "reason");
  const appeal = param(values, "appeal");
  const restored = values.restored === true || values.restored === "true";
  const label = OPERATOR_ACTION_LABEL[lang][kind] ?? OPERATOR_ACTION_LABEL[lang].board_hide;
  const product = values.product;
  const mailto = appeal.startsWith("mailto:") ? appeal : `mailto:${appeal}`;

  if (lang === "ru") {
    const body = restored
      ? [
          "Здравствуйте!",
          `Мы сняли ограничение: ${label}. Доступ восстановлен.`,
          `Причина: ${reason}`,
        ]
      : [
          "Здравствуйте!",
          `Мы ограничили доступ в ${ruNoun(lang, values, "prepositional")}: ${label}.`,
          `Причина: ${reason}`,
          `Если это ошибка, ответьте на это письмо или напишите на ${appeal}: мы пересмотрим решение.`,
        ];
    return {
      subject: restored ? "Ограничение снято" : "Ограничение доступа",
      text: `${body.join(" ")} ${BUTTON_LABELS[lang].operator_action}: ${appeal}`,
      html: bodyHtml({
        lang,
        paragraphs: body.map(escapeHtml),
        footer: escapeHtml(`Обжалование: ${appeal}. Ответ на это письмо тоже доходит до нас.`),
        link: mailto,
        label: escapeHtml(BUTTON_LABELS[lang].operator_action),
      }),
    };
  }

  const body = restored
    ? [
        "Hi,",
        `We have lifted the restriction: ${label}. Access is restored.`,
        `Reason: ${reason}`,
      ]
    : [
        "Hi,",
        `We have restricted access to ${product}: ${label}.`,
        `Reason: ${reason}`,
        `If this is a mistake, reply to this email or write to ${appeal}: we will review the decision.`,
      ];
  return {
    subject: restored ? "The restriction has been lifted" : "Access restriction",
    text: `${body.join(" ")} ${BUTTON_LABELS[lang].operator_action}: ${appeal}`,
    html: bodyHtml({
      lang,
      paragraphs: body.map(escapeHtml),
      footer: escapeHtml(`Appeal: ${appeal}. A reply to this email reaches us too.`),
      link: mailto,
      label: escapeHtml(BUTTON_LABELS[lang].operator_action),
    }),
  };
}

/**
 * The line under every letter: who wrote it and where the product lives.
 *
 * An installation that runs under its own name (`REMO_PRODUCT_NAME`) gets only that name:
 * the brand and its cloud addresses belong to somebody else's service (ADR-254 §4.2, §7).
 */
function signatureFor(lang, { product, ownProduct, support }) {
  const name = escapeHtml(product);
  if (ownProduct) return { text: name, html: name };
  const site = lang === "ru" ? BRAND.domains.siteRu : BRAND.domains.site;
  const href = escapeHtml(`https://${site}`);
  // The mailbox belongs to the installation, not to the reader's language: an English
  // letter from the Russian installation is answered by support@remuka.ru. `undefined`
  // keeps the historical per-language default for a direct `render` call; `null` means
  // "this installation has no mailbox" (self-host without REMO_CONTACT_SUPPORT) and the
  // line is left out instead of printing somebody else's address.
  const address =
    support === undefined ? `support@${lang === "ru" ? BRAND.domains.siteRu : BRAND.domains.site}` : support;
  const siteHtml = `<a href="${href}" style="color:#57534e;">${escapeHtml(site)}</a>`;
  if (!address) return { text: `${product} · https://${site}`, html: `${name} · ${siteHtml}` };
  const mail = escapeHtml(address);
  return {
    text: `${product} · https://${site} · ${address}`,
    html: `${name} · ${siteHtml} · <a href="mailto:${mail}" style="color:#57534e;">${mail}</a>`,
  };
}

const RENDERERS = {
  verify_email: verifyEmail,
  password_reset: passwordReset,
  password_changed: passwordChanged,
  invitation: renderInvitation,
  trial_ending: trialEnding,
  renewal_upcoming: renewalUpcoming,
  subscription_canceled: subscriptionCanceled,
  payment_method_expiring: paymentMethodExpiring,
  price_change: priceChange,
  payment_method_migrate: paymentMethodMigrate,
  account_deletion: accountDeletion,
  legal_update: legalUpdate,
  payment_refunded: paymentRefunded,
  operator_action: operatorAction,
  welcome,
  ...MFA_RENDERERS,
  ...BILLING_RENDERERS,
};

/**
 * @param {"verify_email"|"password_reset"|"password_changed"|"invitation"|"payment_succeeded"|"payment_failed"|"trial_ending"|"renewal_upcoming"|"subscription_suspended"|"subscription_canceled"|"payment_method_expiring"|"price_change"|"payment_method_migrate"|"account_deletion"|"legal_update"|"payment_refunded"|"operator_action"|"mfa_enabled"|"mfa_disabled"|"mfa_reset"|"mfa_recovery_regenerated"|"mfa_recovery_used"} template
 * @param {"ru"|"en"} locale
 * @param {Record<string, unknown>} params
 * @returns {{ subject: string, text: string, html: string }}
 */
export function render(template, locale, params = {}, { stage = false, support } = {}) {
  if (!MAIL_TEMPLATES.includes(template)) {
    throw templateError("UNKNOWN_TEMPLATE");
  }
  const lang = typeof locale === "string" ? locale.toLowerCase() : "";
  if (!LOCALES.includes(lang)) {
    throw templateError("UNKNOWN_LOCALE");
  }
  const values = params && typeof params === "object" ? params : {};
  // The product name belongs to the installation, not to each call site. Without an
  // override it is the brand in the letter's language: «Ремука» or «Remuka» (ADR-254 §4.2).
  const explicitProduct = param(values, "product", { required: false });
  const product = explicitProduct ?? brandName({ locale: lang });
  const mail = RENDERERS[template](lang, { ...values, product, ownProduct: Boolean(explicitProduct) });
  const signature = signatureFor(lang, {
    product,
    ownProduct: Boolean(explicitProduct),
    support,
  });
  const deliveryNote = template === "invitation"
    ? (lang === "ru" ? "Вы получили это письмо, потому что участник команды отправил вам приглашение."
      : "You received this email because a team member invited you.")
    : (lang === "ru" ? `Это служебное письмо о вашем аккаунте в ${ruNoun(lang, { product, ownProduct: Boolean(explicitProduct) }, "prepositional")}.`
      : `This is a service email about your account on ${product}.`);
  return {
    // The stand's mark belongs to the one renderer, not to twenty-two templates
    // (`spec/stage.md` §5): a template cannot forget it and cannot spell it differently.
    subject: stage ? stageSubject(mail.subject, lang) : mail.subject,
    text: `${mail.text}\n\n${signature.text}\n\n${deliveryNote}`,
    html: mailDocument({ lang, product, subject: mail.subject, body: mail.html, signature: signature.html, deliveryNote }),
  };
}
