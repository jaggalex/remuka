#!/usr/bin/env node
/**
 * Nothing goes into a browser without a registry record (ADR-255, `spec/cookies.md` §8).
 *
 * The registry only helps while it is true in both directions. This gate reads the code and
 * fails when:
 *
 *   1. `apps/sync` builds a `Set-Cookie` whose name is not in the registry;
 *   2. the app, the packages or the web boot scripts use a `localStorage`/`sessionStorage`
 *      key, an IndexedDB database or a `document.cookie` name that is not in the registry;
 *   3. an HTML surface loads an external script whose host is not a necessary third party;
 *   4. the registry lists a record that no file uses.
 *
 * Rule 4 is what keeps the registry from becoming a wish list. A record that arrives ahead of
 * its code says why in `UNUSED_ALLOWED`, the way `brand-check.mjs` keeps its exceptions.
 *
 * Keys held in constants and templates are resolved, because both exist in the real code:
 * `STORAGE_KEY = "remo.lang"` and `` `remo.verifyBanner.${userId}` `` are storage keys even
 * though no call site spells them out.
 *
 *   node scripts/consent-check.mjs            the gate
 *   node scripts/consent-check.mjs --json     machine-readable findings
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  STORAGE_REGISTRY,
  nameMatches,
  validateRegistry,
  validateZonePolicies,
} from "../packages/consent/src/index.mjs";
import { BRAND } from "../packages/brand/src/index.mjs";

const ROOT =
  typeof import.meta.dirname === "string"
    ? join(import.meta.dirname, "..")
    : join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where storage is called. `guide` and the landing arrive with stage 5 (§9). */
const CODE_SURFACES = [
  { path: "apps/web/src", ext: [".ts", ".tsx"] },
  // The blocking theme script runs before the bundle and reads the same key (§4 of the web).
  { path: "apps/web/public", ext: [".js"] },
  { path: "packages", ext: [".ts", ".tsx", ".mjs", ".js"], sourceDirOnly: true },
  // The service owns the server cookies; only its cookie strings are read here.
  { path: "apps/sync", ext: [".mjs", ".js"] },
];

/** HTML that can load a third-party script or frame. */
const SCRIPT_SURFACES = [
  { path: "apps/web/index.html", ext: [".html"] },
  { path: "docs-site", ext: [".html"] },
  { path: "deploy/support", ext: [".html"] },
  { path: "guide", ext: [".html"] },
];

/** Generated or third-party directories: never read (the same list as the brand gate). */
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

/** Tests and fixtures use keys on purpose; they are not shipped storage. */
const SKIP_PATH =
  /(?:^|\/)(?:[^/]*\.(?:test|spec|stories)\.[^/]+|__tests__|__snapshots__|fixtures?|test-data)(?:\/|$)/;

/**
 * Records that no scanned file uses yet, each with the reason it is declared early.
 *
 * The list is deliberately short: a new entry here needs a stage or an architecture reason,
 * not a convenience.
 */
const UNUSED_ALLOWED = new Map([
  [
    BRAND.domains.support,
    "the support frame origin is runtime configuration from GET /support/config (§7), not a source literal",
  ],
  [
    "guide.theme",
    "the guide theme script is wired to this module in stage 5 (§9); the record keeps the registry complete today",
  ],
  [
    "remo.legal.upcoming.*",
    "the banner key names a document revision and is built at runtime by legalUpcomingSessionKey (§5)",
  ],
]);

/**
 * Files whose storage calls take their key from `@remo/consent` at runtime.
 *
 * The withdrawal path of the gate (§5) must remove whatever the registry lists for a
 * category, so the key can never be a literal. The file is named with its reason, the way
 * `brand-check.mjs` names its exceptions; the registry itself is still validated above.
 */
