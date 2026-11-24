import { describe, expect, it } from "vitest";
import { BRAND } from "@remo/brand";
import { docsOriginValue, resolveDocsOrigin } from "./docs-origin.mjs";

/**
 * The guide of an installation (ADR-284).
 *
 * The build carries no guide host: `REMO_DOCS_ORIGIN` wins, otherwise the zone names the
 * cloud's guide, and a self-host without a zone gets nothing rather than somebody else's
 * documentation.
 */
const EU = `https://${BRAND.domains.docs}`;
const RU = `https://${BRAND.domains.docsRu}`;

describe("the guide origin of an installation", () => {
  it("follows the zone when the operator set nothing", () => {
    expect(resolveDocsOrigin({ REMO_COMPLIANCE_ZONE: "eu" })).toBe(EU);
    expect(resolveDocsOrigin({ REMO_COMPLIANCE_ZONE: "ru" })).toBe(RU);
  });

  it("has no guide on a self-host without a zone", () => {
    for (const env of [{}, { REMO_COMPLIANCE_ZONE: "none" }, { REMO_DOCS_ORIGIN: "  " }]) {
      expect(resolveDocsOrigin(env)).toBeNull();
    }
  });

  it("lets the operator's address win over the zone", () => {
    // The stand sets its own guide on top of a cloud zone, which is the whole point.
    expect(
      resolveDocsOrigin({
        REMO_COMPLIANCE_ZONE: "ru",
        REMO_DOCS_ORIGIN: "https://docs.stage.example",
      }),
    ).toBe("https://docs.stage.example");
    expect(
      resolveDocsOrigin({ REMO_DOCS_ORIGIN: "https://docs.example.com/" }),
    ).toBe("https://docs.example.com");
  });

  it("stops the start on an address that cannot be a guide", () => {
    for (const value of [
      "http://docs.example.com",
      "docs.example.com",
      "https://docs.example.com/guide",
      "https://docs.example.com/?x=1",
      "https://docs.example.com/#top",
      "https://user:pass@docs.example.com",
      "javascript:alert(1)",
    ]) {
      expect(() => resolveDocsOrigin({ REMO_DOCS_ORIGIN: value }), value).toThrow(
        /REMO_DOCS_ORIGIN/,
      );
    }
  });

  it("reads a usable origin and nothing else", () => {
    expect(docsOriginValue("https://docs.example.com")).toBe("https://docs.example.com");
    expect(docsOriginValue("https://docs.example.com:8443")).toBe(
      "https://docs.example.com:8443",
    );
    for (const value of [null, undefined, 42, "", "https://", "ftp://docs.example.com"]) {
      expect(docsOriginValue(value), String(value)).toBeNull();
    }
  });
});
