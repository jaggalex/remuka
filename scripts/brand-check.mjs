#!/usr/bin/env node
/**
 * The old name and the old addresses must not come back to anything a person reads
 * (ADR-254, `spec/rebrand.md` §8).
 *
 * The rebrand splits the product in two: «Ремука / Remuka» is what a person sees, `remo` is
 * the code name that stays in packages, environment variables, headers, roles, storage keys,
 * the backup format and the deploy units (§2). An unguarded rename drifts back one string at
 * a time, so this gate reads the user-facing surfaces and fails when the old name appears as
 * a word in text a person reads, or when an old `letii.ru` address does.
 *
 * What is read:
 *   apps/web/src/i18n/*.ts        string literals
 *   apps/web/src/**\/*.tsx        string literals and JSX text
 *   apps/web/index.html           the title before the application starts
 *   apps/sync/mail-templates.mjs  string literals
 *   content/help/**, guide/**, README.md, docs/**, deploy/support/**   prose
 *
 * Markdown is read as prose: fenced blocks and inline code are skipped, because a command
 * such as `systemctl restart remo-sync` is a code identifier (§2), not a sentence about the
 * product. Tests, fixtures and generated output are not read.
 *
 *   node scripts/brand-check.mjs            the gate
 *   node scripts/brand-check.mjs --json     machine-readable findings
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT =
  typeof import.meta.dirname === "string"
    ? join(import.meta.dirname, "..")
    : join(dirname(fileURLToPath(import.meta.url)), "..");

/** The only surfaces a person reads; everything else is code or history. */
const SURFACES = [
  { path: "apps/web/src/i18n", ext: [".ts"] },
  { path: "apps/web/src", ext: [".tsx"] },
  // Plain modules hold user-visible strings too: `about.ts` carried the old repository
  // address until `spec/rebrand-fixes.md` §4 added this surface.
  { path: "apps/web/src", ext: [".ts"] },
  // The service sends mail, writes exports and names the product in errors.
  { path: "apps/sync", ext: [".mjs"] },
  { path: "apps/web/index.html", ext: [".html"] },
  { path: "apps/sync/mail-templates.mjs", ext: [".mjs"] },
  { path: "content/help", ext: [".md", ".mdx", ".json"] },
  { path: "guide", ext: [".md", ".mdx", ".json"] },
  { path: "README.md", ext: [".md"] },
  { path: "docs", ext: [".md", ".mdx", ".json", ".html", ".txt", ".yml", ".yaml"] },
  { path: "deploy/support", ext: [".md", ".html", ".js", ".conf"] },
];

/** Generated or third-party directories: never read (ADR-254 §8). */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "docs-site",
  "ui-inventory",
  "e2e-report",
  "backups",
  "test-results",
  ".data",
  ".vite",
]);

/** Tests, fixtures and probe artefacts describe the old name on purpose. */
const SKIP_PATH = /(?:^|\/)(?:[^/]*\.(?:test|spec|stories)\.[^/]+|__tests__|__snapshots__|fixtures?|test-data)(?:\/|$)/;
const SKIP_PROBES = /^docs\/design\/sketches\/.+\/probes\//;
/** Generated output is rebuilt from its source, never edited by hand (§4.4). */
const SKIP_GENERATED = /(?:^|\/)(?:[^/]*\.generated\.[^/]+|generated\.(?:json|ts|js))$/;

/**
 * The reasons an old name or address is allowed, in one list (§8).
 *
 * File rules come first: a whole section may need the old name. Then identifiers, then
 * dated history lines. Each entry says why, so the next reader does not have to guess.
 */