const DYNAMIC_KEYS_ALLOWED = new Map([
  [
    "apps/web/src/consentGate.ts",
    "the gate purges the withdrawn category's keys by reading packages/consent/src/registry.mjs (§5)",
  ],
  [
    "apps/web/src/legal/LegalUpcomingBanner.tsx",
    "the key names a document revision (doc@version) and is built by legalUpcomingSessionKey (§5)",
  ],
  [
    "apps/web/src/hints.ts",
    "the key is one per hint slot (`remuka.hints.<id>`) and the legacy alias comes from hintRegistry (ADR-289)",
  ],
]);

/** Cookie names that are really HTML attributes or header words, not cookies. */
const NOT_A_COOKIE = new Set([
  "application",
  "aria",
  "content",
  "data",
  "domain",
  "expires",
  "http",
  "https",
  "max",
  "min",
  "path",
  "samesite",
  "secure",
  "text",
  "utf-8",
]);

function walk(directory, extensions, out, { sourceDirOnly = false } = {}) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, extensions, out, { sourceDirOnly });
    } else if (extensions.includes(entry.slice(entry.lastIndexOf(".")))) {
      const path = full.split(sep).join("/");
      if (sourceDirOnly && !path.includes("/src/")) continue;
      if (SKIP_PATH.test(path)) continue;
      out.push(full);
    }
  }
}

function surfaces(root, list) {
  const files = [];
  for (const surface of list) {
    const full = join(root, surface.path);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) walk(full, surface.ext, files, surface);
    else files.push(full);
  }
  return [...new Set(files)].sort();
}

/** Line numbers for findings: one lookup table per file instead of a scan per finding. */
function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts, offset) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/** The index of the bracket that closes the one at `open`, ignoring brackets in quotes. */
function matchingIndex(text, open) {
  const opener = text[open];
  const closer = opener === "{" ? "}" : opener === "(" ? ")" : opener === "[" ? "]" : null;
  if (!closer) return -1;
  let depth = 0;
  let quote = null;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** The first argument of a call, from the character after `(` to its `,` or `)`. */
function firstArgument(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return text.slice(start, index);
      depth -= 1;
    } else if (char === "," && depth === 0) return text.slice(start, index);
  }
  return text.slice(start);
}

/** Split on a top-level operator, so `a + f(b + c)` keeps the call together. */
function splitTopLevel(expression, operator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let last = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === operator && depth === 0) {
      parts.push(expression.slice(last, index));
      last = index + 1;
    }
  }
  parts.push(expression.slice(last));
  return parts;
}

