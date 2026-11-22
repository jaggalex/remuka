/**
 * The second factor's letters (`spec/totp.md` §7, `spec/operator-actions.md` §6).
 *
 * Split from `mail-templates.mjs` for the file-size ratchet; the renderers are registered
 * there. Copy is normative: what happened, when, and where to write if it was not you.
 */
import { BUTTON_LABELS, documentHtml, escapeHtml, param } from "./mail-template-kit.mjs";

/**
 * The second factor's letters (ADR-262 §6, `spec/totp.md` §7).
 *
 * Each one says what happened, when, and where to write if it was not the account holder.
 * The time is a display string the caller formats; the mailbox is the zone's support
 * address, with the security address for "this was not you" when the installation has one.
 * No address is invented for a self-host that configured none: the line changes, not the
 * person's privacy.
 */
function mfaLetter(lang, values, { subject, lines, footer }) {
  const settingsUrl = param(values, "settingsUrl");
  return {
    subject,
    text: `${lines.join(" ")} ${footer}\n\n${settingsUrl}`,
    html: documentHtml({
      lang,
      paragraphs: lines.map(escapeHtml),
      footer: escapeHtml(footer),
      link: settingsUrl,
      label: escapeHtml(BUTTON_LABELS[lang].mfa_settings),
    }),
  };
}

/** «Если это были не вы» — the one line every letter of the factor carries (§7). */
function mfaNotYou(lang, values) {
  const security = param(values, "security", { required: false });
  const support = param(values, "support", { required: false });
  const writeTo = security ?? support;
  if (writeTo) {
    return lang === "ru"
      ? `Если это были не вы — напишите на ${writeTo}.`
      : `If this wasn't you, write to ${writeTo}.`;
  }
  return lang === "ru"
    ? "Если это были не вы, смените пароль и сообщите администратору установки."
    : "If this wasn't you, change your password and tell the installation's administrator.";
}

function mfaEnabled(lang, values) {
  const date = param(values, "date");
  if (lang === "ru") {
    return mfaLetter(lang, values, {
      subject: "Двухфакторный вход включён",
      lines: [
        `Двухфакторный вход включён ${date}.`,
        "Код из приложения теперь нужен при входе и перед действиями в консоли.",
      ],
      footer: mfaNotYou(lang, values),
    });
  }
  return mfaLetter(lang, values, {
    subject: "Two-factor sign-in is on",
    lines: [
      `Two-factor sign-in was turned on ${date}.`,
      "The code from the app is now required to sign in and before actions in the console.",
    ],
    footer: mfaNotYou(lang, values),
  });
}

function mfaDisabled(lang, values) {
  const date = param(values, "date");
  if (lang === "ru") {
    return mfaLetter(lang, values, {
      subject: "Двухфакторный вход отключён",
      lines: [
        `Двухфакторный вход отключён ${date}.`,
        "Вход снова защищает только пароль.",
      ],
      footer: mfaNotYou(lang, values),
    });
  }
  return mfaLetter(lang, values, {
    subject: "Two-factor sign-in is off",
    lines: [
      `Two-factor sign-in was turned off ${date}.`,
      "The password alone protects the account again.",
    ],
    footer: mfaNotYou(lang, values),
  });
}

function mfaReset(lang, values) {
  const date = param(values, "date");
  if (lang === "ru") {
    return mfaLetter(lang, values, {
      subject: "Двухфакторный вход сброшен с сервера",
      lines: [
        `Двухфакторный вход сброшен с сервера ${date}.`,
        "Все сеансы завершены. При следующем входе подключите фактор заново.",
      ],
      footer: mfaNotYou(lang, values),
    });
  }
  return mfaLetter(lang, values, {
    subject: "Two-factor sign-in was reset from the server",
    lines: [
      `Two-factor sign-in was reset from the server ${date}.`,
      "Every session has ended. Enrol the factor again at your next sign-in.",
    ],
    footer: mfaNotYou(lang, values),
  });
}

function mfaRecoveryRegenerated(lang, values) {
  const count = param(values, "count");
  const date = param(values, "date");
  if (lang === "ru") {
    return mfaLetter(lang, values, {
      subject: "Резервные коды обновлены",
      lines: [
        `Сгенерированы новые резервные коды: ${count}, ${date}.`,
        "Старые коды больше не работают.",
      ],
      footer: mfaNotYou(lang, values),
    });
  }
  return mfaLetter(lang, values, {
    subject: "Recovery codes were regenerated",
    lines: [
      `New recovery codes were generated: ${count}, ${date}.`,
      "The old codes no longer work.",
    ],
    footer: mfaNotYou(lang, values),
  });
}

function mfaRecoveryUsed(lang, values) {
  const remaining = param(values, "remaining");
  const date = param(values, "date");
  if (lang === "ru") {
    return mfaLetter(lang, values, {
      subject: "Использован резервный код",
      lines: [
        `Использован резервный код ${date}.`,
        `Осталось кодов: ${remaining}.`,
      ],
      footer: mfaNotYou(lang, values),
    });
  }
  return mfaLetter(lang, values, {
    subject: "A recovery code was used",
    lines: [`A recovery code was used ${date}.`, `Codes left: ${remaining}.`],
    footer: mfaNotYou(lang, values),
  });
}

export const MFA_RENDERERS = {
  mfa_enabled: mfaEnabled,
  mfa_disabled: mfaDisabled,
  mfa_reset: mfaReset,
  mfa_recovery_regenerated: mfaRecoveryRegenerated,
  mfa_recovery_used: mfaRecoveryUsed,
};
