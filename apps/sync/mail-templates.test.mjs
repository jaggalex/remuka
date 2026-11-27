import { describe, expect, it } from "vitest";
import { MAIL_TEMPLATES, render } from "./mail-templates.mjs";

const BILLING_URL = "https://app.example.com/?billing=acme";

const CASES = {
  verify_email: { name: "Анна", link: "https://app.example.com/?verify=tok123" },
  password_reset: { link: "https://app.example.com/?reset=tok456" },
  password_changed: {
    email: "anna@example.com",
    forgotLink: "https://app.example.com/?forgot=1",
  },
  invitation: {
    inviter: "Иван",
    target: "Дизайн",
    targetKind: "organisation",
    expires: "1 декабря 2026",
    link: "https://app.example.com/?invite=inv789",
  },
  payment_succeeded: {
    plan: "Team",
    periodEnd: "27 января",
    amount: "290 ₽",
    currency: "RUB",
    last4: "4242",
    space: "Ромашка",
    period: "27 декабря — 27 января",
    invoice: "RU-2026-000123",
    invoiceUrl: "https://app.example.com/?invoice=INV-2026-000123",
  },
  payment_failed: {
    plan: "Team",
    graceEnd: "10 января",
    reason: "Банк отклонил карту •••• 4242",
    amount: "290 ₽",
    currency: "RUB",
    retries: "28 и 30 декабря, 3 и 9 января",
    space: "Ромашка",
    freeRooms: "5",
    billingUrl: BILLING_URL,
  },
  trial_ending: { date: "23 ноября 2026", billingUrl: BILLING_URL },
  renewal_upcoming: {
    date: "27 ноября 2026",
    amount: "29 000,00 ₽",
    currency: "RUB",
    billingUrl: BILLING_URL,
  },
  subscription_suspended: {
    space: "Ромашка", plan: "Team", date: "10 января", freeRooms: "5", rooms: "12", billingUrl: BILLING_URL,
  },
  subscription_canceled: { date: "1 декабря 2026", billingUrl: BILLING_URL },
  payment_method_expiring: {
    last4: "4242",
    expMonth: "05",
    expYear: "2027",
    billingUrl: BILLING_URL,
  },
  price_change: {
    oldAmount: "290,00 ₽",
    newAmount: "349,00 ₽",
    currency: "RUB",
    date: "20 декабря 2026",
    billingUrl: BILLING_URL,
  },
  payment_method_migrate: { date: "1 января 2027", billingUrl: BILLING_URL },
  account_deletion: {
    name: "Анна",
    date: "6 декабря 2026",
    link: "https://app.example.com/?restore=tok999",
  },
  legal_update: {
    name: "Анна",
    doc: "Согласие на обработку персональных данных",
    date: "1 декабря 2026",
    link: "https://app.example.com/legal/consent",
  },
  payment_refunded: {
    amount: "290,00 ₽",
    currency: "RUB",
    invoice: "RU-2026-000123",
    reason: "возврат по запросу",
    billingUrl: BILLING_URL,
  },
  operator_action: {
    kind: "link_disable",
    reason: "Ссылка вела на материалы, нарушающие правила.",
    appeal: "mailto:abuse@remuka.com",
    restored: false,
  },
  mfa_enabled: {
    date: "23 ноября 2026, 12:00 UTC",
    support: "support@remuka.ru",
    security: "security@remuka.com",
    settingsUrl: "https://app.example.com/",
  },
  mfa_disabled: {
    date: "23 ноября 2026, 12:00 UTC",
    support: "support@remuka.com",
    settingsUrl: "https://app.example.com/",
  },
  mfa_reset: {
    date: "23 ноября 2026, 12:00 UTC",
    support: "support@remuka.com",
    settingsUrl: "https://app.example.com/",
  },
  mfa_recovery_regenerated: {
    count: 10,
    date: "23 ноября 2026, 12:00 UTC",
    support: "support@remuka.com",
    settingsUrl: "https://app.example.com/",
  },
  mfa_recovery_used: {
    remaining: 7,
    date: "23 ноября 2026, 12:00 UTC",
    support: "support@remuka.com",
    settingsUrl: "https://app.example.com/",
  },
};