/** A quoted string's contents, with a template's expressions resolved or marked with `*`. */
function readString(expression, consts, returns, depth) {
  const text = expression.trim();
  const quote = text[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  if (text.at(-1) !== quote) return null;
  const inner = text.slice(1, -1);
  if (quote !== "`") {
    return inner.replace(/\\(.)/g, "$1");
  }
  let out = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === "\\") {
      out += inner[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (char === "$" && inner[index + 1] === "{") {
      const end = matchingIndex(inner, index + 1);
      if (end < 0) return null;
      const value = resolveExpr(inner.slice(index + 2, end), consts, returns, depth + 1);
      // The code may build a key from an account id, and the registry uses `*` for that.
      out += value ?? "*";
      index = end;
      continue;
    }
    out += char;
  }
  return out;
}

/** Resolve a key expression: a literal, a constant, a template or a small helper call. */
function resolveExpr(raw, consts, returns, depth = 0) {
  if (depth > 6) return null;
  let expression = String(raw ?? "").trim();
  expression = expression.replace(/\s+as\s+[\w$.<>[\]|"']+$/s, "").replace(/!$/, "").trim();
  if (!expression) return null;
  if (expression.startsWith("(") && matchingIndex(expression, 0) === expression.length - 1) {
    expression = expression.slice(1, -1).trim();
  }
  const literal = readString(expression, consts, returns, depth);
  if (literal !== null) return literal;
  const parts = splitTopLevel(expression, "+");
  if (parts.length > 1) {
    let out = "";
    for (const part of parts) {
      const value = resolveExpr(part, consts, returns, depth + 1);
      if (value === null) return null;
      out += value;
    }
    return out;
  }
  if (/^[A-Za-z_$][\w$]*$/.test(expression)) return consts.get(expression) ?? null;
  const call = /^([A-Za-z_$][\w$]*)\s*\(/.exec(expression);
  if (call) return returns.get(call[1]) ?? null;
  return null;
}

/** Constants that hold a storage key, including `export const` and a type annotation. */
function collectConsts(text) {
  const consts = new Map();
  const pattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*([^\n;]+)/g;
  for (const match of text.matchAll(pattern)) {
    const value = resolveExpr(match[2], consts, new Map());
    if (value) consts.set(match[1], value);
  }
  return consts;
}

/** Small helpers that return a key (`bannerKey(userId)` returns a template). */
function collectReturns(text, consts) {
  const returns = new Map();
  const pattern = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/g;
  for (const match of text.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const close = matchingIndex(text, open);
    if (close < 0) continue;
    const body = text.slice(open + 1, close);
    const returned = /\breturn\s+([^;]+);/.exec(body);
    if (!returned) continue;
    const value = resolveExpr(returned[1], consts, new Map());
    if (value) returns.set(match[1], value);
  }
  return returns;
}

function isCookieName(name) {
  if (NOT_A_COOKIE.has(name.toLowerCase())) return false;
  if (/^(?:data|aria)-/.test(name)) return false;
  return !name.includes("/");
}

/**
 * Blank out comments without moving a single offset.
 *
 * Comments explain the rules and quote key names (`document.cookie`, `Path=/`), so scanning
 * them would report the documentation as storage. Strings are kept: a key is a string.
 */
function maskComments(text) {
  const chars = text.split("");
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "/" && text[index + 1] === "/") {
      for (; index < text.length && text[index] !== "\n"; index += 1) chars[index] = " ";
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      chars[index] = " ";
      chars[index + 1] = " ";
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        if (text[index] !== "\n") chars[index] = " ";
        index += 1;
      }
      if (index < text.length) {
        chars[index] = " ";
        chars[index + 1] = " ";
        index += 1;
      }
    }
  }
  return chars.join("");
}

/**
 * The storage uses of one source file.
 *
 * The receiver is read from the text before `.getItem`, so the default `storage` parameter of
 * `moveBanner.ts` is recognised as Storage even though the key lives in a constant. A receiver
 * that does not name localStorage or sessionStorage still yields a use; the registry match
 * then accepts any non-cookie record with that name.
 */
function scanCode(path, text, problems, starts) {
  const code = maskComments(text);
  // The gate reports paths with forward slashes on every platform.
  const relativePath = path.split(sep).join("/");
  const dynamicAllowed = DYNAMIC_KEYS_ALLOWED.has(relativePath);
  const consts = collectConsts(code);
  const returns = collectReturns(code, consts);
  const usages = [];
  const add = (kind, name, offset, call) => {
    if (name === null || name === undefined || name === "") {
      // The registry-driven purge cannot name a literal; its file says why above.
      if (dynamicAllowed) return;
      problems.push({
        rule: "unresolved",
        file: path,
        line: lineAt(starts, offset),
        name: call,
        why: "cannot determine the storage key — use a string literal or a constant the gate can resolve",
      });
      return;
    }
    usages.push({ kind, name: String(name), file: path, line: lineAt(starts, offset), call });
  };

  for (const match of code.matchAll(/\.\s*(getItem|setItem|removeItem)\s*\(/g)) {
    const before = code.slice(Math.max(0, match.index - 100), match.index);
    const kind = /sessionStorage\s*$/.test(before)
      ? "sessionStorage"
      : /localStorage\s*$/.test(before)
        ? "localStorage"
        : null;
    const argument = firstArgument(code, match.index + match[0].length);
    add(kind, resolveExpr(argument, consts, returns), match.index, match[1]);
  }

  for (const match of code.matchAll(/indexedDB\s*\.\s*open\s*\(/g)) {
    const argument = firstArgument(code, match.index + match[0].length);
    add("indexedDB", resolveExpr(argument, consts, returns), match.index, "indexedDB.open");
  }

  if (code.includes("document.cookie")) {
    let found = 0;
    for (const match of code.matchAll(/document\.cookie/g)) {
      const lineStart = code.lastIndexOf("\n", match.index) + 1;
      const lineEnd = code.indexOf("\n", match.index);
      const line = code.slice(lineStart, lineEnd < 0 ? code.length : lineEnd);
      const assignment = /document\.cookie\s*=\s*([^;]+)/.exec(line);
      if (assignment) {
        const value = resolveExpr(assignment[1], consts, returns);
        const name = /^([A-Za-z][\w.-]*)=/.exec(value ?? "")?.[1];
        if (name) {
          found += 1;
          add("cookie", name, match.index, "document.cookie");
        }
        continue;
      }
      // A reader parses the cookie header with a name in the same expression.
      for (const named of line.matchAll(/(?<![\w.-])([A-Za-z][A-Za-z0-9_.-]{1,64})=/g)) {
        if (!isCookieName(named[1])) continue;
        found += 1;
        add("cookie", named[1], match.index, "document.cookie");
      }
    }
    if (found === 0 && !dynamicAllowed) {
      problems.push({
        rule: "unresolved",
        file: path,
        line: lineAt(starts, code.indexOf("document.cookie")),
        name: "document.cookie",
        why: "cannot verify the cookie name — read or write it through a literal or a resolvable constant",
      });
    }
  }

  return usages;
}

/** Every string literal and template in a file, with its offset. */
function stringLiterals(text) {
  const units = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g)) {
    units.push({
      index: match.index,
      content: match[0].slice(1, -1),
    });
  }
  return units;
}

/** The cookie a serialization sets, e.g. `${SESSION_COOKIE}=…; Path=/; HttpOnly`. */
function cookieInSerialization(literal, consts) {
  const head = literal.slice(0, literal.indexOf(";"));
  const expression = /^\$\{([^}]+)\}=/.exec(head);
  if (expression) return resolveExpr(expression[1], consts, new Map());
  return /^([A-Za-z][\w.-]*)=/.exec(head)?.[1] ?? null;
}

