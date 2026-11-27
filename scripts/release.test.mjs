import { describe, expect, it } from "vitest";
import { releaseChangelog } from "./release.mjs";

const CLOSING = "Release notes for a version are written from that page; the ADR records the reasons.";

describe("the release changelog", () => {
  it("files the unreleased entries under the new version and names it in the header", () => {
    const text = `Ремука (Remuka) is at **0.8.0**. History.\n\n## [Unreleased]\n\n**Objects turn.** A shape turns.\n\n## [0.8.0] - 2026-11-22\n\nOld.\n\n${CLOSING}\n`;
    const out = releaseChangelog(text, "0.9.0", "2026-11-27", "UI release.");
    expect(out).toContain("is at **0.9.0**.");
    expect(out).toContain("## [Unreleased]\n\n## [0.9.0] - 2026-11-27\n\nUI release.\n\n**Objects turn.**");
    expect(out.match(/## \[0\.9\.0\]/g)).toHaveLength(1);
  });
  it("keeps the closing line as the anchor when nothing is unreleased", () => {
    const text = `Remuka is at **0.9.0**.\n\n## [Unreleased]\n\n## [0.9.0] - 2026-11-27\n\nUI.\n\n${CLOSING}\n`;
    const out = releaseChangelog(text, "0.9.1", "2026-11-30");
    expect(out).toContain(`## [0.9.1] - 2026-11-30\n\nSee the product guide changelog for the user-facing history.\n\n${CLOSING}`);
  });
  it("does nothing twice", () => {
    const text = `Remuka is at **0.9.0**.\n\n## [Unreleased]\n\n## [0.9.0] - 2026-11-27\n\nUI.\n\n${CLOSING}\n`;
    expect(releaseChangelog(text, "0.9.0", "2026-11-27")).toBe(text);
  });
});
