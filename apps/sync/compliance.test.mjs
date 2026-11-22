import { describe, expect, it, vi } from "vitest";
import { abuseContact, cookiePolicyUrl, resolveCompliance, warnCompliance } from "./compliance.mjs";

describe("the complaint address of an installation (ADR-259 §4)", () => {
  it("follows the zone and can be set by a self-host", () => {
    expect(abuseContact({ REMO_COMPLIANCE_ZONE: "ru" })).toBe("abuse@remuka.ru");
    expect(abuseContact({ REMO_COMPLIANCE_ZONE: "eu" })).toBe("abuse@remuka.com");
    expect(abuseContact({ REMO_CONTACT_ABUSE: "abuse@example.test" })).toBe(
      "abuse@example.test",
    );
    expect(abuseContact({})).toBeNull();
  });

  it("drops a malformed override rather than inventing an address", () => {
    expect(abuseContact({ REMO_CONTACT_ABUSE: "not an address" })).toBeNull();
  });
});

describe("the compliance zone of an installation (ADR-255 §3)", () => {
  it("reads the zone and keeps the policy link of a zone that has one", () => {
    for (const zone of ["eu", "ru"]) {
      expect(
        resolveCompliance({
          REMO_COMPLIANCE_ZONE: zone,
          REMO_COOKIE_POLICY_URL: `https://${zone}.example.com/legal/cookies`,
        }),
      ).toEqual({
        zone,
        policyUrl: `https://${zone}.example.com/legal/cookies`,
        personalDataConsentUrl: null,
      });
    }
  });

  it("defaults to none and publishes no policy link", () => {
    expect(resolveCompliance({})).toEqual({
      zone: "none",
      policyUrl: null,
      personalDataConsentUrl: null,
    });
    expect(resolveCompliance({ REMO_COMPLIANCE_ZONE: " " })).toEqual({
      zone: "none",
      policyUrl: null,
      personalDataConsentUrl: null,
    });
    // A link next to the default zone would have nothing to appear in.
    expect(
      resolveCompliance({
        REMO_COOKIE_POLICY_URL: "https://example.com/legal/cookies",
        REMO_PERSONAL_DATA_CONSENT_URL: "https://example.com/personal-data",
      }),
    ).toEqual({ zone: "none", policyUrl: null, personalDataConsentUrl: null });
  });

  it("drops a policy link that is not an absolute https address", () => {
    for (const value of [
      "http://example.com/legal/cookies",
      "/legal/cookies",
      "example.com/legal/cookies",
      "javascript:alert(1)",
      "https://",
      "",
    ]) {
      expect(cookiePolicyUrl(value), value).toBeNull();
      expect(
        resolveCompliance({ REMO_COMPLIANCE_ZONE: "eu", REMO_COOKIE_POLICY_URL: value }),
        value,
      ).toEqual({ zone: "eu", policyUrl: null, personalDataConsentUrl: null });
    }
  });

  it("publishes the personal-data consent link only in the zone that shows it", () => {
    const address = "https://remuka.ru/legal/personal-data";
    expect(
      resolveCompliance({
        REMO_COMPLIANCE_ZONE: "ru",
        REMO_PERSONAL_DATA_CONSENT_URL: address,
      }),
    ).toEqual({ zone: "ru", policyUrl: null, personalDataConsentUrl: address });

    // Not set: the zone keeps the field and answers null, so the interface shows no link.
    expect(
      resolveCompliance({ REMO_COMPLIANCE_ZONE: "ru", REMO_COOKIE_POLICY_URL: address })
        .personalDataConsentUrl,
    ).toBeNull();

    // The EU zone has no personal-data consent document, so a value there is not published.
    expect(
      resolveCompliance({
        REMO_COMPLIANCE_ZONE: "eu",
        REMO_PERSONAL_DATA_CONSENT_URL: address,
      }).personalDataConsentUrl,
    ).toBeNull();

    for (const value of ["http://remuka.ru/legal/personal-data", "/legal/personal-data", "javascript:alert(1)"]) {
      expect(
        resolveCompliance({
          REMO_COMPLIANCE_ZONE: "ru",
          REMO_PERSONAL_DATA_CONSENT_URL: value,
        }).personalDataConsentUrl,
        value,
      ).toBeNull();
    }
  });

  it("keeps a path, a query and a fragment but not credentials", () => {
    expect(cookiePolicyUrl(" https://example.com/legal/cookies?lang=ru#top ")).toBe(
      "https://example.com/legal/cookies?lang=ru#top",
    );
    expect(cookiePolicyUrl("https://user:pass@example.com/legal/cookies")).toBeNull();
  });

  it("refuses to start on a mistyped zone", () => {
    expect(() => resolveCompliance({ REMO_COMPLIANCE_ZONE: "euu" })).toThrow(
      /REMO_COMPLIANCE_ZONE must be one of eu, ru, none/,
    );
  });

  it("warns once for a link without a zone or a malformed link, and stays quiet otherwise", () => {
    const log = vi.fn();
    warnCompliance({}, log);
    warnCompliance(
      { REMO_COMPLIANCE_ZONE: "eu", REMO_COOKIE_POLICY_URL: "https://example.com/legal/cookies" },
      log,
    );
    expect(log).not.toHaveBeenCalled();

    warnCompliance({ REMO_COMPLIANCE_ZONE: "none", REMO_COOKIE_POLICY_URL: "https://example.com" }, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("REMO_COMPLIANCE_ZONE is none");

    warnCompliance({ REMO_COMPLIANCE_ZONE: "ru", REMO_COOKIE_POLICY_URL: "http://example.com" }, log);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain("absolute https");
  });

  it("warns about a personal-data link the zone cannot show or cannot use", () => {
    const log = vi.fn();
    warnCompliance(
      {
        REMO_COMPLIANCE_ZONE: "eu",
        REMO_PERSONAL_DATA_CONSENT_URL: "https://example.com/personal-data",
      },
      log,
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("personal-data consent link");

    warnCompliance(
      {
        REMO_COMPLIANCE_ZONE: "ru",
        REMO_PERSONAL_DATA_CONSENT_URL: "http://example.com/personal-data",
      },
      log,
    );
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1][0]).toContain("absolute https");

    warnCompliance(
      {
        REMO_COMPLIANCE_ZONE: "ru",
        REMO_PERSONAL_DATA_CONSENT_URL: "https://example.com/personal-data",
      },
      log,
    );
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a mistyped zone as a second warning", () => {
    const log = vi.fn();
    // The start already failed in `resolveCompliance`; the warning stays silent.
    warnCompliance({ REMO_COMPLIANCE_ZONE: "euu", REMO_COOKIE_POLICY_URL: "https://example.com" }, log);
    expect(log).not.toHaveBeenCalled();
  });
});
