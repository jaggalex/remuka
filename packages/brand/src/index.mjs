/**
 * The public brand of the product (ADR-254, `spec/rebrand.md` §3).
 *
 * One source for the name and the cloud's addresses: the browser, the service and the
 * documentation build import this module instead of spelling «Ремука» themselves. The
 * code name `remo` is a separate contract (`spec/rebrand.md` §2) and is not renamed here.
 */
export const BRAND = Object.freeze({
  /** The code name. It stays in packages, env variables, headers and storage keys. */
  code: "remo",
  /** The public name with a capital letter: the form used in running text. */
  name: Object.freeze({ ru: "Ремука", en: "Remuka" }),
  /**
   * Russian case forms of the public name (`spec/rebrand.md` §4.3). The brand is a proper
   * noun and declines; an installation's own name does not, so callers use the
   * «в сервисе {product}» construction for that case instead.
   */
  cases: Object.freeze({
    ru: Object.freeze({
      nominative: "Ремука",
      genitive: "Ремуки",
      dative: "Ремуке",
      accusative: "Ремуку",
      instrumental: "Ремукой",
      prepositional: "Ремуке",
    }),
  }),
  /** The old name, only for the one allowed history line «Ремука (раньше remo)». */
  legacy: Object.freeze({ ru: "remo", en: "remo" }),
  /** How to say it out loud; `spec/rebrand.md` §11 fixes the stress as ремУка. */
  pronunciation: Object.freeze({ ru: "ремУка", en: "reh-MOO-kah" }),
  /** The cloud's hosts. A self-host installation keeps its own addresses in env. */
  domains: Object.freeze({
    app: "app.remuka.com",
    docs: "docs.remuka.com",
    site: "remuka.com",
    siteRu: "remuka.ru",
    support: "support.remuka.com",
    status: "status.remuka.com",
    mail: "mail.remuka.com",
  }),
});

/**
 * The name a person sees: «Ремука» in Russian, «Remuka» otherwise.
 *
 * `productName` is an installation's own name. When it is set and not blank it wins
 * over the brand, so a fork shows its own name everywhere (`REMO_PRODUCT_NAME`).
 */
export function brandName({ locale = "ru", productName = null } = {}) {
  const own = typeof productName === "string" ? productName.trim() : "";
  if (own) return own;
  return locale === "ru" ? BRAND.name.ru : BRAND.name.en;
}

/** The old name for the one allowed history line: «Ремука (раньше remo)». */
export function brandLegacyName(locale = "ru") {
  return locale === "ru" ? BRAND.legacy.ru : BRAND.legacy.en;
}

/** Russian grammatical cases a sentence may need. */
export const BRAND_RU_CASES = Object.freeze([
  "nominative",
  "genitive",
  "dative",
  "accusative",
  "instrumental",
  "prepositional",
]);

/**
 * The name in a Russian case, for a sentence that cannot be rewritten around it.
 *
 * An installation's own name is returned as written: a name in another language is not
 * declined, and the caller uses «в сервисе {product}» instead (`spec/rebrand.md` §4.3).
 */
export function brandNameCase({
  locale = "ru",
  grammaticalCase = "nominative",
  productName = null,
} = {}) {
  const own = typeof productName === "string" ? productName.trim() : "";
  if (own) return own;
  if (locale === "ru") return BRAND.cases.ru[grammaticalCase] ?? BRAND.name.ru;
  return BRAND.name.en;
}
