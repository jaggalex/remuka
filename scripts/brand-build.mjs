#!/usr/bin/env node
/**
 * Builds every copy of the product mark from `docs/design/brand/` (ADR-272).
 *
 * The owner's drawing is the only picture. This script writes the app's served copies,
 * the generated `@remo/ui` geometry and the apple-touch-icon; the guide and the legal site
 * read the same source in their own build scripts. `pnpm brand:check` compares the result.
 *
 *   pnpm brand:build
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { APPLE_TOUCH, brandModule, readMark, ROOT, SERVED_MARKS, SMILE_DARK } from "./brand-source.mjs";

const require = createRequire(join(ROOT, "apps/sync/package.json"));
const sharp = require("sharp");

export const GENERATED_MODULE = join(ROOT, "packages/ui/src/brand/brandMark.generated.ts");
export const APPLE_TOUCH_APP = join(ROOT, "apps/web/public/apple-touch-icon.png");

/** The same paper as the dark smile; the icon keeps it in both themes. */
const PAPER = SMILE_DARK;
const APPLE_SIZE = 180;
/** A mark with one eighth of the canvas as breathing room on each side (spec §3.8). */
const APPLE_MARK = Math.round(APPLE_SIZE * 0.75);

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

/**
 * True when two pictures have the same size and no channel differs by more than one step.
 * libvips rounds anti-aliased edges differently from one version to the next (a Mac and a
 * Linux machine disagree on four bytes of the touch icon), so a byte comparison would make
 * every build on the other machine rewrite the file and fail the guide check.
 */
export async function samePicture(a, b) {
  const [x, y] = await Promise.all([a, b].map(p => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (x.info.width !== y.info.width || x.info.height !== y.info.height) return false;
  for (let i = 0; i < x.data.length; i++) if (Math.abs(x.data[i] - y.data[i]) > 1) return false;
  return true;
}

export async function buildBrand() {
  for (const [path, theme] of SERVED_MARKS) {
    write(join(ROOT, path), readMark(theme));
    console.log(`brand: ${path} ← docs/design/brand/remuka-mark${theme === "dark" ? "-dark" : ""}.svg`);
  }

  write(GENERATED_MODULE, brandModule());
  console.log("brand: packages/ui/src/brand/brandMark.generated.ts");

  const inset = Math.round((APPLE_SIZE - APPLE_MARK) / 2);
  const mark = await sharp(Buffer.from(readMark())).resize(APPLE_MARK, APPLE_MARK).png().toBuffer();
  const icon = await sharp({
    create: { width: APPLE_SIZE, height: APPLE_SIZE, channels: 4, background: PAPER },
  })
    .composite([{ input: mark, left: inset, top: inset }])
    .png()
    .toBuffer();
  const kept = existsSync(APPLE_TOUCH) && await samePicture(readFileSync(APPLE_TOUCH), icon);
  if (!kept) write(APPLE_TOUCH, icon);
  copyFileSync(APPLE_TOUCH, APPLE_TOUCH_APP);
  console.log(`brand: apple-touch-icon.png (${APPLE_SIZE}×${APPLE_SIZE}, ${PAPER})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildBrand();
}
