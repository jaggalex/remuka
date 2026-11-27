import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FRAME_BODY_ALPHA,
  INK_HALO_FLOOR,
  INK_LADDER,
  LINE_CONTRAST,
  PAPER_LADDER,
  autoInk,
  composite,
  contrastRatio,
  groundOf,
  ink,
  inkFor,
  mix,
} from "./ink";

const TOKENS = fileURLToPath(new URL("../../ui/src/tokens/tokens.json", import.meta.url));

/** The primitives the two ladders are copied from (ADR-273 §2.2). */
function token(name: string): string {
  const table = JSON.parse(readFileSync(TOKENS, "utf8")) as {
    color?: { tokens?: Array<{ name: string; value: unknown; layer?: string }> };
  };
  const found = (table.color?.tokens ?? []).find(
    (entry) => entry.name === name && entry.layer === "primitive",
  );
  if (!found || typeof found.value !== "string") throw new Error(`no primitive ${name}`);
  return found.value;
}

describe("groundOf (ADR-273 §2.1)", () => {
  it("takes the object's own fill first", () => {
    expect(groundOf({ fill: "#f4e0a8", container: "#c8e8d4", canvas: "#fbf3df" })).toBe("#f4e0a8");
  });

  it("falls through a transparent fill to the container", () => {
    expect(groundOf({ fill: "transparent", container: "#c8e8d4", canvas: "#fbf3df" })).toBe(
      "#c8e8d4",
    );
    expect(groundOf({ fill: null, canvas: "#1e2136" })).toBe("#1e2136");
  });

  it("mixes a frame body over the canvas, so it follows the theme", () => {
    const light = groundOf({
      container: "#fffdf8",
      containerAlpha: FRAME_BODY_ALPHA,
      canvas: "#fbf3df",
    });
    const dark = groundOf({
      container: "#fffdf8",
      containerAlpha: FRAME_BODY_ALPHA,
      canvas: "#1e2136",
    });
    expect(light).not.toBe("#fffdf8");
    expect(dark).not.toBe(light);
    expect(contrastRatio(light, "#fbf3df")).toBeLessThan(1.2);
  });

  it("mixes a translucent fill over its container, not over the canvas", () => {
    expect(mix("#ffdd33", 0.22, "#c8e8d4")).toBe(groundOf({ fill: "#ffdd33", fillAlpha: 0.22, container: "#c8e8d4", canvas: "#1e2136" }));
  });
});

describe("the ladders are the design system's primitives", () => {
  it("pins ink, graphite and the paper scale", () => {
    expect(INK_LADDER[0]).toBe(token("neutral-900"));
    expect(INK_LADDER[1]).toBe(token("neutral-700"));
    expect(PAPER_LADDER[0]).toBe(token("paper-cream-50"));
    expect(PAPER_LADDER[1]).toBe(token("paper-cream-300"));
    expect(PAPER_LADDER[2]).toBe(token("paper-cream-500"));
  });
});

describe("ink (ADR-273 §2.2)", () => {
  it("writes ink on light paper and paper on the dark canvas", () => {
    expect(ink("#fbf3df", "text")).toBe("#1e2136");
    expect(ink("#c8e8d4", "text")).toBe("#1e2136");
    expect(ink("#1e2136", "text")).toBe("#fbf3df");
  });

  it("keeps a hairline inside its band on both kinds of ground", () => {
    for (const ground of ["#fbf3df", "#c8e8d4", "#ff8a57", "#1e2136", "#58534e"]) {
      const line = ink(ground, "line");
      expect(line, ground).toMatch(/^rgba\(/);
      const ratio = contrastRatio(line, ground);
      expect(ratio, ground).toBeGreaterThanOrEqual(LINE_CONTRAST.min);
      expect(ratio, ground).toBeLessThanOrEqual(LINE_CONTRAST.max);
    }
  });

  it("asks a strong line for 3:1 and an icon for 3:1, not for text's 4.5", () => {
    // Grey 600 is a deep ground: ink is only 2.08:1 there, so both take paper, but the
    // icon role is allowed to stop earlier than text (ADR-273 §2.2).
    expect(contrastRatio(ink("#58534e", "icon"), "#58534e")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ink("#58534e", "lineStrong"), "#58534e")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ink("#58534e", "text"), "#58534e")).toBeGreaterThanOrEqual(4.5);
  });

  it("caches by ground and role: the same answer is the same string", () => {
    expect(ink("#c8e8d4", "line")).toBe(ink("#c8e8d4", "line"));
    expect(ink("#c8e8d4", "line")).not.toBe(ink("#c8e8d4", "lineStrong"));
  });
});

describe("a colour the person chose (ADR-273 §2.3)", () => {
  it("reads the old defaults as Auto and keeps every other value", () => {
    expect(autoInk("#58534e")).toBeUndefined();
    expect(autoInk("#1A1A1A")).toBeUndefined();
    expect(autoInk("#1e2136")).toBeUndefined();
    expect(autoInk("#595959")).toBeUndefined();
    expect(autoInk("#ff0000")).toBe("#ff0000");
    expect(autoInk("#f00")).toBe("#f00");
    expect(autoInk(undefined)).toBeUndefined();
    expect(autoInk(null)).toBeUndefined();
  });

  it("paints Auto from the ground, not from the document", () => {
    expect(inkFor("#1e2136").color).toBe(ink("#1e2136", "text"));
    expect(inkFor("#fbf3df", "#58534e").color).toBe(ink("#fbf3df", "text"));
    expect(inkFor("#fbf3df", "#58534e").halo).toBeNull();
  });

  it("keeps an explicit colour and gives it a halo only under 2:1", () => {
    const black = inkFor("#1e2136", "#000000");
    expect(black.color).toBe("#000000");
    expect(black.halo).toBe(ink("#1e2136", "text"));

    const red = inkFor("#fbf3df", "#cc0000");
    expect(red.color).toBe("#cc0000");
    expect(contrastRatio("#cc0000", "#fbf3df")).toBeGreaterThanOrEqual(INK_HALO_FLOOR);
    expect(red.halo).toBeNull();
  });

  it("leaves a line alone: a hairline with a halo would double its weight", () => {
    const chosen = inkFor("#1e2136", "#000000", "lineStrong");
    expect(chosen.color).toBe("#000000");
    expect(chosen.halo).toBeNull();
  });
});

describe("colour arithmetic", () => {
  it("reads a translucent colour over the ground it is painted on", () => {
    expect(composite("rgba(30, 33, 54, 0.5)", "#ffffff")).toBe(mix("#1e2136", 0.5, "#ffffff"));
  });

  it("has the contrast a check can trust", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});
