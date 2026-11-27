/**
 * `@remo/legal` — the registry of legal documents (ADR-256, `spec/legal-acceptance.md` §2).
 *
 * The texts are data in the repository, one file per zone, document and revision:
 * `content/legal/<zone>/<doc>/<version>.<lang>.md`. `content/legal/index.json` is the
 * registry: which revision is current, whether sign-up requires it and whether a new
 * revision must be accepted again. This module reads that pair; it never rewrites an index
 * or a text, so a caller cannot publish a document by accident.
 *
 * Two rules shape the model:
 *
 *   - A draft may be edited in place, so a draft has no recorded hash. A published
 *     revision never changes, so its SHA-256 lives in the index, per version, and the
 *     build refuses to replace it. The hash is over the exact UTF-8 bytes of the file,
 *     which is what the person reads on `/legal/<doc>` and what `POST /auth/register`
 *     receives in `acceptances` (§4).
 *   - A required document must have a text for every revision it declares. Nothing else
 *     makes "the server decides, not the form" true: the form can only show documents the
 *     registry names, and the server can only check documents that exist.
 *
 * Plain ESM with no build step, like `@remo/brand` and `@remo/consent`: the build, the
 * gate and (from stage 2) the service read the same module.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The zones that keep documents in this repository. `none` has no documents of its own. */
export const LEGAL_ZONES = Object.freeze(["eu", "ru"]);

/** The languages a text may be written in. A zone names the subset it publishes. */
export const LEGAL_LANGS = Object.freeze(["ru", "en"]);

/** `signup` means the document is a checkbox in the registration form (§2). */
export const LEGAL_REQUIRED = Object.freeze(["signup", "none"]);

/** A draft is editable; a published revision is immutable and has a recorded hash. */
export const LEGAL_STATUSES = Object.freeze(["draft", "published"]);

/** A document id is a path segment: lowercase latin, digits, single dashes. */
export const LEGAL_DOC_SLUG = /^[a-z][a-z0-9-]*$/;

/** A recorded SHA-256, lowercase hex. The API carries the same value it sees here. */
export const LEGAL_HASH = /^[a-f0-9]{64}$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The content directory, relative to the repository root. */
export const LEGAL_CONTENT_DIR = "content/legal";

/** The registry file inside the content directory. */
export const LEGAL_INDEX_FILE = "index.json";

/** `content/legal/`. */
export function legalContentDir(root) {
  return join(root, LEGAL_CONTENT_DIR);
}

/** `content/legal/index.json`. */
export function legalIndexPath(root) {
  return join(legalContentDir(root), LEGAL_INDEX_FILE);
}

/** The directory of one document: `content/legal/<zone>/<doc>/`. */
export function legalDocumentDir(root, zone, doc) {
  return join(legalContentDir(root), zone, doc);
}

/**
 * The file of one revision: `content/legal/<zone>/<doc>/<version>.<lang>.md`.
 *
 * The path is derived, never stored in the index: a stored path would let the index and
 * the tree disagree about where a text lives.
 */
export function legalDocumentPath(root, zone, doc, version, lang) {
  return join(legalDocumentDir(root, zone, doc), `${version}.${lang}.md`);
}

/** Read and parse the registry. A broken file is an error; `legal:check` reports it. */
export function readLegalIndex(root) {
  const path = legalIndexPath(root);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${path}: cannot read the legal index (${error.code ?? error.message})`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error.message})`);
  }
}

/** SHA-256 of the exact text, lowercase hex. This is the value a person accepts. */
export function legalTextSha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The text of one revision, as the person reads it. The caller owns the file's bytes. */
export function readLegalText(root, entry, version, lang) {
  return readFileSync(legalDocumentPath(root, entry.zone, entry.doc, version, lang), "utf8");
}

/**
 * Every file of a document, grouped by revision and language.
 *
 * `unexpected` names files that are not `<version>.<lang>.md`: a stray file in the
 * document directory means a text that no page and no gate would cover, which is exactly
 * what the registry exists to prevent.
 */
