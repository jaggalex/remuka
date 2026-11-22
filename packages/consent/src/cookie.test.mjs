import { describe, expect, it } from "vitest";
import {
  CONSENT_CHOICE_CATEGORIES,
  CONSENT_COOKIE,
  POLICY_VERSION,
  consentCookieExpiresAt,
  consentCookieMaxAge,
  encodeConsentValue,
  isPolicyVersion,
  parseConsentValue,
} from "./index.mjs";

describe("the remo_consent value (ADR-255 §4)", () => {
  it("is v1.<zone>.<policyVersion>.<choices>, with no person and no time", () => {
    expect(CONSENT_COOKIE).toBe("remo_consent");
    expect(encodeConsentValue({ zone: "eu", choices: {} })).toBe(`v1.eu.${POLICY_VERSION}.-`);
    expect(encodeConsentValue({ zone: "eu", choices: { analytics: true } })).toBe(
      `v1.eu.${POLICY_VERSION}.a`,
    );
    expect(encodeConsentValue({ zone: "ru", choices: { marketing: true } })).toBe(
      `v1.ru.${POLICY_VERSION}.m`,
    );
    expect(
      encodeConsentValue({ zone: "eu", choices: { analytics: true, marketing: true } }),
    ).toBe(`v1.eu.${POLICY_VERSION}.am`);
  });

  it("never writes necessary or preferences into the value", () => {
    const value = encodeConsentValue({
      zone: "eu",
      choices: { necessary: true, preferences: true },
    });
    expect(value.endsWith(".-")).toBe(true);
    expect(CONSENT_CHOICE_CATEGORIES).toEqual(["analytics", "marketing"]);
  });

  it("round-trips a value and rejects one from another deployment", () => {
    const value = encodeConsentValue({
      zone: "ru",
      policyVersion: "2026-12",
      choices: { analytics: true, marketing: true },
    });
    expect(parseConsentValue(value)).toEqual({
      version: "v1",
      zone: "ru",
      policyVersion: "2026-12",
      choices: { analytics: true, marketing: true },
    });
  });

  it("rejects a corrupt, truncated or foreign-zone value instead of guessing", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "v2.eu.2026-11.a",
      "v1.none.2026-11.-",
      "v1.us.2026-11.-",
      "v1.eu.2026-11",
      "v1.eu.2026-11.",
      "v1.eu.2026-11.aa",
      "v1.eu.2026-11.x",
      "v1.eu.2026.11.-",
      "v1.eu.2026-11.-.",
      "1.eu.2026-11.-",
    ]) {
      expect(parseConsentValue(raw), String(raw)).toBeNull();
    }
  });

  it("refuses to encode a zone without a consent mechanism", () => {
    expect(() => encodeConsentValue({ zone: "none" })).toThrow(/eu and ru/);
    expect(() => encodeConsentValue({ zone: "us" })).toThrow(/eu and ru/);
    expect(() => encodeConsentValue({ zone: "eu", policyVersion: "2026.11" })).toThrow(
      /bad consent policy version/,
    );
  });

  it("keeps the policy edition one dot-free token", () => {
    expect(isPolicyVersion(POLICY_VERSION)).toBe(true);
    expect(POLICY_VERSION).not.toContain(".");
    expect(isPolicyVersion("2026.11")).toBe(false);
    expect(isPolicyVersion("")).toBe(false);
    expect(isPolicyVersion(" a")).toBe(false);
  });
});

describe("the lifetime of a choice (§3)", () => {
  it("is six months in the EU and twelve in Russia, never for none", () => {
    expect(consentCookieMaxAge("eu")).toBe(180 * 24 * 60 * 60);
    expect(consentCookieMaxAge("ru")).toBe(365 * 24 * 60 * 60);
    expect(consentCookieMaxAge("none")).toBeNull();
  });

  it("answers the expiry the API returns", () => {
    const now = Date.UTC(2026, 10, 22, 12, 0, 0);
    expect(consentCookieExpiresAt("eu", now)).toBe("2027-05-21T12:00:00.000Z");
    expect(consentCookieExpiresAt("ru", now)).toBe("2027-11-22T12:00:00.000Z");
    expect(consentCookieExpiresAt("none", now)).toBeNull();
  });
});
