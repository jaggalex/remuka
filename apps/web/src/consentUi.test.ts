import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STORAGE_REGISTRY } from "@remo/consent";
import type { ConsentCategory } from "@remo/consent";
import { CookiePolicyTable, type PolicyTableRow } from "./CookiePolicyPage";
import { ConsentBannerCard, ConsentNoticeCard } from "./ConsentNotice";
import { ConsentCategoryList, type ConsentCategoryView } from "./ConsentSettingsDialog";
import { policyRows } from "./consentClient";

const LONG_NAMES: Record<ConsentCategory, string> = {
  necessary: "Необходимые",
  preferences: "Ваши настройки",
  analytics: "Аналитика",
  marketing: "Реклама",
};

function row(
  category: ConsentCategory,
  overrides: Partial<ConsentCategoryView> = {},
): ConsentCategoryView {
  return {
    category,
    title: LONG_NAMES[category],
    hint: "hint",
    enabled: category !== "analytics" && category !== "marketing",
    locked: category !== "analytics" && category !== "marketing",
    lockLabel: category === "necessary" ? "Всегда включено" : null,
    records: [{ name: `record.${category}`, purpose: "purpose", lifetime: "30 дней" }],
    countLabel: "1 запись",
    ...overrides,
  };
}

describe("the notice and the banner are bottom dialogs, not modals", () => {
  const notice = renderToStaticMarkup(
    h(ConsentNoticeCard, {
      text: "Ремука использует cookie, чтобы вы могли войти.",
      learnLabel: "Подробнее",
      actionLabel: "Понятно",
      policyHref: "/?legal=cookies",
      onAction: () => {},
    }),
  );

  it("shows the notice with one action and the policy link", () => {
    expect(notice).toContain('role="dialog"');
    expect(notice).not.toContain("aria-modal");
    expect(notice).toContain("Понятно");
    expect(notice).toContain('href="/?legal=cookies"');
    expect(notice.match(/<button/g)).toHaveLength(1);
  });

  it("links the personal-data consent document only when the operator set one", () => {
    expect(notice).not.toContain("Согласие на обработку персональных данных");

    const withConsent = renderToStaticMarkup(
      h(ConsentNoticeCard, {
        text: "Ремука использует cookie.",
        learnLabel: "Подробнее",
        actionLabel: "Понятно",
        policyHref: "/?legal=cookies",
        personalDataHref: "https://remuka.ru/legal/personal-data",
        personalDataLabel: "Согласие на обработку персональных данных",
        onAction: () => {},
      }),
    );
    expect(withConsent).toContain('href="https://remuka.ru/legal/personal-data"');
    expect(withConsent).toContain("Согласие на обработку персональных данных");
    // One action still: the document is a link, not a second button.
    expect(withConsent.match(/<button/g)).toHaveLength(1);
  });

  const banner = renderToStaticMarkup(
    h(ConsentBannerCard, {
      text: "Мы используем cookie.",
      acceptLabel: "Принять всё",
      rejectLabel: "Отклонить всё",
      customizeLabel: "Настроить",
      onAccept: () => {},
      onReject: () => {},
      onCustomize: () => {},
    }),
  );

  it("gives accept and reject the same weight, in that order", () => {
    expect(banner).toContain('role="dialog"');
    expect(banner).not.toContain("aria-modal");
    const accept = banner.indexOf("Принять всё");
    const reject = banner.indexOf("Отклонить всё");
    const customize = banner.indexOf("Настроить");
    expect(accept).toBeGreaterThan(-1);
    expect(accept).toBeLessThan(reject);
    expect(reject).toBeLessThan(customize);
    // Two secondary buttons and one ghost; no primary on the first screen (§1 rule 3).
    expect(banner.match(/rm-btn-secondary/g)).toHaveLength(2);
    expect(banner.match(/rm-btn-primary/g)).toBeNull();
    expect(banner.match(/rm-btn-ghost/g)).toHaveLength(1);
  });
});

describe("the settings list (§6.2, §6)", () => {
  it("states a necessary row and offers a checkbox only for a category that can change", () => {
    const html = renderToStaticMarkup(
      h(ConsentCategoryList, {
        rows: [
          row("necessary"),
          row("preferences"),
          row("analytics", { enabled: false, locked: false, lockLabel: null }),
        ],
        onToggle: () => {},
      }),
    );
    expect(html).toContain("Необходимые");
    expect(html).toContain("Ваши настройки");
    expect(html).toContain("Всегда включено");
    // `necessary` and `preferences` have no switch at all: one real question, one checkbox.
    expect(html.match(/type="checkbox"/g)).toHaveLength(1);
    expect(html.match(/disabled=""/g)).toBeNull();
    expect(html).toContain("record.necessary");
    expect(html).toContain("record.preferences");
    expect(html).toContain("record.analytics");
  });

  it("folds the register into a closed disclosure with the count in the row", () => {
    // ADR-264: a person reads two sentences, not twenty keys; the list is one click away
    // and the full table stays on the policy page.
    const html = renderToStaticMarkup(
      h(ConsentCategoryList, {
        rows: [row("necessary"), row("preferences")],
        onToggle: () => {},
      }),
    );
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toContain("<details open");
    expect(html).toContain("1 запись");
    expect(html).toContain("Всегда включено");
    // The records are inside the folded body, so the closed screen is short.
    expect(html).toMatch(/<details[\s\S]*record\.necessary[\s\S]*<\/details>/);
  });

  it("draws no switch when every category is decided by the installation", () => {
    const html = renderToStaticMarkup(
      h(ConsentCategoryList, {
        rows: [
          row("necessary"),
          row("preferences"),
          row("analytics", { enabled: false, locked: true, lockLabel: "Недоступно" }),
        ],
        onToggle: () => {},
      }),
    );
    expect(html.match(/type="checkbox"/g)).toBeNull();
    expect(html).toContain("Недоступно");
  });
});

describe("the policy table (§6.4)", () => {
  it("renders one row per registry record", () => {
    const rows: PolicyTableRow[] = policyRows().map((entry) => ({
      id: `${entry.category}:${entry.name}`,
      name: entry.name,
      category: entry.category,
      lifetime: entry.lifetime,
      purpose: entry.purpose.ru,
    }));
    const html = renderToStaticMarkup(
      h(CookiePolicyTable, {
        rows,
        label: "Политика cookie",
        columns: { name: "Ключ", category: "Категория", lifetime: "Срок", purpose: "Назначение" },
      }),
    );
    for (const entry of STORAGE_REGISTRY) expect(html, entry.name).toContain(entry.name);
    expect(html.match(/<tr>/g)).toHaveLength(STORAGE_REGISTRY.length + 1);
  });
});
