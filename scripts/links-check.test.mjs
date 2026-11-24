import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { linkedFiles, scanLinks } from "./links-check.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "links-check-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function findings(root) {
  return scanLinks(root).problems.map((problem) => `${problem.file}:${problem.line}:${problem.host}`);
}

describe("links check (ADR-284)", () => {
  it("passes a tree that takes the guide from the config", () => {
    const root = tree({
      "apps/web/src/Guide.tsx": 'const href = docsHref(docsOrigin, "/guide/ru/overview/index.html");\n',
      "content/help/about.remo/ru.md": "Полное руководство: [руководство]({{docs}}/guide/ru/overview/index.html).\n",
    });
    const result = scanLinks(root);
    expect(result.problems).toEqual([]);
    expect(result.files).toBe(2);
  });

  it("fails a guide host written into a component", () => {
    const root = tree({
      "apps/web/src/Guide.tsx":
        'const href = "https://docs.remuka.com/guide/ru/support/disclaimer.html";\n',
    });
    expect(findings(root)).toEqual(["apps/web/src/Guide.tsx:1:docs.remuka.com"]);
  });

  it("fails a guide host written into the in-app help, once per line", () => {
    const root = tree({
      "content/help/about.remo/ru.md":
        "Гайд: [docs.remuka.com/guide/ru/x.html](https://docs.remuka.com/guide/ru/x.html).\n",
    });
    expect(findings(root)).toEqual(["content/help/about.remo/ru.md:1:docs.remuka.com"]);
  });

  it("leaves the brand module, the legal texts, tests and generated output alone", () => {
    const root = tree({
      "apps/web/src/Guide.test.tsx": 'expect("https://docs.remuka.com").toBeTruthy();\n',
      "apps/web/src/help/generated.json": '"href": "https://docs.remuka.com/guide/ru/x.html"\n',
    });
    expect(findings(root)).toEqual([]);
    expect(linkedFiles(root)).toEqual([]);
  });
});
