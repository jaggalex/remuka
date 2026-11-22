import { beforeAll, describe, expect, it } from "vitest";

/**
 * The About label is the public name plus the build identity (ADR-254, §4.1).
 *
 * `about.ts` reads the constants Vite injects at build time, so the globals are set
 * before the module is imported; a static import would evaluate it too early.
 */
let about: typeof import("./about");

beforeAll(async () => {
  const globals = globalThis as unknown as Record<string, string>;
  globals.__REMO_VERSION__ = "0.8.0";
  globals.__REMO_BUILD__ = "1247";
  globals.__REMO_COMMIT__ = "a1b2c3d";
  about = await import("./about");
});

describe("the About label", () => {
  it("shows the brand name in the interface language", () => {
    expect(about.aboutLabel("ru")).toBe("Ремука 0.8.0 · 1247");
    expect(about.aboutLabel("en")).toBe("Remuka 0.8.0 · 1247");
  });

  it("shows an installation's own name when the service supplies one", () => {
    expect(about.aboutLabel("ru", "Acme Boards")).toBe("Acme Boards 0.8.0 · 1247");
  });

  it("takes the homepage from the brand, not from a literal", () => {
    expect(about.ABOUT.homepage).toBe("https://remuka.com");
  });

  it("keeps the old name available for the history line only", () => {
    expect(about.ABOUT.legacy).toEqual({ ru: "remo", en: "remo" });
  });
});
