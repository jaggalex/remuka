import { describe, expect, it } from "vitest";
import { NO_COMPLIANCE, isComplianceZone, readCompliance } from "./compliance";

describe("the compliance field of /config (ADR-255 §3)", () => {
  it("carries the zone and the policy link to the context", () => {
    expect(readCompliance({ zone: "eu", policyUrl: "https://remuka.com/legal/cookies" })).toEqual({
      zone: "eu",
      policyUrl: "https://remuka.com/legal/cookies",
      personalDataConsentUrl: null,
    });
    expect(readCompliance({ zone: "ru", policyUrl: "https://remuka.ru/legal/cookies" })).toEqual({
      zone: "ru",
      policyUrl: "https://remuka.ru/legal/cookies",
      personalDataConsentUrl: null,
    });
    expect(readCompliance({ zone: "eu", policyUrl: null })).toEqual({
      zone: "eu",
      policyUrl: null,
      personalDataConsentUrl: null,
    });
  });

  it("keeps the personal-data consent link when the zone publishes one", () => {
    expect(
      readCompliance({
        zone: "ru",
        policyUrl: "https://remuka.ru/legal/cookies",
        personalDataConsentUrl: "https://remuka.ru/legal/personal-data",
      }),
    ).toEqual({
      zone: "ru",
      policyUrl: "https://remuka.ru/legal/cookies",
      personalDataConsentUrl: "https://remuka.ru/legal/personal-data",
    });
    // A service that predates the field answers nothing: no link, no error.
    expect(readCompliance({ zone: "ru" }).personalDataConsentUrl).toBeNull();
    for (const value of ["javascript:alert(1)", "http://remuka.ru/pd", "/personal-data", 42]) {
      expect(
        readCompliance({ zone: "ru", personalDataConsentUrl: value }).personalDataConsentUrl,
        String(value),
      ).toBeNull();
    }
  });

  it("reads a missing field, an older service or the none zone as the safe default", () => {
    for (const value of [
      undefined,
      null,
      {},
      "eu",
      { zone: "us" },
      { zone: "EU", policyUrl: "https://example.com" },
      { zone: "none", policyUrl: "https://example.com/legal/cookies" },
      {
        zone: "none",
        policyUrl: null,
        personalDataConsentUrl: "https://example.com/personal-data",
      },
    ]) {
      expect(readCompliance(value), JSON.stringify(value)).toEqual(NO_COMPLIANCE);
    }
    expect(NO_COMPLIANCE).toEqual({
      zone: "none",
      policyUrl: null,
      personalDataConsentUrl: null,
    });
  });

  it("drops a policy link that is not an absolute https address", () => {
    for (const policyUrl of [
      "javascript:alert(1)",
      "http://remuka.com/legal/cookies",
      "/legal/cookies",
      42,
      null,
    ]) {
      expect(readCompliance({ zone: "eu", policyUrl }), String(policyUrl)).toEqual({
        zone: "eu",
        policyUrl: null,
        personalDataConsentUrl: null,
      });
    }
  });

  it("recognises exactly the zones the service accepts", () => {
    for (const zone of ["eu", "ru", "none"]) expect(isComplianceZone(zone)).toBe(true);
    for (const zone of ["EU", "com", "", null, undefined]) expect(isComplianceZone(zone)).toBe(false);
  });
});
