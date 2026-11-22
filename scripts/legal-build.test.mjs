import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { legalTextSha256 } from "../packages/legal/src/index.mjs";
import { compareOutput, recordHashes, scanLegal } from "./legal-build.mjs";

const TEXT = "# Согласие\n\nТекст согласия.\n";
const HASH = legalTextSha256(TEXT);

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "legal-build-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof text === "string" ? text : JSON.stringify(text));
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

function fixture(documents, files = {}) {
  return tree({
    "content/legal/index.json": `${JSON.stringify({ documents }, null, 2)}\n`,
    "content/legal/ru/consent/1.ru.md": TEXT,
    ...files,
  });
}

function rules(result) {
  return result.problems.map((problem) => problem.rule);
}

describe("the legal tree gate (§2, acceptance)", () => {
  it("passes the shipped shape: one required draft with a text", () => {
    const result = scanLegal(fixture([entry()]));
    expect(result.problems).toEqual([]);
    expect(result.indexChanged).toBe(false);
  });

  it("renders /legal/<doc> with the draft plate and noindex", () => {
    const result = scanLegal(fixture([entry()]));
    const page = result.files.get("ru/consent/index.html");
    expect(page).toContain("Черновик");
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain('<link rel="canonical" href="https://remuka.ru/legal/consent">');
    expect(page).toContain("Текст согласия.");
    // The same revision also answers at its numbered address, so a journal row that
    // names `/legal/<doc>/v1` keeps working after a later revision.
    expect(result.files.get("ru/consent/v1/index.html")).toContain("Текст согласия.");
  });

  it("keeps an earlier revision at /legal/<doc>/v<N>", () => {
    const published = entry({
      current: 2,
      status: "published",
      effective: "2027-01-01",
      sha256: { 1: HASH, 2: HASH },
    });
    const result = scanLegal(
      fixture([published], { "content/legal/ru/consent/2.ru.md": TEXT }),
    );
    expect(result.problems).toEqual([]);
    expect(result.files.has("ru/consent/index.html")).toBe(true);
    expect(result.files.get("ru/consent/v1/index.html")).toContain("Редакция 1");
  });

  it("fails a required document without a text", () => {
    const result = scanLegal(
      fixture([entry()], { "content/legal/ru/consent/1.ru.md": "" }),
    );
    expect(rules(result)).toContain("empty-text");
  });

  it("fails a revision file the index does not name", () => {
    const result = scanLegal(fixture([entry()], { "content/legal/ru/consent/2.ru.md": TEXT }));
    expect(rules(result)).toContain("unindexed-version");
  });

  it("fails a document directory the index does not name", () => {
    const result = scanLegal(
      fixture([entry()], { "content/legal/ru/extra/1.ru.md": TEXT }),
    );
    expect(rules(result)).toContain("unindexed-document");
  });

  it("fails a text in a language the index does not publish", () => {
    const result = scanLegal(
      fixture([entry()], { "content/legal/ru/consent/1.en.md": TEXT }),
    );
    expect(rules(result)).toContain("unindexed-file");
  });
});

describe("published revisions are immutable (§2)", () => {
  const published = (overrides = {}) =>
    entry({ status: "published", effective: "2026-12-01", sha256: { 1: HASH }, ...overrides });

  it("passes when the recorded hash matches the text", () => {
    expect(scanLegal(fixture([published()])).problems).toEqual([]);
  });

  it("fails when the published text changed, and names the file", () => {
    const result = scanLegal(
      fixture([published()], { "content/legal/ru/consent/1.ru.md": `${TEXT}Правка.\n` }),
    );
    const changed = result.problems.find((problem) => problem.rule === "changed");
    expect(changed?.message).toContain("content/legal/ru/consent/1.ru.md");
    expect(changed?.message).toContain("publish a new revision instead");
  });

  it("does not repair a changed published hash while building", () => {
    const index = { documents: [published()] };
    const result = recordHashes(index, [
      {
        entry: index.documents[0],
        revisions: new Map([
          [1, new Map([["ru", { sha256: legalTextSha256("other") }]])],
        ]),
      },
    ]);
    expect(result.documents[0].sha256[1]).toBe(HASH);
  });

  it("fails a published text that still has a placeholder, with its line", () => {
    const withPlaceholder = "# Согласие\n\nИП [ФИО].\n";
    const result = scanLegal(
      fixture(
        [published({ sha256: { 1: legalTextSha256(withPlaceholder) } })],
        { "content/legal/ru/consent/1.ru.md": withPlaceholder },
      ),
    );
    const placeholder = result.problems.find((problem) => problem.rule === "placeholder");
    expect(placeholder?.message).toContain(":3:");
    expect(placeholder?.message).toContain("[ФИО]");
  });

  it("records a missing hash on build and reports it as stale on check", () => {
    const result = scanLegal(fixture([entry({ status: "published", effective: "2026-12-01" })]));
    expect(result.problems).toEqual([]);
    expect(result.indexChanged).toBe(true);
    expect(result.indexText).toContain(HASH);
  });

  it("passes once the build has written the recorded hash", () => {
    const root = fixture([entry({ status: "published", effective: "2026-12-01" })]);
    const first = scanLegal(root);
    writeFileSync(join(root, "content/legal/index.json"), first.indexText);
    const second = scanLegal(root);
    expect(second.problems).toEqual([]);
    expect(second.indexChanged).toBe(false);
  });

  it("refuses a fixed hash on a draft", () => {
    const result = scanLegal(fixture([entry({ sha256: { 1: HASH } })]));
    expect(rules(result)).toContain("index");
  });
});

describe("the generated output comparison", () => {
  it("accepts a matching tree and reports a missing or stale file", () => {
    const out = tree({ "ru/consent/index.html": "old" });
    const stale = compareOutput(out, new Map([["ru/consent/index.html", "new"]]));
    expect(stale.map((problem) => problem.rule)).toEqual(["stale"]);
    expect(compareOutput(tree({}), new Map([["ru/consent/index.html", "new"]])).map((p) => p.message)).toEqual([
      "ru/consent/index.html is missing — run pnpm legal:build",
    ]);
    expect(compareOutput(join(out, "nope"), new Map())).toEqual([]);
  });

  it("reports a file that the build no longer produces", () => {
    const out = tree({ "ru/consent/index.html": "same", "ru/removed/index.html": "gone" });
    const problems = compareOutput(out, new Map([["ru/consent/index.html", "same"]]));
    expect(problems.map((problem) => problem.message)).toEqual([
      "ru/removed/index.html is not part of the build — run pnpm legal:build",
    ]);
  });
});
