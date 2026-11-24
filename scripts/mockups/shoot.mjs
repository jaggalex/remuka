#!/usr/bin/env node
/**
 * Reference PNGs of the mockups (ADR-281, ADR-282).
 *
 *   node scripts/mockups/shoot.mjs [Artboard …] [--widths=1440,390]
 *
 * Renders every artboard source in docs/design/mockups/ offline with dc-lite.js, puts it in
 * each state from states.json and writes
 * docs/design/reference/<Artboard>/<state>-<width>.png plus docs/design/reference/index.json.
 * Fonts come from packages/ui/src/fonts (no network). Reduced motion is on, so screenshots
 * show the end state of entrance animations.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const mockups = join(root, "docs/design/mockups");
const outRoot = join(root, "docs/design/reference");
const tmp = join(root, "node_modules/.cache/mockup-shots");
mkdirSync(tmp, { recursive: true });

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith("--"));
const widthsArg = args.find((a) => a.startsWith("--widths="));
const widths = widthsArg ? widthsArg.slice(9).split(",").map(Number) : [1440, 390];

const index = JSON.parse(readFileSync(join(mockups, "index.json"), "utf8"));
const states = JSON.parse(readFileSync(join(here, "states.json"), "utf8"));
const runtime = readFileSync(join(here, "dc-lite.js"), "utf8");
const fonts = join(root, "packages/ui/src/fonts");

const fontFace = `
@font-face{font-family:'Golos Text';font-style:normal;font-weight:400 900;font-display:block;
  src:url('file://${fonts}/golos-text-cyrillic-wght-normal.woff2') format('woff2');
  unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116;}
@font-face{font-family:'Golos Text';font-style:normal;font-weight:400 900;font-display:block;
  src:url('file://${fonts}/golos-text-latin-wght-normal.woff2') format('woff2');
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}`;

function page(source) {
  const helmet = (source.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ""])[1]
    .replace(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g, "");
  const body = (source.match(/<x-dc>([\s\S]*?)<\/x-dc>/) || [, ""])[1]
    .replace(/<helmet>[\s\S]*?<\/helmet>/, "")
    .replace(/<sc-for\b/g, '<template data-sc="for"').replace(/<\/sc-for>/g, "</template>")
    .replace(/<sc-if\b/g, '<template data-sc="if"').replace(/<\/sc-if>/g, "</template>");
  const script = (source.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/) || [, ""])[1];
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fontFace}</style>${helmet}</head>
<body><div id="dc-root"></div>
<script>${runtime}</script>
<script>${script}
window.__dcBoot(Component, ${JSON.stringify(body)});</script></body></html>`;
}

const browser = await chromium.launch();
const manifest = { generatedAt: new Date().toISOString(), exportedFromVersion: index.exportedFromVersion, artboards: {} };
let shots = 0;
for (const board of index.artboards) {
  if (only.length && !only.includes(board.artboard)) continue;
  const file = join(mockups, `${board.artboard}.dc.html`);
  if (!existsSync(file)) continue;
  const html = join(tmp, `${board.artboard}.html`);
  writeFileSync(html, page(readFileSync(file, "utf8")));
  const list = states[board.artboard] || [["default", {}]];
  const dir = join(outRoot, board.artboard);
  mkdirSync(dir, { recursive: true });
  manifest.artboards[board.artboard] = { tasks: board.tasks, adr: board.adr, source: board.file, shots: [] };
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const tab = await context.newPage();
    const errors = [];
    tab.on("pageerror", (e) => errors.push(String(e)));
    for (const [name, patch] of list) {
      await tab.goto(`file://${html}`);
      await tab.evaluate(() => document.fonts.ready);
      if (Object.keys(patch).length) await tab.evaluate((p) => window.__dc.setState(p), patch);
      await tab.waitForTimeout(150);
      const out = join(dir, `${name}-${width}.png`);
      await tab.screenshot({ path: out, fullPage: true });
      manifest.artboards[board.artboard].shots.push(`docs/design/reference/${board.artboard}/${name}-${width}.png`);
      shots += 1;
    }
    if (errors.length) console.warn(`${board.artboard} @${width}: ${errors.slice(0, 3).join(" | ")}`);
    await context.close();
  }
  console.log(`${board.artboard}: ${list.length} states × ${widths.length} widths`);
}
await browser.close();
if (!only.length) writeFileSync(join(outRoot, "index.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`done: ${shots} PNG`);