Object.assign(CASES, {
  plan_activated: {
    plan: "Team", space: "Ромашка", date: "27 ноября", limits: "20 мест, комнаты без ограничений",
    summary: ["Team, месяц", "Счёт RU-2026-000120", "Оплачено 590 ₽"],
    nextDate: "27 декабря", nextAmount: "590 ₽", spaceUrl: "https://app.example.com/",
  },
  payment_final_attempt: {
    plan: "Team", date: "9 января", amount: "290 ₽", currency: "RUB", last4: "4242",
    graceEnd: "10 января", space: "Ромашка", freeRooms: "5", rooms: "12", billingUrl: BILLING_URL,
  },
  payment_recovered: {
    plan: "Team", space: "Ромашка", amount: "290 ₽", currency: "RUB",
    period: "12 января — 12 февраля", spaceUrl: "https://app.example.com/",
  },
  downgrade_scheduled: {
    date: "27 декабря", space: "Ромашка", plan: "Pro", currentPlan: "Team",
    planNote: "Pro начнёт действовать после оплаты продления — 290 ₽ в месяц.",
    impact: "Мест станет 5 вместо 20.", spaceUrl: BILLING_URL,
  },
  downgrade_applied: {
    date: "27 декабря", space: "Ромашка", plan: "Pro", charged: "— списали 290 ₽ за месяц",
    seats: "4 из 5", activeRooms: "8", readOnly: "0", spaceUrl: "https://app.example.com/",
  },
  autopay_disabled: { plan: "Team", space: "Ромашка", date: "27 декабря", spaceUrl: BILLING_URL },
  seats_over_limit: {
    space: "Ромашка", used: "7", plan: "Pro", limit: "5", date: "11 декабря",
    spaceUrl: "https://app.example.com/?people=1",
  },
  welcome: { name: "Анна", appUrl: "https://app.example.com/" },
});

const LINK_PARAMS = {
  plan_activated: "spaceUrl",
  payment_recovered: "spaceUrl",
  downgrade_scheduled: "spaceUrl",
  downgrade_applied: "spaceUrl",
  autopay_disabled: "spaceUrl",
  seats_over_limit: "spaceUrl",
  welcome: "appUrl",
  password_changed: "forgotLink",
  payment_succeeded: "invoiceUrl",
  operator_action: "appeal",
  mfa_enabled: "settingsUrl",
  mfa_disabled: "settingsUrl",
  mfa_reset: "settingsUrl",
  mfa_recovery_regenerated: "settingsUrl",
  mfa_recovery_used: "settingsUrl",
};

function linkOf(template, params) {
  return params[LINK_PARAMS[template] ?? "billingUrl"] ?? params.link;
}

function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

describe("MAIL_TEMPLATES", () => {
  it("lists every template of the spec, auth and billing", () => {
    expect(MAIL_TEMPLATES).toEqual([
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
      "plan_activated",
      "payment_final_attempt",
      "payment_recovered",
      "downgrade_scheduled",
      "downgrade_applied",
      "autopay_disabled",
      "seats_over_limit",
      "welcome",
    ]);
  });
});

