import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SHAPE_INK, SHAPE_PAPER } from "./shapeFill";

const TOKENS = fileURLToPath(new URL("../../ui/src/tokens/tokens.json", import.meta.url));

/** The token a new shape's paint is copied from (ADR-267). */
const TOKEN_NAMES = {
  paper: "paper-cream-25",
  ink: "neutral-900",
} as const;

describe("shape paint (ADR-267)", () => {
  it("is warm paper, not a plain white rectangle", () => {
    expect(SHAPE_PAPER).toBe("#fffdf8");
    expect(SHAPE_INK).toBe("#1e2136");
  });

  it("is the design system's primitive, not a second palette", () => {
    const tokens = JSON.parse(readFileSync(TOKENS, "utf8")) as {
      color: { tokens: Array<{ name: string; value: unknown; layer: string }> };
    };
    const primitives = new Map(
      tokens.color.tokens
        .filter((token) => token.layer === "primitive")
        .map((token) => [token.name, token.value]),
    );
    expect(primitives.get(TOKEN_NAMES.paper)).toBe(SHAPE_PAPER);
    expect(primitives.get(TOKEN_NAMES.ink)).toBe(SHAPE_INK);
  });
});