export function readLegalRevisions(root, entry) {
  const directory = legalDocumentDir(root, entry.zone, entry.doc);
  const revisions = new Map();
  const unexpected = [];
  if (!existsSync(directory)) return { revisions, unexpected };
  for (const name of readdirSync(directory).sort()) {
    // Editors and the Finder drop hidden files next to the texts; they are not documents.
    if (name.startsWith(".")) continue;
    const match = /^(\d+)\.([a-z]{2})\.md$/.exec(name);
    if (!match || !LEGAL_LANGS.includes(match[2]) || match[1] !== String(Number(match[1]))) {
      unexpected.push(name);
      continue;
    }
    const version = Number(match[1]);
    const lang = match[2];
    const text = readFileSync(join(directory, name), "utf8");
    if (!revisions.has(version)) revisions.set(version, new Map());
    revisions.get(version).set(lang, {
      path: `content/legal/${entry.zone}/${entry.doc}/${name}`,
      text,
      sha256: legalTextSha256(text),
    });
  }
  return { revisions, unexpected };
}

/** The documents of one zone. A zone with no documents is empty, not an error. */
export function legalDocuments(index, zone) {
  return (index?.documents ?? []).filter((entry) => entry.zone === zone);
}

/** One document of one zone, or null. */
export function legalDocument(index, zone, doc) {
  return legalDocuments(index, zone).find((entry) => entry.doc === doc) ?? null;
}

/** The documents the registration form must ask for in a zone (§2). */
export function signupDocuments(index, zone) {
  return legalDocuments(index, zone).filter((entry) => entry.required === "signup");
}

/**
 * Documents that are required at sign-up but still drafts.
 *
 * A production installation refuses to start while this is non-empty, unless the operator
 * sets `REMO_LEGAL_ALLOW_DRAFTS=1` for a test stand (§2). The rule is here so the service
 * and the test read one definition.
 */
export function draftSignupDocuments(index, zone) {
  return signupDocuments(index, zone).filter((entry) => entry.status === "draft");
}

/** The recorded hash of one revision, or null when the revision is not fixed yet. */
export function recordedHash(entry, version) {
  return entry?.sha256?.[String(version)] ?? null;
}

/** A document's title in the page language, falling back to whatever language it has. */
export function legalTitle(entry, locale) {
  const title = entry?.title ?? {};
  return title[locale] || Object.values(title).find((value) => value) || entry?.doc || "";
}

/** `/legal/<doc>` for the current revision, `/legal/<doc>/v<N>` for an older one (§2). */
export function legalPagePath(doc, version = null) {
  return version ? `/legal/${doc}/v${version}` : `/legal/${doc}`;
}

/** The absolute address of a document page on the site of its installation. */
export function legalPageUrl(origin, doc, version = null) {
  return `${String(origin).replace(/\/+$/, "")}${legalPagePath(doc, version)}`;
}

/**
 * `[...]` placeholders that a lawyer or the operator still has to fill.
 *
 * A published revision may not carry one: an unfilled name, OGRNIP or date in a text that
 * people accept is not a document (§2, acceptance). Drafts carry them by design.
 */
export function placeholderFindings(text) {
  const findings = [];
  const lines = String(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(/\[[^\]\n]*\]/g)) {
      findings.push({ line: index + 1, text: match[0] });
    }
  }
  return findings;
}

/**
 * The registry's own invariants, as messages for the gate.
 *
 * These are index rules only; whether the files exist and whether a published hash still
 * matches is a filesystem question and belongs to `pnpm legal:check`.
 */