describe("render", () => {
  for (const template of MAIL_TEMPLATES) {
    for (const locale of ["ru", "en"]) {
      it(`renders ${template} in ${locale} with text and a clickable link`, () => {
        const params = CASES[template];
        const link = linkOf(template, params);
        const mail = render(template, locale, params);

        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.text.length).toBeGreaterThan(0);
        expect(mail.html.length).toBeGreaterThan(0);

        // A plain-text reader is not a second-class reader: the same link must work there.
        expect(mail.text).toContain(link);
        expect(mail.html).toContain(link);
        expect(mail.html).toContain(`href="${link}"`);

        for (const part of [mail.subject, mail.text, mail.html]) {
          expect(part).not.toMatch(/undefined|\[object Object\]/);
        }
      });
    }
  }

  it.each(["ru", "en"])("puts the legal summary above the link in plain text and safe HTML (%s)", locale => {
    const summary = "Changed <days> & rules.";
    const params = { ...CASES.legal_update, changes: summary };
    const mail = render("legal_update", locale, params);
    expect(mail.text).toContain(summary);
    expect(mail.text.indexOf(summary)).toBeLessThan(mail.text.indexOf(params.link));
    expect(mail.html).toContain("Changed &lt;days&gt; &amp; rules.");
    expect(mail.html.indexOf("Changed &lt;days&gt;")).toBeLessThan(mail.html.indexOf(params.link));
  });

  it("escapes substitutions in HTML but not in the subject", () => {
    const mail = render("verify_email", "ru", {
      name: "<script>alert(1)</script>",
      link: CASES.verify_email.link,
      product: 'A & B "quoted"',
    });

    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("A &amp; B &quot;quoted&quot;");
    expect(mail.subject).toContain("A & B");
  });

  it("escapes the invitation target and keeps its quotes intact in text", () => {
    const params = { ...CASES.invitation, target: 'R&D "room"' };
    const mail = render("invitation", "en", params);

    expect(mail.html).toContain("R&amp;D &quot;room&quot;");
    expect(mail.html).not.toContain('R&D "room"');
    expect(mail.text).toContain('R&D "room"');
  });

  it("has no external images or fonts", () => {
    for (const template of MAIL_TEMPLATES) {
      const mail = render(template, "ru", CASES[template]);
      expect(mail.html).not.toContain("<img");
      expect(mail.html).not.toContain("@font-face");
      expect(mail.html).not.toContain("http://fonts");
    }
  });

  it("uses a neutral greeting when the name is absent", () => {
    const ru = render("verify_email", "ru", { link: CASES.verify_email.link });
    const en = render("verify_email", "en", { link: CASES.verify_email.link });

    expect(ru.text.startsWith("Здравствуйте!")).toBe(true);
    expect(en.text.startsWith("Hi,")).toBe(true);
    expect(ru.text).not.toContain("undefined");
    expect(en.text).not.toContain("undefined");
  });

  it("defaults the product name to the brand in the letter's language", () => {
    const en = render("password_reset", "en", { link: CASES.password_reset.link });
    const ru = render("password_reset", "ru", { link: CASES.password_reset.link });
    expect(en.subject).toBe("Reset your Remuka password");
    expect(ru.subject).toBe("Сброс пароля в Ремуке");
  });

  it("uses an installation's own name and hides the brand", () => {
    const en = render("password_reset", "en", {
      link: CASES.password_reset.link,
      product: "Acme Boards",
    });
    const ru = render("password_reset", "ru", {
      link: CASES.password_reset.link,
      product: "Acme Boards",
    });
    expect(en.subject).toBe("Reset your Acme Boards password");
    expect(ru.subject).toBe("Сброс пароля в сервисе Acme Boards");
    for (const mail of [en, ru]) {
      expect(mail.text).not.toMatch(/Ремука|Remuka/);
      expect(mail.html).not.toContain("remuka.com");
      expect(mail.text).toContain("Acme Boards");
    }
  });

  it("signs every letter with the brand and its addresses", () => {
    const en = render("verify_email", "en", CASES.verify_email);
    const ru = render("verify_email", "ru", CASES.verify_email);
    // The mailbox follows the language only when no zone was passed: the Russian letter
    // no longer prints support@remuka.com.
    expect(en.text).toContain("support@remuka.com");
    expect(ru.text).toContain("support@remuka.ru");
    expect(en.text).toContain("https://remuka.com");
    expect(en.html).toContain('href="https://remuka.com"');
    expect(ru.text).toContain("https://remuka.ru");
    expect(ru.html).toContain('href="https://remuka.ru"');
  });

  it("takes the mailbox from the installation's zone and omits it when there is none", () => {
    const ruZoneEnglish = render("verify_email", "en", CASES.verify_email, {
      support: "support@remuka.ru",
    });
    expect(ruZoneEnglish.text).toContain("support@remuka.ru");
    expect(ruZoneEnglish.text).not.toContain("support@remuka.com");

    const selfHost = render("verify_email", "en", CASES.verify_email, { support: null });
    expect(selfHost.text).not.toContain("mailto:");
    expect(selfHost.text).not.toContain("support@");
    expect(selfHost.text).toContain("https://remuka.com");
  });

  it("localises the invitation target kind", () => {
    const room = { ...CASES.invitation, targetKind: "room" };
    expect(render("invitation", "ru", room).text).toContain("в комнату «Дизайн»");
    expect(render("invitation", "en", room).text).toContain('the room "Дизайн"');

    const organisation = { ...CASES.invitation, targetKind: "organisation" };
    expect(render("invitation", "ru", organisation).text).toContain(
      "в организацию «Дизайн»",
    );
    expect(render("invitation", "en", organisation).text).toContain(
      'the organisation "Дизайн"',
    );
  });

  it("adds the documents link to an invitation only when the installation has one", () => {
    const policy = "https://app.remuka.ru/legal/privacy";
    const ru = render("invitation", "ru", { ...CASES.invitation, policy });
    const en = render("invitation", "en", { ...CASES.invitation, policy });
    expect(ru.text).toContain("странице документов");
    expect(ru.text).toContain(policy);
    expect(ru.html).toContain(`href="${policy}"`);
    expect(en.text).toContain("documents page");
    expect(en.html).toContain(`href="${policy}"`);

    // A `none` installation keeps the letter it had before (§6).
    const plain = render("invitation", "ru", CASES.invitation);
    expect(plain.text).not.toContain("документов");
    expect(plain.html).not.toContain("/legal/");
  });

  it("removes line breaks from single-line fields", () => {
    const mail = render("invitation", "ru", {
      ...CASES.invitation,
      inviter: "Иван\nBcc: evil@example.com",
      target: "Дизайн\r\nОтдел",
    });
    expect(mail.subject).not.toContain("\n");
    expect(mail.text).not.toContain("\nBcc:");
    expect(mail.text).toContain("Иван Bcc: evil@example.com");
    expect(mail.subject).not.toContain("\r");
  });

  it("rejects an unknown template", () => {
    expect(errorOf(() => render("no_such_letter", "ru", {})).code).toBe("UNKNOWN_TEMPLATE");
  });

  it("rejects an unknown or missing locale", () => {
    const link = CASES.password_reset.link;
    expect(errorOf(() => render("password_reset", "de", { link })).code).toBe(
      "UNKNOWN_LOCALE",
    );
    expect(errorOf(() => render("password_reset", undefined, { link })).code).toBe(
      "UNKNOWN_LOCALE",
    );
  });

  it("names the missing parameter", () => {
    const error = errorOf(() => render("password_reset", "ru", {}));
    expect(error.code).toBe("MISSING_PARAM");
    expect(error.param).toBe("link");

    const changed = errorOf(() =>
      render("password_changed", "en", { forgotLink: CASES.password_changed.forgotLink }),
    );
    expect(changed.code).toBe("MISSING_PARAM");
    expect(changed.param).toBe("email");

    const invite = errorOf(() =>
      render("invitation", "ru", { ...CASES.invitation, target: undefined }),
    );
    expect(invite.code).toBe("MISSING_PARAM");
    expect(invite.param).toBe("target");
  });

  it("treats an object where a required string belongs as a missing parameter", () => {
    const error = errorOf(() =>
      render("verify_email", "ru", {
        link: { href: "https://app.example.com" },
      }),
    );
    expect(error.code).toBe("MISSING_PARAM");
    expect(error.param).toBe("link");
  });

  it("ignores an optional name that is not text", () => {
    const mail = render("verify_email", "ru", {
      name: { toString: () => "object" },
      link: CASES.verify_email.link,
    });
    expect(mail.text.startsWith("Здравствуйте!")).toBe(true);
    expect(mail.text).not.toContain("[object Object]");
  });
});