/** A `Set-Cookie` string in the service: only the cookie-attributed strings are read. */
function scanServiceCookies(path, text, problems, starts) {
  const code = maskComments(text);
  const consts = collectConsts(code);
  const usages = [];
  for (const unit of stringLiterals(code)) {
    if (!/Path=\//.test(unit.content)) continue;
    const name = cookieInSerialization(unit.content, consts);
    const line = lineAt(starts, unit.index);
    if (!name) {
      problems.push({
        rule: "unresolved",
        file: path,
        line,
        name: "Set-Cookie",
        why: "cannot determine the cookie name in this serialization",
      });
      continue;
    }
    usages.push({ kind: "cookie", name, file: path, line, call: "Set-Cookie" });
  }
  return usages;
}

/** Whether a registry record describes this use. */
function entryCovers(entry, usage) {
  if (!nameMatches(entry.name, usage.name)) return false;
  if (usage.kind === "cookie") return entry.kind === "cookie";
  if (usage.kind) return entry.kind === usage.kind;
  // A Storage passed as a parameter does not say which one it is; any browser storage fits.
  return entry.kind === "localStorage" || entry.kind === "sessionStorage";
}

/** External scripts: a third-party host is allowed only as a necessary record (§8.3). */
function scanScripts(root, registry, problems, used, fileCount) {
  const hosts = new Set();
  for (const file of surfaces(root, SCRIPT_SURFACES)) {
    fileCount.add(file);
    const path = relative(root, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    const starts = lineStarts(text);
    for (const match of text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      const source = match[1].trim();
      if (!/^(?:https?:)?\/\//i.test(source)) continue; // self and root-relative are not third parties
      let host;
      try {
        host = new URL(source.startsWith("//") ? `https:${source}` : source).hostname;
      } catch {
        continue;
      }
      hosts.add(host);
      const entry = registry.find(
        (candidate) =>
          candidate.kind === "third-party" &&
          candidate.category === "necessary" &&
          (candidate.name === host || nameMatches(candidate.name, host)),
      );
      if (entry) used.add(entry);
      else
        problems.push({
          rule: "script",
          file: path,
          line: lineAt(starts, match.index),
          name: host,
          why: "an external script from a host that is not a necessary third-party record (§8 rule 3)",
        });
    }
  }
  return hosts;
}

/**
 * The gate's result: problems with file, line and reason, plus the counts the CLI reports.
 *
 * `registry` is injectable so a test can prove the red and green fixtures without editing the
 * real registry.
 */
export function scanConsent(root = ROOT, { registry = STORAGE_REGISTRY } = {}) {
  const problems = [];
  for (const issue of validateRegistry(registry)) {
    problems.push({ rule: "registry", file: "packages/consent/src/registry.mjs", line: 0, name: "registry", why: issue });
  }
  for (const issue of validateZonePolicies()) {
    problems.push({ rule: "zones", file: "packages/consent/src/zones.mjs", line: 0, name: "zones", why: issue });
  }

  const files = new Set();
  const usages = [];
  for (const file of surfaces(root, CODE_SURFACES)) {
    files.add(file);
    const path = relative(root, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    const starts = lineStarts(text);
    // The service is read for cookie serializations; the browser roots for storage calls.
    const inService = path.startsWith("apps/sync/");
    const found = inService
      ? scanServiceCookies(path, text, problems, starts)
      : scanCode(path, text, problems, starts);
    usages.push(...found);
  }

  const used = new Set();
  for (const usage of usages) {
    const entry = registry.find((candidate) => entryCovers(candidate, usage));
    if (entry) used.add(entry);
    else
      problems.push({
        rule: "unregistered",
        file: usage.file,
        line: usage.line,
        name: usage.name,
        kind: usage.kind,
        why: `a ${usage.kind ?? "storage"} use with no registry record — add it to packages/consent/src/registry.mjs with a category and a purpose`,
      });
  }

  const hosts = scanScripts(root, registry, problems, used, files);

  // §8 rule 4: the registry must not list what no file uses. Script hosts are marked used by
  // `scanScripts`, so this runs after the HTML surfaces are read.
  for (const entry of registry) {
    if (used.has(entry)) continue;
    if (UNUSED_ALLOWED.has(entry.name)) continue;
    problems.push({
      rule: "unused",
      file: "packages/consent/src/registry.mjs",
      line: 0,
      name: entry.name,
      why: "a registry record that no scanned file uses — remove it or say why in scripts/consent-check.mjs",
    });
  }

  const seen = new Set();
  const unique = [];
  for (const problem of problems) {
    const key = `${problem.rule}:${problem.file}:${problem.line}:${problem.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(problem);
  }

  return {
    problems: unique,
    files: files.size,
    usages: usages.length,
    uses: usages
      .map(({ kind, name, file, line }) => ({ kind, name, file, line }))
      .sort((left, right) => `${left.file}:${left.line}`.localeCompare(`${right.file}:${right.line}`)),
    entries: registry.length,
    hosts: [...hosts].sort(),
  };
}

function main(argv) {
  const json = argv.includes("--json");
  const result = scanConsent();
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.problems.length) {
    const touched = new Set(result.problems.map((problem) => problem.file)).size;
    console.error(
      `Consent check failed: ${result.problems.length} finding(s) in ${touched} file(s) of ${result.files} read.`,
    );
    for (const problem of result.problems) {
      const at = problem.line ? `${problem.file}:${problem.line}` : problem.file;
      console.error(`${at}: ${problem.name} — ${problem.why}`);
    }
    console.error(
      "The registry is packages/consent/src/registry.mjs; allowed exceptions live in scripts/consent-check.mjs (§8).",
    );
  } else {
    console.log(
      `Consent check ok: ${result.entries} registry record(s), ${result.usages} browser storage use(s), ` +
        `${result.files} file(s) read.`,
    );
  }
  if (result.problems.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
