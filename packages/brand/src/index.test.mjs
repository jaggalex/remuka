import { describe, expect, it } from "vitest";
import { BRAND, brandLegacyName, brandName, brandNameCase } from "./index.mjs";

describe("the public brand (ADR-254)", () => {
  it("names the product by locale and defaults to Russian", () => {
    expect(brandName({ locale: "ru" })).toBe("Ремука");
    expect(brandName({ locale: "en" })).toBe("Remuka");
    expect(brandName()).toBe("Ремука");
    expect(brandName({})).toBe("Ремука");
  });

  it("keeps the old name for the one allowed history line", () => {
    expect(brandLegacyName("ru")).toBe("remo");
    expect(brandLegacyName("en")).toBe("remo");
    expect(brandLegacyName()).toBe("remo");
  });

  it("lets an installation's own name win over the brand", () => {
    expect(brandName({ locale: "ru", productName: "Acme Boards" })).toBe("Acme Boards");
    expect(brandName({ locale: "en", productName: "Acme Boards" })).toBe("Acme Boards");
    expect(brandName({ productName: "  Acme Boards  " })).toBe("Acme Boards");
  });

  it("ignores an empty or blank own name and falls back to the brand", () => {
    expect(brandName({ locale: "en", productName: "" })).toBe("Remuka");
    expect(brandName({ locale: "ru", productName: "   " })).toBe("Ремука");
    expect(brandName({ productName: null })).toBe("Ремука");
  });
});

describe("the Russian cases of the public name", () => {
  it("declines the brand like a feminine noun", () => {
    expect(brandNameCase({ grammaticalCase: "nominative" })).toBe("Ремука");
    expect(brandNameCase({ grammaticalCase: "genitive" })).toBe("Ремуки");
    expect(brandNameCase({ grammaticalCase: "dative" })).toBe("Ремуке");
    expect(brandNameCase({ grammaticalCase: "accusative" })).toBe("Ремуку");
    expect(brandNameCase({ grammaticalCase: "instrumental" })).toBe("Ремукой");
    expect(brandNameCase({ grammaticalCase: "prepositional" })).toBe("Ремуке");
  });

  it("leaves English and an installation's own name unchanged", () => {
    expect(brandNameCase({ locale: "en", grammaticalCase: "genitive" })).toBe("Remuka");
    expect(brandNameCase({ grammaticalCase: "genitive", productName: "Acme Boards" })).toBe(
      "Acme Boards",
    );
  });

  it("falls back to the nominative for an unknown case", () => {
    expect(brandNameCase({ grammaticalCase: "locative" })).toBe("Ремука");
  });
});

describe("the cloud's addresses", () => {
  it("lists every host the product is reachable on", () => {
    expect(BRAND.domains).toEqual({
      app: "app.remuka.com",
      docs: "docs.remuka.com",
      site: "remuka.com",
      siteRu: "remuka.ru",
      support: "support.remuka.com",
      status: "status.remuka.com",
      mail: "mail.remuka.com",
    });
  });

  it("keeps `remo` as the code name and the pronunciation fixed", () => {
    expect(BRAND.code).toBe("remo");
    expect(BRAND.pronunciation).toEqual({ ru: "ремУка", en: "reh-MOO-kah" });
  });

  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(BRAND)).toBe(true);
    expect(Object.isFrozen(BRAND.domains)).toBe(true);
    expect(Object.isFrozen(BRAND.name)).toBe(true);
  });
});
