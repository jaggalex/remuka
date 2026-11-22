import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  draftSignupDocuments,
  legalDocument,
  legalPagePath,
  legalPageUrl,
  legalTextSha256,
  legalTitle,
  placeholderFindings,
  readLegalRevisions,
  recordedHash,
  signupDocuments,
  validateLegalIndex,
} from "./index.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "legal-registry-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function entry(overrides = {}) {
  return {
    zone: "ru",
    doc: "consent",
    title: { ru: "Согласие" },
    current: 1,
    status: "draft",
    effective: null,
    required: "signup",
    reaccept: true,
    lang: ["ru"],
    ...overrides,
  };
}

const TEXT = "# Согласие\n\nТекст согласия.\n";

describe("the legal index (ADR-256 §2)", () => {
  it("accepts the draft the repository ships", () => {
    expect(validateLegalIndex({ documents: [entry()] })).toEqual([]);
  });

  it("fails a duplicate document in one zone", () => {
    expect(validateLegalIndex({ documents: [entry(), entry()] })).toContain(
      "ru/consent: duplicate document for this zone",
    );
  });

  it("fails a zone that has no documents in this repository", () => {
    const problems = validateLegalIndex({ documents: [entry({ zone: "none" })] });
    expect(problems.some((problem) => problem.includes("zone must be one of eu, ru"))).toBe(true);
  });

  it("requires exactly one language per revision", () => {
    const problems = validateLegalIndex({ documents: [entry({ lang: ["ru", "en"], title: { ru: "A", en: "B" } })] });
    expect(problems).toContain("ru/consent: lang must name exactly one language (one text per revision)");
  });

  it("requires a title in the language of the text", () => {
    expect(validateLegalIndex({ documents: [entry({ title: {} })] })).toContain(
      "ru/consent: title is missing ru",
    );
  });

  it("requires an effective date once a document is published", () => {
    const problems = validateLegalIndex({
      documents: [entry({ status: "published", sha256: { 1: "a".repeat(64) } })],
    });
    expect(problems).toContain("ru/consent: a published document needs an effective date");
  });

  it("lets the build record a published revision the index has not fixed yet", () => {
    // Publishing is: set status/effective, run `pnpm legal:build`; the build writes the
    // hash. The check reports the missing hash as a stale index, not as a broken one.
    expect(
      validateLegalIndex({ documents: [entry({ status: "published", effective: "2026-12-01" })] }),
    ).toEqual([]);
  });

  it("fails a recorded hash that is not a SHA-256", () => {
    expect(validateLegalIndex({ documents: [entry({ sha256: { 1: "abc" } })] })).toContain(
      "ru/consent: sha256[1] is not a lowercase SHA-256",
    );
  });

  it("refuses a fixed hash on a draft revision", () => {
    const problems = validateLegalIndex({ documents: [entry({ sha256: { 1: "b".repeat(64) } })] });
    expect(problems).toContain(
      "ru/consent: a draft revision must not carry a fixed hash — clear sha256[1]",
    );
  });
});

describe("sign-up documents by zone (§2)", () => {
  const index = {
    documents: [
      entry(),
      entry({ doc: "privacy", required: "none" }),
      entry({ doc: "terms", zone: "eu", lang: ["en"], title: { en: "Terms" } }),
      entry({ doc: "privacy-eu", zone: "eu", lang: ["en"], title: { en: "Privacy" }, required: "none" }),
    ],
  };

  it("asks the Russian zone for the documents with required: signup", () => {
    expect(signupDocuments(index, "ru").map((document) => document.doc)).toEqual(["consent"]);
    expect(signupDocuments(index, "eu").map((document) => document.doc)).toEqual(["terms"]);
  });

  it("finds the drafts a production start must refuse", () => {
    expect(draftSignupDocuments(index, "ru").map((document) => document.doc)).toEqual(["consent"]);
    expect(draftSignupDocuments({ documents: [entry({ status: "published", effective: "2026-12-01", sha256: { 1: "c".repeat(64) } })] }, "ru")).toEqual([]);
  });

  it("returns no documents for the self-host zone", () => {
    expect(signupDocuments(index, "none")).toEqual([]);
  });

  it("finds one document or null, never a guess", () => {
    expect(legalDocument(index, "ru", "consent")?.doc).toBe("consent");
    expect(legalDocument(index, "ru", "terms")).toBeNull();
  });
});

describe("revisions and hashes", () => {
  it("reads every revision, groups by language and keeps stray files apart", () => {
    const root = tree({
      "content/legal/ru/consent/1.ru.md": TEXT,
      "content/legal/ru/consent/2.ru.md": "# Согласие\n\nНовая редакция.\n",
      "content/legal/ru/consent/notes.txt": "not a text",
    });
    const { revisions, unexpected } = readLegalRevisions(root, entry());
    expect([...revisions.keys()]).toEqual([1, 2]);
    expect(revisions.get(1).get("ru").sha256).toBe(legalTextSha256(TEXT));
    expect(unexpected).toEqual(["notes.txt"]);
  });

  it("rejects a non-canonical revision name and ignores editor droppings", () => {
    const root = tree({
      "content/legal/ru/consent/01.ru.md": TEXT,
      "content/legal/ru/consent/.DS_Store": "finder",
    });
    const { revisions, unexpected } = readLegalRevisions(root, entry());
    expect([...revisions.keys()]).toEqual([]);
    expect(unexpected).toEqual(["01.ru.md"]);
  });

  it("hashes the exact bytes a person reads", () => {
    expect(legalTextSha256("abc")).toBe(
      createHash("sha256").update("abc", "utf8").digest("hex"),
    );
  });

  it("returns the recorded hash of one revision only", () => {
    const document = entry({ sha256: { 1: "d".repeat(64) } });
    expect(recordedHash(document, 1)).toBe("d".repeat(64));
    expect(recordedHash(document, 2)).toBeNull();
    expect(recordedHash(entry(), 1)).toBeNull();
  });

  it("falls back to the title the document has when the page language is missing", () => {
    expect(legalTitle(entry(), "ru")).toBe("Согласие");
    expect(legalTitle(entry(), "en")).toBe("Согласие");
    expect(legalTitle({ doc: "consent", title: {} }, "ru")).toBe("consent");
  });
});

describe("document pages (§2)", () => {
  it("names the current revision and an older one", () => {
    expect(legalPagePath("consent")).toBe("/legal/consent");
    expect(legalPagePath("consent", 1)).toBe("/legal/consent/v1");
  });

  it("builds an absolute address without a double slash", () => {
    expect(legalPageUrl("https://remuka.ru", "privacy")).toBe("https://remuka.ru/legal/privacy");
    expect(legalPageUrl("https://remuka.ru/", "privacy", 2)).toBe(
      "https://remuka.ru/legal/privacy/v2",
    );
  });
});

describe("placeholders (§2, acceptance)", () => {
  it("names the line of every unfilled bracket", () => {
    expect(placeholderFindings("ИП [ФИО]\nОГРНИП [номер], ИНН [номер]\n")).toEqual([
      { line: 1, text: "[ФИО]" },
      { line: 2, text: "[номер]" },
      { line: 2, text: "[номер]" },
    ]);
  });

  it("finds nothing in a finished text", () => {
    expect(placeholderFindings("ИП Иванов Иван Иванович, ОГРНИП 123.\n")).toEqual([]);
  });
});
