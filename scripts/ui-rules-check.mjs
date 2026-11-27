#!/usr/bin/env node
/**
 * The UI rules the stylesheet cannot state about itself (ADR-079, ADR-134, ADR-139).
 *
 * `apps/web/src/styles.test.ts` already fails any literal colour inside the product CSS.
 * Components had no such guard: twenty `?? "#ffffff"` / `?? "#1a1a1a"` fallbacks lived in
 * ten files, so a literal could not be told apart from data. The defaults now live in
 * `objectDefaults.ts` and the data modules below are named, so any other literal is a
 * mistake the gate can point at.
 *
 * The same rule applies to layers: a panel names `--z-*`, never a number. The ladder is
 * one primitive series, not a light/dark pair, so both themes share the order (ADR-139).
 *
 * Design rules (type, spacing, radius, motion, colour roles, DS controls, modal dialogs,
 * icons) are a strict gate with named exceptions: see `ui-design-rules.mjs` (ADR-229).
 *
 *   node scripts/ui-rules-check.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PENDING, scanDesignRules, strictProblems } from "./ui-design-rules.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SCAN = join(ROOT, "apps/web/src");
const STYLES = join(SCAN, "styles");
const TOKENS = join(ROOT, "packages/ui/src/tokens");

/** The six rungs of the layer ladder, bottom to top (ADR-139, DS §18). */
const LAYERS = [
  "z-canvas",
  "z-canvas-overlay",
  "z-bar",
  "z-popover",
  "z-dialog",
  "z-toast",
];

/** Files where a colour literal is data, not a style: the value itself is the content. */
const ALLOWED = new Set([
  "apps/web/src/objectDefaults.ts", // the one place a default paint value lives
  "apps/web/src/identity.ts", // the presence palette: seven fixed identity colours
  "apps/web/src/settings.ts", // legacy default detection when migrating a stored style
  "apps/web/src/object-panel/colorWindowData.ts", // the colour window's own data
]);

const SOURCE = /\.(ts|tsx)$/;
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/gi;

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
}

const problems = [];

/**
 * Layers are a named ladder, not numbers in components (ADR-139).
 *
 * The primitive token file is the one place a rung has a value; a product rule that says
 * `z-index: 16` is how the comment pins ended up over an open panel. The values must be
 * strictly ascending and absent from the theme files, so one theme cannot reorder them.
 */
function layerProblems() {
  const found = [];
  const primitive = readFileSync(join(TOKENS, "primitive.css"), "utf8");
  const ladder = [...primitive.matchAll(/--z-([a-z-]+):\s*(\d+);/g)].map((match) => ({
    name: `z-${match[1]}`,
    value: Number(match[2]),
  }));
  const names = ladder.map((row) => row.name);
  if (names.join(",") !== LAYERS.join(",")) {
    found.push(`tokens: layer ladder is ${names.join(" → ") || "(empty)"}, expected ${LAYERS.join(" → ")}`);
  } else {
    ladder.forEach((row, index) => {
      if (index > 0 && row.value <= ladder[index - 1].value) {
        found.push(`tokens: ${row.name} (${row.value}) must be above ${ladder[index - 1].name} (${ladder[index - 1].value})`);
      }
    });
  }
  for (const file of readdirSync(join(TOKENS, "themes"))) {
    if (!file.endsWith(".css")) continue;
    const text = readFileSync(join(TOKENS, "themes", file), "utf8");
    for (const match of text.matchAll(/--(z-[a-z-]+)\s*:/g)) {
      found.push(`tokens/themes/${file}: ${match[1]} is themed; layers are one primitive series`);
    }
  }
  for (const file of readdirSync(STYLES).filter((name) => name.endsWith(".css"))) {
    const text = readFileSync(join(STYLES, file), "utf8");
    for (const match of text.matchAll(/z-index:\s*([^;]+);/g)) {
      const value = match[1].trim();
      if (!/^var\(--z-[a-z-]+\)$/.test(value)) {
        found.push(`apps/web/src/styles/${file}: z-index ${value} — name a --z-* layer`);
      }
    }
  }
  return found;
}

for (const file of walk(SCAN)) {
  const path = relative(ROOT, file);
  if (path.includes(".test.") || ALLOWED.has(path)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // A comment may quote a value while explaining it; code may not.
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    if (!/^\s*\*/.test(line) && LITERAL.test(code)) {
      problems.push(`${path}:${index + 1}: ${line.trim()}`);
    }
    LITERAL.lastIndex = 0;
  });
}