const FILE_ALLOWANCES = [
  {
    match: /^spec\//,
    why: "the specification quotes the old name by design (ADR-254)",
  },
  {
    match: /^ADR\.md$/,
    why: "decision records are never rewritten (AGENTS.md, ADR-254)",
  },
  {
    match: /^CHANGELOG/,
    why: "the changelog is history and keeps the old name (ADR-254 §1.5)",
  },
  {
    match: /^guide\/admin\/deploy\//,
    why: "the guide's deployment section keeps operator commands and units (§2)",
  },
  {
    match: /^guide\/.+self-hosting\//,
    why: "the guide's self-hosting section keeps operator commands and units (§2)",
  },
  {
    match: /^deploy\/nginx-remo\.conf$/,
    why: "the old-host server block is the migration map itself (§6)",
  },
  {
    match: /^scripts\/accept-rebrand\.mjs$/,
    why: "the acceptance probe must name the old and new hosts it checks (§10)",
  },
  {
    match: /^docs\/design\//,
    why: "the design archive and its generated sketches record past states; they are not shipped to a person (§4.4)",
  },
  {
    match: /^docs\/architecture\//,
    why: "research and architecture notes for contributors, not a surface a person reads in the product",
  },
  {
    match: /^docs\/ui-inventory\.md$/,
    why: "generated interface inventory; regenerate it instead of editing it (§4.4)",
  },
  {
    match: /^guide\/support\/changelog\//,
    why: "the public changelog is history, the same exception as CHANGELOG (ADR-254 §1.5)",
  },
  {
    // A test proves the move away from the old host, so the fixture names it (§4.1).
    match: /(?:^|\/)[^/]*\.(?:test|spec)\.[^/]+$/,
    why: "tests and their fixture trees check the migration from the old address (§4.1)",
  },
  {
    match: /^scripts\/brand-check\.mjs$/,
    why: "the gate itself names the old host and the brand literals it forbids (§4.1)",
  },
];

/**
 * Old-host lines an allowance covers even though its file does not: a production example
 * documents `REMO_APP_ORIGIN_ALIASES` with the old address on purpose, and nothing else
 * in that file may name it (`spec/rebrand-fixes.md` §4.1).
 */
const LINE_ALLOWANCES = [
  {
    match: /^deploy\/[^/]+\.example$/,
    line: /REMO_APP_ORIGIN_ALIASES/,
    why: "the example documents the alias variable with the old address (§4.1)",
  },
  {
    // The release runbook tells the operator to curl the old host while it still answers;
    // naming it is the check itself, the same exception the acceptance probe has (§6).
    match: /^docs\/operations\/cloud\.md$/,
    line: /\b(?:docs\.)?remo\.letii\.ru\b/,
    why: "the runbook checks the old host during the move (§6)",
  },
];

/**
 * Code identifiers that stay `remo` (§2). A match is allowed only when the identifier
 * around it covers the whole occurrence — never because the same line mentions one.
 */
const IDENTIFIERS = [
  { pattern: /@remo\/[a-z][a-z-]*/g, why: "workspace package name (§2)" },
  { pattern: /\bREMO_[A-Z0-9_]+/g, why: "environment variable (§2)" },
  { pattern: /\bX-Remo-[A-Za-z-]+/g, why: "webhook and gateway header (§2)" },
  {
    pattern: /\bremo_[a-zA-Z0-9_]+/g,
    why: "database role, storage key or support attribute (§2)",
  },
  {
    pattern: /\bremo\.[a-z][A-Za-z0-9._-]*/g,
    why: "storage key, setting or format identifier (§2)",
  },
  { pattern: /\bremo:[a-z:*]+/g, why: "postMessage channel (§2)" },
  { pattern: /\/srv\/remo(?:\/[A-Za-z0-9_./-]*)?/g, why: "operator deploy path (§2)" },
  {
    pattern: /\bremo-(?:sync|web|ai-gateway|gw|gateway|backup|support|app-origin|test)(?:\.[a-z]+)*/g,
    why: "deploy unit, container, compose project or support contract (§2)",
  },
  {
    pattern: /\/remo-logo\.svg\b/g,
    why: "the old logo path is served for twelve months (§6)",
  },
  { pattern: /\bnginx-remo(?:-[a-z]+)?\b/g, why: "deploy file name stays (§2)" },
  {
    pattern: /\babout\.remo\b/g,
    why: "help topic slug, redirected to about.remuka (§4.1)",
  },
  {
    pattern: /\bremo\/fragment\b/g,
    why: "clipboard data type, a code identifier (§2)",
  },
  {
    pattern: /\.remo-probe\b/g,
    why: "S3 bucket probe object key (§2)",
  },
  {
    pattern: /\bremo-[a-z][a-z0-9-]*\.(?:svg|png|css|js)\b/g,
    why: "asset file name kept for cached pages (§2)",
  },
  {
    pattern: /\bx-remo-[a-z-]+\b/gi,
    why: "lower-case webhook signature header (§2)",
  },
  { pattern: /\[remo\]/g, why: "console log scope, never shown to a person" },
];

/**
 * History lines: «Ремука (раньше remo)» and the rename row. The first expires, because §1.5
 * allows the old name in a history line for half a year after the move only.
 */
