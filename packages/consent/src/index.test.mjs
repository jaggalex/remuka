import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_RULES,
  STORAGE_REGISTRY,
  categoryCanBeDisabled,
  consentPolicy,
  defaultChoices,
  hasOptionalTracking,
  nameMatches,
  normalizeChoices,
  resolveConsentZone,
  showConsentBanner,
  showConsentNotice,
  validateRegistry,
  validateZonePolicies,
} from "./index.mjs";

const ZONES_FIXTURE = {
  eu: consentPolicy("eu"),
  ru: consentPolicy("ru"),
  none: consentPolicy("none"),
};

const ANALYTICS = Object.freeze({
  name: "analytics.example",
  kind: "third-party",
  category: "analytics",
  owner: "support",
  purpose: { ru: "Аналитика", en: "Analytics" },
  lifetime: "1 year",
});

describe("the storage registry (ADR-255 §2)", () => {
  it("has a valid record for every entry", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("covers every key the 0.8.0 code uses", () => {
    const names = STORAGE_REGISTRY.map((entry) => entry.name).sort();
    expect(names).toEqual(
      [
        "guide.theme",
        "remo.canvas.hint",
        "remo.identity",
        "remo.inspector",
        "remo.lang",
        "remo.legal.upcoming.*",
        "remo.moveBanner.dismissed",
        "remo.session",
        "remo.settings",
        "remo.theme",
        "remo.verifyBanner.*",
        "remo_consent",
        "remo_csrf",
        "remo_link_unlock",
        "remo_session",
        "remo_visitor",
        "support.remuka.com",
      ].sort(),
    );
  });

  it("classifies only necessary and preference storage today", () => {
    const categories = new Set(STORAGE_REGISTRY.map((entry) => entry.category));
    expect([...categories].sort()).toEqual(["necessary", "preferences"]);
    expect(hasOptionalTracking()).toBe(false);
  });

  it("keeps the consent cookie necessary and browser-readable", () => {
    const entry = STORAGE_REGISTRY.find((candidate) => candidate.name === "remo_consent");
    expect(entry).toMatchObject({
      kind: "cookie",
      category: "necessary",
      lifetime: "6 months (EU) / 12 months (Russia)",
      httpOnly: false,
    });
    expect(entry.purpose.ru).toBeTruthy();
    expect(entry.purpose.en).toBeTruthy();
  });

  it("keeps httpOnly only on cookies the app must not read", () => {
    const session = STORAGE_REGISTRY.find((entry) => entry.name === "remo_session");
    const csrf = STORAGE_REGISTRY.find((entry) => entry.name === "remo_csrf");
    expect(session.httpOnly).toBe(true);
    expect(csrf.httpOnly).toBe(false);
  });

  it("cannot be changed at runtime", () => {
    expect(Object.isFrozen(STORAGE_REGISTRY)).toBe(true);
    expect(Object.isFrozen(STORAGE_REGISTRY[0])).toBe(true);
    expect(Object.isFrozen(STORAGE_REGISTRY[0].purpose)).toBe(true);
    expect(Object.isFrozen(CATEGORY_RULES.necessary)).toBe(true);
  });

  it("rejects an unknown kind, category or owner", () => {
    const base = { ...STORAGE_REGISTRY[0] };
    expect(validateRegistry([{ ...base, category: "tracking" }])[0]).toContain("unknown category");
    expect(validateRegistry([{ ...base, kind: "cookieJar" }])[0]).toContain("unknown kind");
    expect(validateRegistry([{ ...base, owner: "intern" }])[0]).toContain("unknown owner");
  });

  it("rejects a missing purpose, a missing lifetime and a duplicate record", () => {
    const base = { ...STORAGE_REGISTRY[0] };
    expect(validateRegistry([{ ...base, purpose: { ru: "", en: "Keeps you signed in" } }])).toContain(
      "entry 1 (remo_session): purpose.ru is missing",
    );
    expect(validateRegistry([{ ...base, lifetime: "" }])[0]).toContain("lifetime is missing");
    expect(validateRegistry([base, { ...base }])[0]).toContain("duplicate cookie record");
  });

  it("rejects httpOnly on storage that is not a cookie", () => {
    const entry = STORAGE_REGISTRY.find((candidate) => candidate.kind === "localStorage");
    expect(validateRegistry([{ ...entry, httpOnly: true }])[0]).toContain(
      "httpOnly belongs to a cookie only",
    );
  });
});

describe("registry name patterns", () => {
  it("matches an exact key", () => {
    expect(nameMatches("remo.lang", "remo.lang")).toBe(true);
    expect(nameMatches("remo.lang", "remo.theme")).toBe(false);
  });

  it("matches a key the code builds at runtime", () => {
    expect(nameMatches("remo.verifyBanner.*", "remo.verifyBanner.user-1")).toBe(true);
    // The checker resolves the code's own template to the same shape.
    expect(nameMatches("remo.verifyBanner.*", "remo.verifyBanner.*")).toBe(true);
    expect(nameMatches("remo.verifyBanner.*", "remo.verifyBanner")).toBe(false);
  });
});

describe("the compliance zones (ADR-255 §3)", () => {
  it("defaults to none for a self-host installation", () => {
    expect(resolveConsentZone({})).toBe("none");
    expect(resolveConsentZone({ REMO_COMPLIANCE_ZONE: "" })).toBe("none");
    expect(resolveConsentZone({ REMO_COMPLIANCE_ZONE: "   " })).toBe("none");
  });

  it("reads eu and ru, ignoring case and surrounding space", () => {
    expect(resolveConsentZone({ REMO_COMPLIANCE_ZONE: "eu" })).toBe("eu");
    expect(resolveConsentZone({ REMO_COMPLIANCE_ZONE: " RU " })).toBe("ru");
    expect(resolveConsentZone({ REMO_COMPLIANCE_ZONE: "none" })).toBe("none");
  });

  it("refuses a mistyped zone instead of quietly turning the rules off", () => {
    expect(() => resolveConsentZone({ REMO_COMPLIANCE_ZONE: "euu" })).toThrow(
      /REMO_COMPLIANCE_ZONE must be one of eu, ru, none/,
    );
  });

  it("keeps the table of §3 in the data", () => {
    expect(consentPolicy("eu")).toMatchObject({
      noticeWhenNecessaryOnly: false,
      consentBannerWhenOptional: true,
      optionalTrackingEnabled: true,
      respectGlobalPrivacyControl: true,
      choiceTtlDays: 180,
      logConsentForSignedIn: true,
      personalDataConsentLink: false,
    });
    expect(consentPolicy("ru")).toMatchObject({
      noticeWhenNecessaryOnly: true,
      consentBannerWhenOptional: true,
      respectGlobalPrivacyControl: true,
      choiceTtlDays: 365,
      personalDataConsentLink: true,
    });
    expect(consentPolicy("none")).toMatchObject({
      noticeWhenNecessaryOnly: false,
      consentBannerWhenOptional: false,
      optionalTrackingEnabled: false,
      respectGlobalPrivacyControl: false,
      choiceTtlDays: null,
      logConsentForSignedIn: false,
    });
  });

  it("shows no banner while the registry has only necessary and preference storage", () => {
    expect(showConsentBanner("eu")).toBe(false);
    expect(showConsentBanner("ru")).toBe(false);
    expect(showConsentBanner("none")).toBe(false);
  });

  it("shows the one-line notice in Russia only, and drops it for analytics", () => {
    expect(showConsentNotice("ru")).toBe(true);
    expect(showConsentNotice("eu")).toBe(false);
    expect(showConsentNotice("none")).toBe(false);
    const withAnalytics = [...STORAGE_REGISTRY, ANALYTICS];
    expect(showConsentNotice("ru", withAnalytics)).toBe(false);
    expect(showConsentBanner("eu", withAnalytics)).toBe(true);
    expect(showConsentBanner("ru", withAnalytics)).toBe(true);
    expect(showConsentBanner("none", withAnalytics)).toBe(false);
  });

  it("has valid zone data", () => {
    expect(validateZonePolicies()).toEqual([]);
  });

  it("rejects a missing or unknown zone and a bad lifetime", () => {
    const eu = consentPolicy("eu");
    expect(validateZonePolicies({ eu })).toContain("zone ru: missing policy");
    expect(validateZonePolicies({ ...ZONES_FIXTURE, us: { ...eu, zone: "us" } })).toContain(
      'zone "us": unknown zone',
    );
    expect(
      validateZonePolicies({
        ...ZONES_FIXTURE,
        ru: { ...consentPolicy("ru"), choiceTtlDays: 0 },
      }),
    ).toContain("zone ru: choiceTtlDays must be a positive whole number of days or null");
  });

  it("throws on an unknown zone instead of guessing a policy", () => {
    expect(() => consentPolicy("us")).toThrow(/unknown compliance zone/);
  });
});

describe("a choice cannot switch necessary off (§1 rule 6, §3)", () => {
  it("marks necessary and preferences as not disableable", () => {
    expect(categoryCanBeDisabled("necessary")).toBe(false);
    // The person's own settings are necessary storage, never a question (§2, §6).
    expect(categoryCanBeDisabled("preferences")).toBe(false);
    expect(categoryCanBeDisabled("analytics")).toBe(true);
    expect(categoryCanBeDisabled("nonsense")).toBe(false);
  });

  it("starts every zone with necessary and preferences on and tracking off", () => {
    for (const zone of ["eu", "ru", "none"]) {
      expect(defaultChoices(zone)).toMatchObject({
        necessary: true,
        preferences: true,
        analytics: false,
        marketing: false,
      });
    }
  });

  it("ignores an attempt to turn necessary or preferences off", () => {
    expect(normalizeChoices("eu", { necessary: false }).necessary).toBe(true);
    expect(normalizeChoices("ru", { necessary: false, preferences: false })).toMatchObject({
      necessary: true,
      preferences: true,
    });
    expect(normalizeChoices("ru", { necessary: false, analytics: true })).toMatchObject({
      necessary: true,
      analytics: true,
    });
  });

  it("keeps optional tracking off in the none zone", () => {
    expect(normalizeChoices("none", { analytics: true, marketing: true })).toMatchObject({
      analytics: false,
      marketing: false,
      preferences: true,
    });
  });

  it("has the four categories of §2", () => {
    expect(CATEGORIES).toEqual(["necessary", "preferences", "analytics", "marketing"]);
  });
});
