/**
 * The invitation letter (ADR-246 §5.3, ADR-256 §6).
 *
 * Its own module so the templates file stays inside the 800-line budget. The text is
 * normative and unchanged when an installation has no documents to link; the optional
 * `policy` line names the documents page of a zone.
 */
import {
  BUTTON_LABELS,
  bodyHtml,
  escapeHtml,
  param,
  ruNoun,
  templateError,
} from "./mail-template-kit.mjs";

const TARGET_KINDS = {
  ru: { organisation: "организацию", room: "комнату" },
  en: { organisation: "organisation", room: "room" },
};

export function renderInvitation(lang, values) {
  const inviter = param(values, "inviter");
  const target = param(values, "target");
  const targetKey = param(values, "targetKind");
  const expires = param(values, "expires");
  const link = param(values, "link");
  // Optional: a `none` self-host without a policy has nothing to link, and its letter
  // keeps the exact text it had before (§6).
  const policy = param(values, "policy", { required: false });
  const product = values.product;

  const kind = Object.hasOwn(TARGET_KINDS[lang], targetKey)
    ? TARGET_KINDS[lang][targetKey]
    : null;
  if (!kind) throw templateError("UNKNOWN_TARGET_KIND");

  const documents = policy
    ? lang === "ru"
      ? `Как мы обрабатываем данные и какие документы действуют — на странице документов: ${policy}`
      : `How we handle your data and which documents apply are on the documents page: ${policy}`
    : null;
  const documentsHtml = policy
    ? lang === "ru"
      ? `Как мы обрабатываем данные и какие документы действуют — на <a href="${escapeHtml(policy)}">странице документов</a>.`
      : `How we handle your data and which documents apply are on the <a href="${escapeHtml(policy)}">documents page</a>.`
    : null;
  const paragraphs = (line) => (documentsHtml ? [line, documentsHtml] : [line]);

  if (lang === "ru") {
    const line = `${inviter} приглашает вас в ${kind} «${target}» в ${ruNoun(lang, values, "prepositional")}.`;
    const notice = `Приглашение действует до ${expires}.`;
    return {
      subject: `${inviter} приглашает вас в ${kind} «${target}»`,
      text: `${line} ${BUTTON_LABELS[lang].invitation}: ${link}\n\n${notice}${documents ? `\n\n${documents}` : ""}`,
      html: bodyHtml({
        lang,
        paragraphs: paragraphs(
          `${escapeHtml(inviter)} приглашает вас в ${escapeHtml(kind)} «<strong>${escapeHtml(target)}</strong>» в ${escapeHtml(ruNoun(lang, values, "prepositional"))}.`,
        ),
        highlight: escapeHtml(notice),
        link,
        label: escapeHtml(BUTTON_LABELS[lang].invitation),
      }),
    };
  }

  const line = `${inviter} invited you to the ${kind} "${target}" on ${product}.`;
  const notice = `The invitation is valid until ${expires}.`;
  return {
    subject: `${inviter} invited you to ${target}`,
    text: `${line} ${BUTTON_LABELS[lang].invitation}: ${link}\n\n${notice}${documents ? `\n\n${documents}` : ""}`,
    html: bodyHtml({
      lang,
      paragraphs: paragraphs(
        `${escapeHtml(inviter)} invited you to the ${escapeHtml(kind)} "<strong>${escapeHtml(target)}</strong>" on ${escapeHtml(product)}.`,
      ),
      highlight: escapeHtml(notice),
      link,
      label: escapeHtml(BUTTON_LABELS[lang].invitation),
    }),
  };
}
