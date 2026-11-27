#!/usr/bin/env node
/**
 * Builds the legal document pages from `content/legal/` (ADR-256, `spec/legal-acceptance.md` §2).
 *
 * The registry is `content/legal/index.json`; the texts are one immutable file per zone,
 * document and revision. This build renders `/legal/<doc>` (the current revision) and
 * `/legal/<doc>/v<N>` for every earlier revision, one directory per zone. It also writes
 * the SHA-256 of each published revision into the index — the index is the registry, so a
 * hash that only the build kept would be a second source of truth.
 *
 * The output is one directory per zone, so the site of an installation maps its `/legal/`
 * to `legal-site/<zone>/` and gets only its own documents. A draft page carries the
 * «Черновик» plate and `noindex`: drafts exist to test the client path before a lawyer
 * agrees, not to be found by a search engine.
 *
 *   node scripts/legal-build.mjs              write legal-site/ and update the index
 *   node scripts/legal-build.mjs --check      validate sources, index and output; write nothing
 *   node scripts/legal-build.mjs --out DIR    write somewhere else (tests)
 *
 * `--check` is `pnpm legal:check` in `pnpm verify`. It fails when a published text no
 * longer matches its recorded hash, when a published text still has `[...]` placeholders,
 * when a required document has no text, when the tree has a document the index does not
 * name, and when a generated page is stale (only if the output directory exists, because
 * `legal-site/` is generated and a clean checkout has none).
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LEGAL_CONTENT_DIR,
  LEGAL_ZONES,
  legalContentDir,
  legalDocuments,
  legalIndexPath,
  legalPagePath,
  legalTextSha256,
  placeholderFindings,
  readLegalIndex,
  readLegalRevisions,
  recordedHash,
  validateLegalIndex,
} from "../packages/legal/src/index.mjs";
import { APPLE_TOUCH, readMark } from "./brand-source.mjs";
import { markdown } from "./docs-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { BRAND } = await import(new URL("../packages/brand/src/index.mjs", import.meta.url));

/** Where `pnpm legal:build` writes the static site. `legal-site/` is generated. */
export const DEFAULT_OUT = join(ROOT, "legal-site");

/** The origin of each installation's site: the texts link there and the canonical names it. */
const ZONE_ORIGIN = Object.freeze({
  eu: `https://${BRAND.domains.site}`,
  ru: `https://${BRAND.domains.siteRu}`,
});

const PAGE = {
  ru: {
    documents: "Документы",
    version: "Редакция",
    effective: "Действует с",
    draft: "Черновик",
    draftNote: "Не опубликован: текст согласуется с юристом.",
    versions: "Версии",
    changes: "Что изменилось",
    home: "На главную",
  },
  en: {
    documents: "Documents",
    version: "Version",
    effective: "Effective",
    draft: "Draft",
    draftNote: "Not published: the text is under legal review.",
    versions: "Versions",
    changes: "What changed",
    home: "Home",
  },
};