describe("billing templates", () => {
  const TEMPLATES = [
    "payment_succeeded",
    "payment_failed",
    "trial_ending",
    "renewal_upcoming",
    "subscription_suspended",
    "subscription_canceled",
    "payment_method_expiring",
    "price_change",
    "payment_method_migrate",
  ];

  // The caller formats the sum; the template must print it unchanged and never invent
  // a currency of its own.
  const SUMS = {
    payment_succeeded: ["290 ₽"],
    payment_failed: ["290 ₽"],
    renewal_upcoming: ["29 000,00 ₽"],
    price_change: ["290,00 ₽", "349,00 ₽"],
  };

  for (const template of TEMPLATES) {
    for (const locale of ["ru", "en"]) {
      it(`renders ${template} in ${locale} with its sum and link`, () => {
        const params = CASES[template];
        const link = linkOf(template, params);
        const mail = render(template, locale, params);

        expect(mail.subject.length).toBeGreaterThan(0);
        expect(mail.text.length).toBeGreaterThan(0);
        expect(mail.html.length).toBeGreaterThan(0);
        expect(mail.text).toContain(link);
        expect(mail.html).toContain(`href="${link}"`);

        for (const sum of SUMS[template] ?? []) {
          expect(mail.text).toContain(sum);
          expect(mail.html).toContain(sum);
        }
      });
    }
  }

  it("uses the retry dates and the card details it was given", () => {
    expect(render("payment_failed", "ru", CASES.payment_failed).text).toContain(
      CASES.payment_failed.retries,
    );
    const card = render("payment_method_expiring", "en", CASES.payment_method_expiring);
    expect(card.text).toContain("4242");
    expect(card.text).toContain("05/2027");
  });

  it("escapes billing substitutions in HTML but not in text", () => {
    const mail = render("payment_succeeded", "ru", {
      ...CASES.payment_succeeded,
      amount: "</p><script>alert(1)</script>",
      period: 'R&D "year"',
      space: "<b>",
    });

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("R&amp;D &quot;year&quot;");
    expect(mail.text).toContain("<script>");
    expect(mail.text).toContain('R&D "year"');
  });

  it("refuses a sum without its ISO currency code", () => {
    const error = errorOf(() =>
      render("payment_succeeded", "en", {
        ...CASES.payment_succeeded,
        currency: undefined,
      }),
    );
    expect(error.code).toBe("MISSING_PARAM");
    expect(error.param).toBe("currency");
  });
});

