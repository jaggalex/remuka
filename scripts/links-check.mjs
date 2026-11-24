#!/usr/bin/env node
/**
 * A link into the guide is a deployment fact, not a build fact (ADR-284).
 *
 * The interface and the in-app help link to the product guide, and the guide belongs to
 * the installation: the cloud has one per zone, a stand has its own, a self-host may have
 * none. A host written into the build is how the stage's «Отказ от ответственности» led to
 * the production guide: the browser obeyed the build, not the installation.
 *
 * So this gate reads the two surfaces that are shipped to a person and fails when either
 * names a guide host. The address comes from `GET /config` (`docs.origin`) and every link
 * is built from it with `docsHref`; the in-app help uses the `{{docs}}` token.
 *
 * Allowed on purpose:
 *   packages/brand/**   the cloud's hosts live there, and the zone defaults read them
 *   content/legal/**    a published legal revision is never rewritten (ADR-256)
 *   tests and generated output — they describe the rule or are rebuilt from a source.
 *
 * The brand gate has its own, different job (the old name and the old hosts, ADR-254); a
 * link gate is not a second way to spell the brand, so it is its own script and its own
 * step in `pnpm verify`.
 *
 *   node scripts/links-check.mjs            the gate
 *   node scripts/links-check.mjs --json     machine-readable findings
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT =
  typeof import.meta.dirname === "string"
    ? join(import.meta.dirname, "..")
    : join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The surfaces a person reads and clicks. `content/help` is here because the help is
 * shipped inside the application, not only on the portal.
 */
const SURFACES = [
  { path: "apps/web/src", ext: [".ts", ".tsx", ".mjs", ".js", ".json"] },
  { path: "content/help", ext: [".md", ".mdx", ".json"] },
];

/** Generated output is rebuilt from its source and never edited by hand. */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);
const SKIP_PATH = /(?:^|\/)(?:[^/]*\.(?:test|spec|stories)\.[^/]+|__tests__|__snapshots__|fixtures?|test-data)(?:\/|$)/;
const SKIP_GENERATED = /(?:^|\/)(?:[^/]*\.generated\.[^/]+|generated\.(?:json|ts|js))$/;

/** The guides of the cloud: a hardcoded one sends a stand or a self-host elsewhere. */
const DOCS_HOST = /\bdocs\.remuka\.(?:com|ru)\b/gi;

function walk(directory, extensions, out) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, extensions, out);
    else if (extensions.includes(entry.slice(entry.lastIndexOf(".")))) out.push(full);
  }
}

/** Every file the gate reads, relative to the repository root. */
export function linkedFiles(root = ROOT) {
  const files = [];
  for (const surface of SURFACES) {
    const full = join(root, surface.path);
    if (!statSync(full, { throwIfNoEntry: false })) continue;
    const found = [];
    walk(full, surface.ext, found);
    for (const file of found) {
      const path = relative(root, file).split(sep).join("/");
      if (SKIP_PATH.test(path) || SKIP_GENERATED.test(path)) continue;
      files.push(path);
    }
  }
  return files.sort();
}

/**
 * Findings as `{ file, line, host }`: one per line, because two links in one paragraph are
 * one thing to fix.
 */
export function scanLinks(root = ROOT) {
  const problems = [];
  const files = linkedFiles(root);
  for (const path of files) {
    const text = readFileSync(join(root, path), "utf8");
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(DOCS_HOST)) {
        problems.push({ file: path, line: index + 1, host: match[0] });
      }
    });
  }
  const seen = new Set();
  return {
    problems: problems.filter((problem) => {
      const key = `${problem.file}:${problem.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    files: files.length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = scanLinks(ROOT);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result.problems, null, 2));
  } else if (result.problems.length) {
    for (const problem of result.problems) {
      console.error(`${problem.file}:${problem.line}: ${problem.host}`);
    }
    console.error(
      `\nlinks: ${result.problems.length} hardcoded guide address(es). The guide belongs to the ` +
        "installation: read `docs.origin` from `/config` and build the link with `docsHref`, " +
        "or use the `{{docs}}` token in the in-app help (ADR-284).",
    );
  } else {
    console.log(
      `Links check ok: ${result.files} shipped file(s), no hardcoded guide address.`,
    );
  }
  if (result.problems.length) process.exitCode = 1;
}