const HISTORY_LINES = [
  {
    pattern: /(?:Ремука|Remuka)\s*\((?:раньше|formerly)\s+remo\)/i,
    until: "2027-06-01",
    why: "the one allowed history line (§1.5)",
  },
  {
    pattern: /`?remiro`?\s*(?:→|->)\s*`?remo`?/,
    why: "the rename row, the same exception as the changelog (§1.5)",
  },
];

/** The old public host. Matched as a host, so a link is one finding, not two. */
const OLD_HOST = /\bletii\.ru\b/gi;
/** `remo` as a word, in any case: not `remiro`, not `remuka`, not `REMO_`. */
const OLD_NAME = /\bremo\b/gi;
/** The old name typed in Cyrillic. `\b` is ASCII-only, so the boundary is a letter test. */
const OLD_NAME_RU = /(?<!\p{L})ремо(?!\p{L})/giu;

/**
 * The current brand written out by hand (rule 3). Interface copy, documentation and the
 * deploy files may spell it; code must take it from `@remo/brand` (`spec/rebrand-fixes.md`
 * §4.3). The old repository address is included: it is a literal of the same kind, and it
 * was the reason `about.ts` drifted.
 */
const BRAND_LITERAL =
  /(?:\bРемука\b|\bRemuka\b|remuka\.(?:com|ru)\b|github\.com\/jaggalex\/remo(?:ka)?\b)/g;

/** Code that must not spell the brand itself; the gate and the tests are exceptions. */
const BRAND_LITERAL_EXT = /\.(?:ts|tsx|mjs|js|html|css)$/;
const BRAND_LITERAL_ROOTS = [/^apps\//, /^scripts\//];
const BRAND_LITERAL_ALLOWED = [
  {
    match: /^scripts\/accept-rebrand\.mjs$/,
    why: "the probe checks the live hosts, so it spells them out (§10)",
  },
  {
    match: /^apps\/web\/src\/i18n\//,
    why: "interface copy is the one place the name is written out; `{product}` interpolates it (§4.3)",
  },
  {
    match: /^packages\/brand\//,
    why: "the brand module is the source (§4.3)",
  },
];

const WHY = {
  name: "the old product name in text a person reads — write «Ремука»/«Remuka» or take it from the brand module (ADR-254 §4)",
  nameRu:
    "the old product name in Cyrillic — the public name is «Ремука», with the case forms from ADR-254 §4.3",
  host: "an old address — public links point at remuka.com / docs.remuka.com; `letii.ru` stays only in the migration map (ADR-254 §6)",
  literal:
    "the brand written out by hand — take it from `@remo/brand` (spec/rebrand-fixes.md §4.3)",
};

function walk(directory, extensions, out) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, extensions, out);
    else if (extensions.includes(entry.slice(entry.lastIndexOf(".")))) out.push(full);
  }
}

/** Every file in the tree, for the no-git fallback of the old-host scan. */
function walkAll(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkAll(full, out);
    else out.push(full);
  }
  return out;
}

/** Every file the gate reads, deduplicated and relative to the repository root. */
export function surfaceFiles(root = ROOT) {
  const files = new Set();
  for (const surface of SURFACES) {
    const full = join(root, surface.path);
    if (!existsSync(full)) continue;
    const found = [];
    if (statSync(full).isDirectory()) walk(full, surface.ext, found);
    else found.push(full);
    for (const file of found) {
      const path = relative(root, file).split(sep).join("/");
      if (SKIP_PATH.test(path) || SKIP_GENERATED.test(path) || SKIP_PROBES.test(path)) continue;
      files.add(path);
    }
  }
  return [...files].sort();
}

const BINARY_EXT =
  /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|xz|mp4|webm|mov|mp3|wav|ogg|wasm|jar|exe|dmg)$/i;

/**
 * Every file git tracks, or the same tree walked when git is unavailable (§4.1).
 *
 * The old host may sit in a file no surface reads — a deploy note, a helper script, an
 * end-to-end harness — so this list is the whole repository rather than the reading list
 * above. Generated directories are still skipped by the walk.
 */