const md = markdown();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A wide table scrolls inside itself instead of widening the page (as in the guide). */
function renderMarkdown(text) {
  return md
    .render(text)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

function label(entry, locale) {
  return entry.title?.[locale] || Object.values(entry.title ?? {})[0] || entry.doc;
}

// The acceptance journal keeps the exact document hash. The separate seal binds its
// published wording in both languages to those same bytes without changing any receipt.
function summaryDigest(textHash, summary) {
  return legalTextSha256(JSON.stringify([textHash, summary.ru ?? null, summary.en ?? null]));
}

/** The index with the missing hashes of published revisions filled in; never overwritten. */
export function recordHashes(index, documents) {
  const next = structuredClone(index);
  const byKey = new Map(documents.map(({ entry, revisions }) => [`${entry.zone}/${entry.doc}`, revisions]));
  for (const entry of next.documents ?? []) {
    if (entry.status !== "published") continue;
    const revisions = byKey.get(`${entry.zone}/${entry.doc}`);
    if (!revisions) continue;
    if (entry.changes && !recordedHash(entry, entry.current) && (!entry.changesHistory || typeof entry.changesHistory === "object") && !entry.changesHistory?.[entry.current]) {
      const file = revisions.get(entry.current)?.get(entry.lang?.[0]);
      if (file) {
        entry.changesHistory ??= {};
        entry.changesHistory[entry.current] = { ...entry.changes, sha256: summaryDigest(file.sha256, entry.changes) };
      }
    }
    entry.sha256 = entry.sha256 && typeof entry.sha256 === "object" ? entry.sha256 : {};
    for (let version = 1; version <= entry.current; version += 1) {
      const file = revisions.get(version)?.get(entry.lang?.[0]);
      if (file && !recordedHash(entry, version)) entry.sha256[String(version)] = file.sha256;
    }
  }
  return next;
}

/** One page of the static site. */
function renderPage({ entry, revisions, version, current, siblings }) {
  const locale = entry.lang[0];
  const text = PAGE[locale] ?? PAGE.en;
  const title = label(entry, locale);
  const revision = revisions.get(version)?.get(locale);
  const origin = ZONE_ORIGIN[entry.zone] ?? ZONE_ORIGIN.eu;
  const canonical = `${origin}${legalPagePath(entry.doc, version === entry.current ? null : version)}`;
  const isDraft = entry.status === "draft";

  const summary = (version === current ? entry.changes : entry.changesHistory?.[version])?.[locale];

  const nav = siblings.map((document) => {
    const active = document.doc === entry.doc ? ' aria-current="page"' : "";
    return `<a href="${legalPagePath(document.doc)}"${active}>${escapeHtml(label(document, locale))}</a>`;
  });

  const versions =
    current > 1
      ? `<nav class="legal-versions" aria-label="${escapeHtml(text.versions)}"><span>${escapeHtml(
          text.versions,
        )}:</span>${Array.from({ length: current }, (_, index) => {
          const number = index + 1;
          const active = number === version ? ' aria-current="page"' : "";
          return `<a href="${legalPagePath(entry.doc, number)}"${active}>v${number}</a>`;
        }).join(" ")}</nav>`
      : "";

  const meta = isDraft
    ? `<p class="legal-plate legal-plate-draft">${escapeHtml(text.draft)}</p>
  <p class="legal-note">${escapeHtml(text.draftNote)}</p>`
    : `<p class="legal-meta"><span>${escapeHtml(text.version)} ${version}</span><span>${escapeHtml(
        text.effective,
      )} ${escapeHtml(entry.effective ?? "")}</span></p>`;

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(BRAND.name[locale] ?? BRAND.name.en)}</title>
<meta name="description" content="${escapeHtml(title)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
${isDraft ? '<meta name="robots" content="noindex">\n' : ""}<link rel="icon" href="/legal/assets/remuka-mark.svg" type="image/svg+xml">
<link rel="icon" href="/legal/assets/remuka-mark-dark.svg" type="image/svg+xml" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="/legal/assets/apple-touch-icon.png">
<link rel="stylesheet" href="/legal/assets/tokens.css">
<link rel="stylesheet" href="/legal/assets/legal.css">
</head>
<body>
<header class="legal-top">
  <a class="legal-brand" href="${escapeHtml(origin)}/">${escapeHtml(BRAND.name[locale] ?? BRAND.name.en)}</a>
  <nav class="legal-nav" aria-label="${escapeHtml(text.documents)}">
${nav.join("\n")}
  </nav>
</header>
<main class="legal-main" id="main" tabindex="-1">
  ${meta}${summary ? `\n  <p><strong>${text.changes}</strong> ${escapeHtml(summary)}</p>` : ""}
  ${versions}
  <article>${renderMarkdown(revision?.text ?? "")}</article>
</main>
<footer class="legal-footer">
  <a href="${escapeHtml(origin)}/">${escapeHtml(text.home)}</a>
  <span>${escapeHtml(BRAND.name[locale] ?? BRAND.name.en)}</span>
</footer>
</body>
</html>`;
}

/**
 * Everything the gate knows about the tree: index problems, file problems, and the pages
 * that would be written. It reads, never writes; `--check` is this plus a comparison of a
 * previous output.
 */
export function scanLegal(root = ROOT) {
  const problems = [];
  const add = (rule, message) => problems.push({ rule, message });
  const files = new Map();
  const documents = [];
  const result = { problems, index: null, indexText: null, indexChanged: false, files, documents };

  let index;
  try {
    index = readLegalIndex(root);
  } catch (error) {
    add("index", error.message);
    return result;
  }
  result.index = index;
  for (const problem of validateLegalIndex(index)) add("index", problem);
  if (!Array.isArray(index.documents)) return result;

  const byKey = new Map(
    index.documents
      .filter((entry) => entry?.zone && entry?.doc)
      .map((entry) => [`${entry.zone}/${entry.doc}`, entry]),
  );

  for (const entry of index.documents) {
    if (!entry?.zone || !entry?.doc || !Array.isArray(entry.lang) || !Number.isInteger(entry.current)) {
      continue;
    }
    const where = `${entry.zone}/${entry.doc}`;
    const { revisions, unexpected } = readLegalRevisions(root, entry);
    for (let version = 1; version <= entry.current; version++) {
      const sealed = entry.changesHistory?.[version];
      const file = revisions.get(version)?.get(entry.lang[0]);
      if (!sealed) {
        if ((version > 1 && version < entry.current) ||
            (version === entry.current && recordedHash(entry, version) && (version > 1 || entry.changes))) {
          add("changes", `${where}/v${version}: missing published changes history`);
        }
        continue;
      }
      if (!file || sealed.sha256 !== summaryDigest(file.sha256, sealed)) {
        add("changed", `${where}/v${version}: the published summary or its document changed`);
      }
      if (version === entry.current && (entry.status !== "published" ||
          !entry.changes || summaryDigest(file?.sha256, entry.changes) !== sealed.sha256)) {
        add("changed", `${where}/v${version}: publish a new revision to change its summary`);
      }
    }
    for (const name of unexpected) {
      add(
        "unindexed-file",
        `${LEGAL_CONTENT_DIR}/${where}/${name}: not a <version>.<lang>.md file, so no page or acceptance covers it`,
      );
    }
    for (const [version, languages] of revisions) {
      if (version > entry.current) {
        add(
          "unindexed-version",
          `${LEGAL_CONTENT_DIR}/${where}/${version}: newer than current ${entry.current} — bump the index or remove the file`,
        );
      }
      if (version < 1) {
        add("unindexed-version", `${LEGAL_CONTENT_DIR}/${where}/${version}: revision numbers start at 1`);
      }
      for (const lang of languages.keys()) {
        if (!entry.lang.includes(lang)) {
          add(
            "unindexed-file",
            `${LEGAL_CONTENT_DIR}/${where}/${version}.${lang}.md: the index publishes ${entry.lang.join(", ")} only`,
          );
        }
      }
    }
    for (let version = 1; version <= entry.current; version += 1) {
      for (const lang of entry.lang) {
        const file = revisions.get(version)?.get(lang);
        if (!file) {
          add(
            "missing-text",
            `${LEGAL_CONTENT_DIR}/${entry.zone}/${entry.doc}/${version}.${lang}.md: no text for revision ${version} (${entry.required})`,
          );
          continue;
        }
        if (!file.text.trim()) {
          add("empty-text", `${file.path}: the text is empty`);
          continue;
        }
        if (entry.status !== "published") continue;
        for (const finding of placeholderFindings(file.text)) {
          add(
            "placeholder",
            `${file.path}:${finding.line}: a published text still has ${finding.text} — fill it or keep the document a draft`,
          );
        }
        const recorded = recordedHash(entry, version);
        if (recorded && recorded !== file.sha256) {
          add(
            "changed",
            `${file.path}: the published revision changed (sha256 ${file.sha256.slice(
              0,
              12,
            )}…, recorded ${recorded.slice(0, 12)}…) — publish a new revision instead`,
          );
        }
      }
    }
    documents.push({ entry, revisions });
  }

  // Nothing outside the registry: a text the index does not name would never be built,
  // linked or accepted, and it would still look published in the tree.
  const contentDir = legalContentDir(root);
  if (!statSync(contentDir, { throwIfNoEntry: false })) {
    add("index", `${LEGAL_CONTENT_DIR}/ is missing`);
  } else {
    for (const name of readdirSync(contentDir).sort()) {
      if (name === "index.json" || name === "README.md") continue;
      const zoneDir = join(contentDir, name);
      if (!statSync(zoneDir).isDirectory()) {
        add("unindexed-file", `${LEGAL_CONTENT_DIR}/${name}: not a zone directory, index.json or README.md`);
        continue;
      }
      if (!LEGAL_ZONES.includes(name)) {
        add(
          "unindexed-zone",
          `${LEGAL_CONTENT_DIR}/${name}: unknown zone; documents live under ${LEGAL_ZONES.join(" or ")}`,
        );
        continue;
      }
      for (const doc of readdirSync(zoneDir).sort()) {
        if (!statSync(join(zoneDir, doc)).isDirectory()) {
          add("unindexed-document", `${LEGAL_CONTENT_DIR}/${name}/${doc}: a document must be a directory`);
          continue;
        }
        if (!byKey.has(`${name}/${doc}`)) {
          add("unindexed-document", `${LEGAL_CONTENT_DIR}/${name}/${doc}: the index does not name this document`);
        }
      }
    }
  }

  const nextIndex = recordHashes(index, documents);
  const indexText = `${JSON.stringify(nextIndex, null, 2)}\n`;
  result.indexText = indexText;
  // Semantic comparison, not text: the index is aligned by hand for readability, and a
  // build that reindents it on every run would bury the one hash it actually added.
  result.indexChanged = JSON.stringify(nextIndex) !== JSON.stringify(index);

  for (const { entry, revisions } of documents) {
    // Only a document whose current text exists gets a page: a broken tree is reported
    // above, and a page with an empty body would be a lie about what a person accepts.
    const siblings = legalDocuments(nextIndex, entry.zone);
    for (let version = 1; version <= entry.current; version += 1) {
      if (!revisions.get(version)?.get(entry.lang[0])) continue;
      const page = (path) =>
        files.set(path, renderPage({ entry, revisions, version, current: entry.current, siblings }));
      // The current revision answers at both addresses, so a journal row that names
      // `/legal/<doc>/v1` keeps working after v2 becomes current.
      if (version === entry.current) page(`${entry.zone}/${entry.doc}/index.html`);
      page(`${entry.zone}/${entry.doc}/v${version}/index.html`);
    }
  }

  const tokens = [
    "primitive.css",
    "semantic.css",
    "component.css",
    join("themes", "light.css"),
    join("themes", "dark.css"),
  ]
    .map((name) => readFileSync(join(ROOT, "packages/ui/src/tokens", name), "utf8"))
    .join("\n");
  const stylesheet = readFileSync(join(ROOT, "guide/theme/legal.css"), "utf8");
  const markLight = readMark();
  const markDark = readMark("dark");
  for (const zone of new Set(documents.map(({ entry }) => entry.zone))) {
    files.set(`${zone}/assets/tokens.css`, tokens);
    files.set(`${zone}/assets/legal.css`, stylesheet);
    // The old cached path keeps working and serves the same new mark (ADR-272).
    files.set(`${zone}/assets/remo-logo.svg`, markLight);
    files.set(`${zone}/assets/remuka-mark.svg`, markLight);
    files.set(`${zone}/assets/remuka-mark-dark.svg`, markDark);
    files.set(`${zone}/assets/apple-touch-icon.png`, readFileSync(APPLE_TOUCH));
  }

  return result;
}

/**
 * `--check` compares generated pages only when `legal-site/` exists: a clean checkout has
 * no generated output, and a gate that requires an ignored directory is a gate people skip.
 */
export function compareOutput(out, files) {
  if (!statSync(out, { throwIfNoEntry: false })) return [];
  const problems = [];
  const seen = new Set();
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory)) {
      if (name.startsWith(".")) continue;
      const full = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) {
        walk(full, relative);
        continue;
      }
      seen.add(relative);
      const content = files.get(relative);
      const current = readFileSync(full);
      if (content === undefined) {
        problems.push({ rule: "stale", message: `${relative} is not part of the build — run pnpm legal:build` });
        continue;
      }
      const same =
        typeof content === "string" ? current.toString("utf8") === content : current.equals(content);
      if (!same) problems.push({ rule: "stale", message: `${relative} is stale — run pnpm legal:build` });
    }
  };
  walk(out);
  for (const relative of files.keys()) {
    if (!seen.has(relative)) {
      problems.push({ rule: "stale", message: `${relative} is missing — run pnpm legal:build` });
    }
  }
  return problems;
}

function main(argv) {
  const check = argv.includes("--check");
  const outIndex = argv.indexOf("--out");
  const outArgument = outIndex === -1 ? null : argv[outIndex + 1];
  if (outIndex !== -1 && (!outArgument || outArgument.startsWith("--"))) {
    console.error("legal: --out needs a directory");
    process.exit(1);
  }
  const out = outArgument ? resolve(outArgument) : DEFAULT_OUT;

  const result = scanLegal();
  const problems = [...result.problems];
  if (check) {
    if (result.indexChanged && result.problems.length === 0) {
      problems.push({
        rule: "index",
        message: "content/legal/index.json is stale — run pnpm legal:build to record published hashes",
      });
    }
    // A broken source already says why; comparing generated pages then only adds noise.
    if (result.problems.length === 0) problems.push(...compareOutput(out, result.files));
  }

  if (problems.length) {
    console.error(`legal: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  ${problem.message}`);
    process.exit(1);
  }

  if (check) {
    console.log(
      `legal: ${result.documents.length} document(s), ${result.files.size} page file(s) current`,
    );
    return;
  }

  if (result.indexChanged) writeFileSync(legalIndexPath(ROOT), result.indexText);
  for (const [relative, content] of result.files) {
    const path = join(out, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  console.log(`legal: wrote ${result.files.size} file(s) for ${result.documents.length} document(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
