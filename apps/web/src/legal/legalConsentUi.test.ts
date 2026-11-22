import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LegalConsentView } from "./LegalConsent";
import type { LegalDocumentConfig } from "./legalConfig";

const HASH = "a".repeat(64);

const T: Record<string, string> = {
  "legal.consent.group": "Документы для принятия",
  "legal.consent.requiredHint": "Отметьте, чтобы создать аккаунт",
  "legal.consent.draft": "Черновик",
  "legal.consent.offerBefore": "Я принимаю условия ",
  "legal.consent.offerLink": "оферты",
  "legal.consent.offerAfter": ".",
  "legal.consent.consentBefore": "Даю согласие на обработку данных на условиях ",
  "legal.consent.consentLink": "Согласия",
  "legal.consent.consentMiddle": ". Как мы их обрабатываем — в ",
  "legal.consent.privacyLink": "Политике",
  "legal.consent.consentAfter": ".",
  "legal.consent.termsBefore": "Я принимаю ",
  "legal.consent.termsLink": "Условия использования",
  "legal.consent.termsMiddle": ". О том, как мы обрабатываем данные, — в ",
  "legal.consent.termsAfter": ".",
  "legal.consent.genericBefore": "Я принимаю ",
  "legal.consent.genericAfter": ".",
  "legal.doc.offer": "Договор-оферта",
  "legal.doc.consent": "Согласие на обработку персональных данных",
  "legal.doc.privacy": "Политика обработки персональных данных",
};

function t(key: string, vars?: Record<string, string | number>): string {
  const text = T[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

function document(overrides: Partial<LegalDocumentConfig> = {}): LegalDocumentConfig {
  return {
    doc: "offer",
    zone: "ru",
    version: 1,
    sha256: HASH,
    effective: "2026-12-01",
    required: "signup",
    reaccept: true,
    status: "published",
    withdrawable: false,
    url: "https://app.remuka.ru/legal/offer",
    ...overrides,
  };
}

const offer = document();
const consent = document({ doc: "consent", url: "https://app.remuka.ru/legal/consent", withdrawable: true });
const privacy = document({
  doc: "privacy",
  required: "none",
  reaccept: false,
  url: "https://app.remuka.ru/legal/privacy",
});

function render(checked: Record<string, boolean> = {}, error?: string): string {
  return renderToStaticMarkup(
    h(LegalConsentView, {
      documents: [offer, consent],
      all: [offer, consent, privacy],
      checked,
      onChange: () => {},
      error,
      t,
    }),
  );
}

describe("the registration consent (ADR-256 §3, §7)", () => {
  it("renders two empty checkboxes with the three document links", () => {
    const html = render();
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).not.toContain("checked");
    expect(html).toContain('href="https://app.remuka.ru/legal/offer"');
    expect(html).toContain('href="https://app.remuka.ru/legal/consent"');
    expect(html).toContain('href="https://app.remuka.ru/legal/privacy"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Отметьте, чтобы создать аккаунт");
  });

  it("keeps the offer and the personal-data consent as separate actions", () => {
    const html = render({ offer: true });
    // One box is filled, the other is not: the sentence and the hint of the second stay.
    expect((html.match(/checked/g) ?? []).length).toBe(1);
    expect(html).toContain("Отметьте, чтобы создать аккаунт");
  });

  it("marks a draft and shows a server refusal", () => {
    const html = renderToStaticMarkup(
      h(LegalConsentView, {
        documents: [document({ status: "draft" })],
        all: [offer],
        checked: {},
        onChange: () => {},
        error: "Документ изменился",
        t,
      }),
    );
    expect(html).toContain("Черновик");
    expect(html).toContain("Документ изменился");
  });
});