export function trackedFiles(root = ROOT) {
  if (existsSync(join(root, ".git"))) {
    try {
      const output = execFileSync("git", ["-C", root, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return output
        .split("\0")
        .filter(Boolean)
        .map((path) => path.split(sep).join("/"))
        .sort();
    } catch {
      // A repository without a working git binary is scanned by the walk below.
    }
  }
  return walkAll(root)
    .map((file) => relative(root, file).split(sep).join("/"))
    .sort();
}

/** Files where spelling the brand is an error: code under `apps/` and `scripts/`. */
export function brandLiteralFiles(root = ROOT) {
  return trackedFiles(root).filter((path) => {
    if (!BRAND_LITERAL_ROOTS.some((rule) => rule.test(path))) return false;
    if (!BRAND_LITERAL_EXT.test(path)) return false;
    if (path === "scripts/brand-check.mjs") return false;
    if (SKIP_PATH.test(path) || SKIP_GENERATED.test(path) || SKIP_PROBES.test(path)) return false;
    return !BRAND_LITERAL_ALLOWED.some((rule) => rule.match.test(path));
  });
}

function fileAllowed(path) {
  return FILE_ALLOWANCES.find((rule) => rule.match.test(path));
}

/** An allowance for one line of a file that documents the move (§4.1). */
function lineAllowed(path, line) {
  return LINE_ALLOWANCES.find((rule) => rule.match.test(path) && rule.line.test(line));
}

/** An identifier rule whose own match covers this occurrence. */
function identifierFor(line, index, length) {
  const end = index + length;
  for (const rule of IDENTIFIERS) {
    for (const match of line.matchAll(rule.pattern)) {
      // A dotted identifier must never swallow an old host: `remo.letii.ru` is an address.
      if (match[0].includes("letii")) continue;
      if (match.index <= index && match.index + match[0].length >= end) return rule.why;
    }
  }
  return null;
}

/** A history line whose own match covers this occurrence and has not expired yet. */
function historyFor(line, index, length, today) {
  const end = index + length;
  for (const rule of HISTORY_LINES) {
    const match = line.match(rule.pattern);
    if (!match || match.index > index || match.index + match[0].length < end) continue;
    if (rule.until && today > new Date(`${rule.until}T00:00:00Z`)) {
      return {
        ok: false,
        why: `the «раньше remo» allowance expired on ${rule.until}; remove the history line (ADR-254 §1.5)`,
      };
    }
    return { ok: true, why: rule.why };
  }
  return null;
}

function lineIndex(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
}

/** Fenced blocks and inline code are identifiers, not prose (see the header). */
function markdownProse(text) {
  let fenced = false;
  return text.split("\n").map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      return "";
    }
    if (fenced) return "";
    return line.replace(/`[^`]*`/g, " ");
  });
}

/** The string literals and JSX text of a component or a module. */
function codeText(text) {
  const units = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g)) {
    units.push({ index: match.index, text: match[0] });
  }
  // JSX text sits between tags; `{…}` holds an expression and is skipped by the character
  // class, which keeps `<button>Отмена</button>` readable without parsing JSX.
  for (const match of text.matchAll(/>([^<>{}]+)</g)) {
    units.push({ index: match.index + 1, text: match[1] });
  }
  return units;
}

function hostAt(line, index, length) {
  let start = index;
  while (start > 0 && /[a-z0-9.-]/i.test(line[start - 1])) start -= 1;
  let end = index + length;
  while (end < line.length && /[a-z0-9.-]/i.test(line[end])) end += 1;
  return { start, end, term: line.slice(start, end).replace(/\.+$/, "") };
}

/**
 * Every occurrence of the old name and the old addresses in a text unit, minus the
 * allowlist. Host matches are recorded first so the `remo` inside `docs.remo.letii.ru`
 * is not reported twice.
 */
function scanUnit(unit, add, today) {
  const hosts = [];
  for (const match of unit.text.matchAll(OLD_HOST)) {
    const host = hostAt(unit.text, match.index, match[0].length);
    hosts.push([host.start, host.end]);
    add(host.start, host.term, WHY.host);
  }
  const insideHost = (index) => hosts.some(([start, end]) => index >= start && index < end);
  for (const match of unit.text.matchAll(OLD_NAME)) {
    if (insideHost(match.index)) continue;
    add(match.index, match[0], WHY.name);
  }
  for (const match of unit.text.matchAll(OLD_NAME_RU)) {
    add(match.index, match[0], WHY.nameRu);
  }
}

/**
 * The gate's result: findings with file, line and reason, plus how many identifier uses
 * the allowlist let through (so a shrinking allowlist is visible in the output).
 *
 * `today` exists for the dated history exception and is injectable so the test can prove
 * that the allowance expires instead of quietly lasting forever.
 */
export function scanBrand(root = ROOT, { today = new Date() } = {}) {
  const problems = [];
  let allowed = 0;
  const files = surfaceFiles(root);

  for (const path of files) {
    const fileRule = fileAllowed(path);
    const text = readFileSync(join(root, path), "utf8");
    const isCode = /\.(?:ts|tsx|mjs|js)$/.test(path);
    // Code is read through its literals; prose is read line by line, with fenced blocks and
    // inline code removed so an operator command is not mistaken for a sentence.
    const lines = isCode ? text.split("\n") : markdownProse(text);
    const offsetOf = lineIndex(text);

    if (isCode) {
      for (const unit of codeText(text)) {
        const line = offsetOf(unit.index);
        const sourceLine = lines[line] ?? "";
        scanUnit(
          unit,
          (index, term, why) => {
            const reason = fileRule?.why ?? identifierFor(unit.text, index, term.length);
            if (reason) {
              allowed += 1;
              return;
            }
            const history = historyFor(sourceLine, index, term.length, today);
            if (history?.ok) allowed += 1;
            else problems.push({ file: path, line: line + 1, term, why: history?.why ?? why });
          },
          today,
        );
      }
      continue;
    }

    lines.forEach((line, index) => {
      scanUnit({ text: line }, (position, term, why) => {
        const reason = fileRule?.why ?? identifierFor(line, position, term.length);
        if (reason) {
          allowed += 1;
          return;
        }
        const history = historyFor(line, position, term.length, today);
        if (history?.ok) allowed += 1;
        else problems.push({ file: path, line: index + 1, term, why: history?.why ?? why });
      }, today);
    });
  }

  // The old host is checked in every file git tracks, not only in the reading list above:
  // it reached a deploy note and a helper script that no surface read (§4.1).
  const tracked = trackedFiles(root);
  for (const path of tracked) {
    if (BINARY_EXT.test(path) || SKIP_PATH.test(path) || SKIP_PROBES.test(path)) continue;
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      // A tracked file that cannot be read (a broken symlink) has nothing to scan.
      continue;
    }
    if (!/letii\.ru/i.test(text)) continue;
    const fileRule = fileAllowed(path);
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(OLD_HOST)) {
        const host = hostAt(line, match.index, match[0].length);
        const reason = fileRule?.why ?? lineAllowed(path, line)?.why;
        if (reason) {
          allowed += 1;
          continue;
        }
        problems.push({ file: path, line: index + 1, term: host.term, why: WHY.host });
      }
    });
  }

  // Rule 3: code takes the brand from `@remo/brand` instead of spelling it (§4.3).
  for (const path of brandLiteralFiles(root)) {
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      // A file deleted in the working tree is still in `git ls-files` until the owner
      // stages the removal; there is nothing to scan in it.
      continue;
    }
    if (/\.(?:ts|tsx|mjs|js)$/.test(path)) {
      const offsetOf = lineIndex(text);
      for (const unit of codeText(text)) {
        const line = offsetOf(unit.index);
        for (const match of unit.text.matchAll(BRAND_LITERAL)) {
          problems.push({ file: path, line: line + 1, term: match[0], why: WHY.literal });
        }
      }
    } else {
      text.split("\n").forEach((line, index) => {
        for (const match of line.matchAll(BRAND_LITERAL)) {
          problems.push({ file: path, line: index + 1, term: match[0], why: WHY.literal });
        }
      });
    }
  }

  // One finding per file, line and term: a markdown link spells the old host twice — in the
  // label and in the target — and that is one thing to fix, not two.
  const seen = new Set();
  const unique = [];
  for (const problem of problems) {
    const key = `${problem.file}:${problem.line}:${problem.term}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(problem);
  }

  return { problems: unique, allowed, files: files.length, tracked: tracked.length };
}

function printJson(result) {
  process.stdout.write(
    `${JSON.stringify(
      {
        files: result.files,
        allowed: result.allowed,
        problems: result.problems,
      },
      null,
      2,
    )}\n`,
  );
}

function main(argv) {
  const json = argv.includes("--json");
  const result = scanBrand();
  if (json) {
    printJson(result);
  } else if (result.problems.length) {
    const touched = new Set(result.problems.map((problem) => problem.file)).size;
    console.error(
      `Brand check failed: ${result.problems.length} old-name or old-address finding(s) in ${touched} file(s).`,
    );
    for (const problem of result.problems) {
      console.error(`${problem.file}:${problem.line}: «${problem.term}» — ${problem.why}`);
    }
    console.error(
      "Code identifiers stay `remo` (ADR-254 §2); the allowed shapes are listed in scripts/brand-check.mjs.",
    );
  } else {
    console.log(
      `Brand check ok: ${result.files} user-facing file(s), no old name or old address, ` +
        `${result.allowed} identifier use(s) allowed.`,
    );
  }
  if (result.problems.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
