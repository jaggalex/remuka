import { describe, expect, it } from "vitest";
import { withDocsOrigin } from "./helpDocs";

/**
 * The in-app help names the guide with `{{docs}}`, because the host belongs to the
 * installation (ADR-284). With a guide the token becomes its address; without one the
 * sentence keeps its words and loses the link.
 */
const PAGE =
  '<p>Полное руководство: <a href="{{docs}}/guide/ru/overview/index.html">руководство Ремуки</a>.</p>';
const ORIGIN = "https://docs.example.com";

describe("withDocsOrigin", () => {
  it("puts the installation's guide into the link", () => {
    expect(withDocsOrigin(PAGE, ORIGIN)).toBe(
      '<p>Полное руководство: <a href="https://docs.example.com/guide/ru/overview/index.html">руководство Ремуки</a>.</p>',
    );
  });

  it("keeps the words and drops the anchor when there is no guide", () => {
    const html = withDocsOrigin(PAGE, null);
    expect(html).toBe("<p>Полное руководство: руководство Ремуки.</p>");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("{{docs}}");
  });

  it("leaves a page without the token untouched", () => {
    const page = "<p>Просто текст и <a href=\"https://example.com\">ссылка</a>.</p>";
    expect(withDocsOrigin(page, ORIGIN)).toBe(page);
    expect(withDocsOrigin(page, null)).toBe(page);
  });
});