/**
 * The letters of ADR-319 against their normative text in `spec/mail.md` §6: the subject and
 * the first sentence word for word, the link as text, escaping, and nothing external.
 */
describe("payment and plan letters (ADR-319)", () => {
  const NORMATIVE = {
    plan_activated: {
      ru: ["Спасибо за оплату — Team подключён в «Ромашка»", "С 27 ноября в «Ромашка» действует Team: 20 мест, комнаты без ограничений. Team, месяц. Счёт RU-2026-000120. Оплачено 590 ₽. Следующее списание — 27 декабря, 590 ₽. Открыть «Ромашка»: https://app.example.com/"],
      en: ["Thanks for your payment — Team is on for “Ромашка”", "From 27 ноября, “Ромашка” is on Team"],
    },
    payment_succeeded: {
      ru: ["Подписка Team продлена до 27 января", "Списали 290 ₽ с карты •••• 4242 — «Ромашка» работает без перерыва. Период: 27 декабря — 27 января. Счёт RU-2026-000123: https://app.example.com/?invoice=INV-2026-000123"],
      en: ["Your Team subscription is renewed until 27 января", "We charged 290 ₽ to card •••• 4242 — “Ромашка” carries on without a break."],
    },
    payment_failed: {
      ru: ["Оплата за Team не прошла — обновите карту до 10 января", "Банк отклонил карту •••• 4242, и мы не смогли списать 290 ₽ за продление Team. До 10 января всё работает как прежде: комнаты, участники и данные на месте. Повторим попытку 28 и 30 декабря, 3 и 9 января. Если оплата не пройдёт, 10 января «Ромашка» перейдёт на Бесплатный: активными останутся 5 комнат, остальные станут только для чтения. Обновить карту: https://app.example.com/?billing=acme"],
      en: ["Payment for Team didn't go through — update your card by 10 января", "Банк отклонил карту •••• 4242, so we couldn't charge 290 ₽ for the Team renewal."],
    },
    payment_final_attempt: {
      ru: ["Завтра последняя попытка оплатить Team", "9 января ещё раз попробуем списать 290 ₽ с карты •••• 4242. Если не получится, 10 января «Ромашка» перейдёт на Бесплатный: активными останутся 5 комнат из 12, данные сохранятся. Обновить карту:"],
      en: ["Tomorrow is the last try to pay for Team", "On 9 января we'll try once more to charge 290 ₽ to card •••• 4242."],
    },
    subscription_suspended: {
      ru: ["«Ромашка» теперь на Бесплатном", "Оплата за Team так и не прошла, поэтому с 10 января в «Ромашка» действует Бесплатный. Активными остались 5 комнат из 12, остальные — только для чтения, экспорт работает. Участники на месте, новые приглашения закрыты. Ничего не удалено: оплата вернёт Team сразу. Оплатить Team:"],
      en: ["“Ромашка” has moved to Free", "The Team payment never went through, so from 10 января “Ромашка” is on Free."],
    },
    payment_recovered: {
      ru: ["Доступ к Team в «Ромашка» вернулся", "Оплата 290 ₽ прошла — в «Ромашка» снова действует Team, все комнаты активны. Период: 12 января — 12 февраля. Открыть «Ромашка»:"],
      en: ["Team is back for “Ромашка”", "The 290 ₽ payment went through — “Ромашка” is on Team again and every room is active."],
    },
    downgrade_scheduled: {
      ru: ["С 27 декабря в «Ромашка» — Pro", "До 27 декабря действует Team. Pro начнёт действовать после оплаты продления — 290 ₽ в месяц. Мест станет 5 вместо 20. Выбрать активные комнаты или отменить изменение можно до 27 декабря:"],
      en: ["From 27 декабря, “Ромашка” moves to Pro", "Team stays on until 27 декабря."],
    },
    downgrade_applied: {
      ru: ["«Ромашка» теперь на Pro", "С 27 декабря в «Ромашка» действует Pro — списали 290 ₽ за месяц. Места: 4 из 5. Активные комнаты: 8; остальные 0 — только для чтения, экспорт работает."],
      en: ["“Ромашка” is now on Pro", "From 27 декабря, “Ромашка” is on Pro"],
    },
    autopay_disabled: {
      ru: ["Автопродление Team выключено", "Списаний больше не будет. Доступ к Team в «Ромашка» — до 27 декабря, потом пространство перейдёт на Бесплатный. Если выключили не вы, включите автопродление снова и сообщите администраторам пространства:"],
      en: ["Auto-renewal for Team is off", "There will be no more charges."],
    },
    seats_over_limit: {
      ru: ["В «Ромашка» мест больше, чем в тарифе", "В «Ромашка» 7 человек, а в Pro — 5 мест. Никого не удаляем, но новые приглашения пока закрыты."],
      en: ["“Ромашка” has more people than its plan allows", "“Ромашка” has 7 people and Pro includes 5 seats."],
    },
    welcome: {
      ru: ["Добро пожаловать в Ремуку", "Здравствуйте, Анна! Почта подтверждена — можно собирать первую комнату и звать коллег. 1. Создайте комнату — пустую или из шаблона ретро. 2. Позовите коллег: ссылкой или по почте. 3. Включите таймер в «Провести» — и начинайте. Открыть Ремуку: https://app.example.com/ Появился вопрос — просто ответьте на это письмо, его прочитает человек."],
      en: ["Welcome to Remuka", "Hi Анна, your email is confirmed — you can start your first room and invite people."],
    },
  };

  for (const [template, locales] of Object.entries(NORMATIVE)) {
    for (const [locale, [subject, opening]] of Object.entries(locales)) {
      it(`${template} (${locale}) keeps the spec's subject and first lines`, () => {
        const mail = render(template, locale, CASES[template]);
        expect(mail.subject).toBe(subject);
        expect(mail.text.startsWith(opening)).toBe(true);
      });
    }
  }

  it.each(Object.keys(NORMATIVE))("%s escapes the space name and loads nothing external", (template) => {
    const params = { ...CASES[template], space: "<script>alert(1)</script>", name: "<script>x</script>" };
    for (const locale of ["ru", "en"]) {
      const mail = render(template, locale, params);
      expect(mail.html).not.toMatch(/<script/i);
      expect(mail.html).not.toMatch(/<img|<link|@import|url\(/i);
      expect(mail.text).toContain(linkOf(template, params));
    }
  });

  it("drops the card from a renewal paid without one", () => {
    const mail = render("payment_succeeded", "ru", { ...CASES.payment_succeeded, last4: undefined });
    expect(mail.text.startsWith("Списали 290 ₽ — «Ромашка» работает без перерыва.")).toBe(true);
  });
});