export function validateLegalIndex(index) {
  const problems = [];
  const documents = index?.documents;
  if (!Array.isArray(documents) || documents.length === 0) {
    return ["index: `documents` must be a non-empty array"];
  }
  const seen = new Set();
  for (const [position, entry] of documents.entries()) {
    const label = entry?.doc ? `${entry.zone ?? "?"}/${entry.doc}` : `documents[${position}]`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${label}: must be an object`);
      continue;
    }
    if (!LEGAL_ZONES.includes(entry.zone)) {
      problems.push(`${label}: zone must be one of ${LEGAL_ZONES.join(", ")}`);
    }
    if (typeof entry.doc !== "string" || !LEGAL_DOC_SLUG.test(entry.doc)) {
      problems.push(`${label}: doc must be a lowercase latin path segment`);
    }
    if (entry.zone && entry.doc) {
      const key = `${entry.zone}/${entry.doc}`;
      if (seen.has(key)) problems.push(`${label}: duplicate document for this zone`);
      seen.add(key);
    }
    if (!Number.isInteger(entry.current) || entry.current < 1) {
      problems.push(`${label}: current must be a whole number of at least 1`);
    }
    if (!LEGAL_STATUSES.includes(entry.status)) {
      problems.push(`${label}: status must be one of ${LEGAL_STATUSES.join(", ")}`);
    }
    if (!LEGAL_REQUIRED.includes(entry.required)) {
      problems.push(`${label}: required must be one of ${LEGAL_REQUIRED.join(", ")}`);
    }
    if (typeof entry.reaccept !== "boolean") {
      problems.push(`${label}: reaccept must be a boolean`);
    }
    // Withdrawal is a legal property, not a UI preference: a document that rests on a
    // contract has no separate consent to withdraw (§6). Missing means "not withdrawable".
    if (entry.withdrawable !== undefined && typeof entry.withdrawable !== "boolean") {
      problems.push(`${label}: withdrawable must be a boolean when present`);
    }
    if (!Array.isArray(entry.lang) || entry.lang.length === 0) {
      problems.push(`${label}: lang must name at least one language`);
    } else {
      for (const lang of entry.lang) {
        if (!LEGAL_LANGS.includes(lang)) {
          problems.push(`${label}: unknown language ${JSON.stringify(lang)}`);
        }
      }
      // One revision is one text, and the journal records one SHA-256 for it (§4).
      // A bilingual document would need a hash per language; that is a model change,
      // not a second array entry.
      if (entry.lang.length !== 1) {
        problems.push(`${label}: lang must name exactly one language (one text per revision)`);
      }
    }
    if (entry.effective !== null && entry.effective !== undefined) {
      if (typeof entry.effective !== "string" || !ISO_DATE.test(entry.effective)) {
        problems.push(`${label}: effective must be a YYYY-MM-DD date or null`);
      } else if (Number.isNaN(new Date(`${entry.effective}T00:00:00Z`).getTime())) {
        problems.push(`${label}: effective is not a real date`);
      }
    }
    if (entry.status === "published" && !entry.effective) {
      problems.push(`${label}: a published document needs an effective date`);
    }
    if (Array.isArray(entry.lang)) {
      for (const lang of entry.lang) {
        if (LEGAL_LANGS.includes(lang) && !entry.title?.[lang]) {
          problems.push(`${label}: title is missing ${lang}`);
        }
      }
    }
    const summary = entry.changes;
    if (summary !== undefined || (entry.status === "published" && entry.current > 1)) {
      const lang = entry.lang?.[0];
      if (!summary || typeof summary !== "object" || Array.isArray(summary) || !summary[lang]) {
        problems.push(`${label}: changes must include a short summary in ${lang}`);
      } else {
        for (const [locale, text] of Object.entries(summary)) {
          if (!LEGAL_LANGS.includes(locale) || typeof text !== "string" || !text.trim() ||
              [...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text)].length > 3) {
            problems.push(`${label}: changes must contain one to three short sentences per language`);
          }
        }
      }
    }
    if (entry.changesHistory !== undefined && (!entry.changesHistory || typeof entry.changesHistory !== "object" ||
        Array.isArray(entry.changesHistory) || Object.keys(entry.changesHistory).some(key =>
          !/^[1-9]\d*$/.test(key) || Number(key) > entry.current))) {
      problems.push(`${label}: changesHistory must map past or current revision numbers to sealed summaries`);
    }
    if (entry.sha256 !== undefined) {
      if (!entry.sha256 || typeof entry.sha256 !== "object" || Array.isArray(entry.sha256)) {
        problems.push(`${label}: sha256 must map a revision number to its hash`);
      } else {
        for (const [version, hash] of Object.entries(entry.sha256)) {
          const number = Number(version);
          if (!Number.isInteger(number) || number < 1) {
            problems.push(`${label}: sha256 has a non-revision key ${JSON.stringify(version)}`);
          } else if (Number.isInteger(entry.current) && number > entry.current) {
            problems.push(`${label}: sha256 records revision ${version} beyond current`);
          }
          if (typeof hash !== "string" || !LEGAL_HASH.test(hash)) {
            problems.push(`${label}: sha256[${version}] is not a lowercase SHA-256`);
          }
        }
        if (
          entry.status === "draft" &&
          Number.isInteger(entry.current) &&
          recordedHash(entry, entry.current)
        ) {
          problems.push(
            `${label}: a draft revision must not carry a fixed hash — clear sha256[${entry.current}]`,
          );
        }
      }
    }
  }
  return problems;
}