/**
 * Canvas content takes its ink from its ground, never from the theme (ADR-273 §3.3).
 *
 * A painter or a DOM field over the canvas that reads `--text-*` or `--border-*` is the
 * exact defect ADR-273 removes: in the dark theme it turns light text onto a light
 * document fill and a heavy dark grid onto pale paper. Exceptions must be named here with
 * a reason, as everywhere else in this file.
 */
const CANVAS_LAYER_EXCEPTIONS = new Map([
  // None: every layer over the canvas derives its ink from `groundOf` + `ink`.
]);

/** The DOM layers that paint directly over the canvas (ADR-273 §2.4). */
/** A colour literal that is data: the default palette for tests and token-less paints. */
const CANVAS_LITERAL_FILES = new Set(["packages/canvas/src/palette.ts"]);

const CANVAS_LAYER_FILES = new Set([
  "apps/web/src/InlineEditor.tsx",
  "apps/web/src/TableHeaderLayer.tsx",
  "apps/web/src/SectionTitleLayer.tsx",
  "apps/web/src/CanvasTableLayer.tsx",
  "apps/web/src/KanbanTitleEditor.tsx",
]);

/** The stylesheet selectors those layers use; other blocks in the same file are chrome. */
const CANVAS_SELECTORS = [".inline-editor", ".table-header-editor", ".kanban-title-editor", ".section-title"];

/**
 * A focus ring is chrome, not content: it is the one border a canvas layer may name, and
 * it is the same ring as on every control around the canvas (ADR-229).
 */
const THEME_INK = /var\(--(?:text|border)-(?!focus\b)[a-z-]+\)/;

function canvasInkProblems() {
  const found = [];
  const canvas = join(ROOT, "packages/canvas/src");
  for (const file of walk(canvas)) {
    const path = relative(ROOT, file);
    if (path.includes(".test.")) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (THEME_INK.test(line) && !CANVAS_LAYER_EXCEPTIONS.has(path)) {
        found.push(`${path}:${index + 1}: theme ink in a canvas painter — use ink(ground, role)`);
      }
      const code = line.replace(/\/\/.*$/, "");
      if (LITERAL.test(code) && !CANVAS_LITERAL_FILES.has(path)) {
        found.push(`${path}:${index + 1}: colour literal in a canvas painter — derive it from the ground`);
      }
      LITERAL.lastIndex = 0;
    });
  }
  for (const file of walk(SCAN)) {
    const path = relative(ROOT, file);
    if (!CANVAS_LAYER_FILES.has(path)) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      if (THEME_INK.test(line) && !CANVAS_LAYER_EXCEPTIONS.has(path)) {
        found.push(`${path}:${index + 1}: theme ink in a canvas DOM layer — use groundOf + ink`);
      }
    });
  }
  for (const file of readdirSync(STYLES).filter((name) => name.endsWith(".css"))) {
    const path = `apps/web/src/styles/${file}`;
    const lines = readFileSync(join(STYLES, file), "utf8").split("\n");
    let selector = "";
    let depth = 0;
    lines.forEach((line, index) => {
      // Only a block that *is* the layer counts: `:not(.inline-editor)` is the focus
      // ring around it, which is chrome.
      const canvasBlock = CANVAS_SELECTORS.some((name) => selector.startsWith(name));
      if (canvasBlock && THEME_INK.test(line) && !CANVAS_LAYER_EXCEPTIONS.has(path)) {
        found.push(`${path}:${index + 1}: theme ink in a canvas layer — use the object's --ink`);
      }
      if (line.includes("{")) {
        if (depth === 0) selector = line.slice(0, line.indexOf("{")).trim();
        depth += 1;
      }
      if (line.includes("}")) {
        depth = Math.max(0, depth - 1);
        if (depth === 0) selector = "";
      }
    });
  }
  return found;
}

problems.push(...layerProblems());
problems.push(...canvasInkProblems());

// Design rules: a strict gate; exceptions are named in ui-design-rules.mjs (ADR-229).
const findings = scanDesignRules(ROOT);
problems.push(...strictProblems(findings));

if (problems.length) {
  console.error("UI rules failed (use a token, objectDefaults.ts, a named layer, or a @remo/ui component):");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `UI rules ok: no colour literals outside ${ALLOWED.size} data modules; layers are one named ladder; ` +
    `design rules clean, ${PENDING.length} pending items named with a reason`,
);
