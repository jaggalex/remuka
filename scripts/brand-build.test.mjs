import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";
import { samePicture } from "./brand-build.mjs";
import { ROOT } from "./brand-source.mjs";

const sharp = createRequire(join(ROOT, "apps/sync/package.json"))("sharp");
const square = (r, size = 4) => sharp({ create: { width: size, height: size, channels: 4, background: { r, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();

describe("the touch icon is rewritten only when the picture changes", () => {
  it("treats a one-step rounding difference as the same picture", async () => {
    expect(await samePicture(await square(100), await square(101))).toBe(true);
  });
  it("sees a real change of colour or size", async () => {
    expect(await samePicture(await square(100), await square(103))).toBe(false);
    expect(await samePicture(await square(100), await square(100, 5))).toBe(false);
  });
});
