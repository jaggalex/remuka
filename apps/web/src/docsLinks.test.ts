import { describe, expect, it } from "vitest";
import { docsHref, readDocsOrigin } from "./docsLinks";

/**
 * The guide's address from `/config` (ADR-284). A broken or unknown answer means "no
 * guide", never a link to another installation.
 */
describe("readDocsOrigin", () => {
  it("keeps an absolute https origin", () => {
    expect(readDocsOrigin({ origin: "https://docs.example.com" })).toBe(
      "https://docs.example.com",
    );
    expect(readDocsOrigin({ origin: "https://docs.example.com/" })).toBe(
      "https://docs.example.com",
    );
    expect(readDocsOrigin({ origin: "https://docs.example.com:8443" })).toBe(
      "https://docs.example.com:8443",
    );
  });

  it("answers null when the installation has no guide", () => {
    for (const value of [undefined, null, {}, { origin: null }, { origin: "" }, "https://x"]) {
      expect(readDocsOrigin(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("refuses anything that is not a bare https origin", () => {
    for (const origin of [
      "http://docs.example.com",
      "javascript:alert(1)",
      "docs.example.com",
      "https://docs.example.com/guide",
      "https://docs.example.com/?x=1",
      "https://docs.example.com/#top",
      "https://user:pass@docs.example.com",
    ]) {
      expect(readDocsOrigin({ origin }), origin).toBeNull();
    }
  });
});

describe("docsHref", () => {
  it("joins the origin and the path with one slash", () => {
    expect(docsHref("https://docs.example.com", "/guide/ru/overview/index.html")).toBe(
      "https://docs.example.com/guide/ru/overview/index.html",
    );
    expect(docsHref("https://docs.example.com", "guide/ru/overview/index.html")).toBe(
      "https://docs.example.com/guide/ru/overview/index.html",
    );
    expect(docsHref("https://docs.example.com/", "/guide/")).toBe(
      "https://docs.example.com/guide/",
    );
  });

  it("has no link when the installation has no guide", () => {
    expect(docsHref(null, "/guide/ru/support/disclaimer.html")).toBeNull();
  });
});
