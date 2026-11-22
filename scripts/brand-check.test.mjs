import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanBrand, surfaceFiles } from "./brand-check.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "brand-check-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function findings(root, options) {
  return scanBrand(root, options).problems.map(
    (problem) => `${problem.file}:${problem.line}:${problem.term}`,
  );
}

describe("brand check", () => {
  it("passes a clean tree and reports the files it read", () => {
    const root = tree({
      "apps/web/src/i18n/ru-core.ts": 'export const core = { title: "Ремука" };\n',
      "apps/web/src/Panel.tsx": "export const Panel = () => <p>Комнаты Ремуки</p>;\n",
      "README.md": "# Ремука (Remuka)\n\nA shared visual canvas.\n",
      "deploy/support/README.md": "The operator's side of the support surface.\n",
    });
    const result = scanBrand(root);
    expect(result.problems).toEqual([]);
    expect(result.files).toBe(4);
    expect(result.allowed).toBe(0);
  });

  it("fails the old name in a user-facing string and in JSX text", () => {
    const root = tree({
      "apps/web/src/i18n/ru-work.ts": 'export const work = { saved: "remo сохраняет правки" };\n',
      "apps/web/src/Hint.tsx": "export const Hint = () => <p>Создано в remo</p>;\n",
    });
    expect(findings(root)).toEqual([
      "apps/web/src/Hint.tsx:1:remo",
      "apps/web/src/i18n/ru-work.ts:1:remo",
    ]);
  });

  it("fails the old name in Cyrillic", () => {
    const root = tree({
      "guide/overview/index/ru.md": "## Для чего нужен РЕМО\n",
    });
    expect(findings(root)).toEqual(["guide/overview/index/ru.md:1:РЕМО"]);
  });

  it("ignores comments, fenced blocks and inline code", () => {
    const root = tree({
      "apps/web/src/Panel.tsx": '// the remo origin\nconst label = "Ремука";\n/* remo */\n',
      "guide/how-to/account/ru.md":
        "```bash\nsystemctl restart remo-sync\n```\n\nЗапуск `remo` описан выше.\n",
    });
    expect(findings(root)).toEqual([]);
  });

  it("lets code identifiers through, but not a second word on the same line", () => {
    const root = tree({
      "apps/web/src/A.tsx": [
        'import { BRAND } from "@remo/brand";',
        'localStorage.setItem("remo.lang", "ru");',
        'const signature = "X-Remo-Signature";',
        'const dir = "/srv/remo";',
        'const backup = "remo.board.backup";',
        'const channel = "remo:support:ready";',
        'const topic = "about.remo";',
        'const origin = "REMO_APP_ORIGIN";',
        "",
      ].join("\n"),
    });
    expect(findings(root)).toEqual([]);
    expect(scanBrand(root).allowed).toBeGreaterThan(0);

    const mixed = tree({
      "apps/web/src/B.tsx": 'const label = "remo and @remo/ui";\n',
    });
    expect(findings(mixed)).toEqual(["apps/web/src/B.tsx:1:remo"]);
  });

  it("fails an old address in deploy/support prose", () => {
    const root = tree({
      "deploy/support/README.md": "Open https://remo.letii.ru/help to reach the help page.\n",
    });
    expect(findings(root)).toEqual(["deploy/support/README.md:1:remo.letii.ru"]);
  });

  it("does not read spec, ADR.md, CHANGELOG or tests", () => {
    const root = tree({
      "spec/rebrand.md": "Переезд с remo.letii.ru на remuka.com.\n",
      "ADR.md": "## ADR-254 — remo becomes Remuka\n",
      "CHANGELOG.md": "The remo rename lands in 0.9.0.\n",
      "apps/web/src/A.test.tsx": 'it("renders remo", () => {});\n',
      "apps/web/src/fixtures/old.json": '{"name": "remo"}\n',
    });
    expect(surfaceFiles(root)).toEqual([]);
    expect(findings(root)).toEqual([]);
  });

  it("allows the one history line until its date and then asks to remove it", () => {
    const root = tree({
      "README.md": "# Ремука (Remuka)\n\nРемука (раньше remo) — визуальный холст.\n",
    });
    expect(findings(root, { today: new Date("2026-11-22") })).toEqual([]);
    expect(findings(root, { today: new Date("2027-07-01") })).toEqual([
      "README.md:3:remo",
    ]);
  });

  it("reads mail templates and the support widget, not only components", () => {
    const root = tree({
      "apps/sync/mail-templates.mjs": 'export const subject = (name) => `${name} — remo`;\n',
      "deploy/support/widget.html": "<title>remo support</title>\n",
    });
    expect(findings(root)).toEqual([
      "apps/sync/mail-templates.mjs:1:remo",
      "deploy/support/widget.html:1:remo",
    ]);
  });

  it("reports file, line, term and a reason", () => {
    const root = tree({
      "content/help/rooms.create/en.md": "Line one.\n\nRooms are made in remo.\n",
    });
    const [problem] = scanBrand(root).problems;
    expect(problem).toMatchObject({
      file: "content/help/rooms.create/en.md",
      line: 3,
      term: "remo",
    });
    expect(problem.why).toContain("ADR-254");
  });

  it("fails the old host in every tracked file, not only the surfaces", () => {
    const root = tree({
      "e2e/legacy-note.txt": "Open https://remo.letii.ru/help during the move.\n",
      "deploy/note.md": "Old host: https://letii.ru\n",
    });
    expect(findings(root)).toEqual(["deploy/note.md:1:letii.ru", "e2e/legacy-note.txt:1:remo.letii.ru"]);
  });

  it("allows the listed old-host exceptions and explains why", () => {
    const root = tree({
      "spec/rebrand.md": "Переезд с remo.letii.ru на remuka.com.\n",
      "ADR.md": "## ADR-254 — remo.letii.ru becomes app.remuka.com\n",
      "CHANGELOG.md": "Moved from remo.letii.ru to app.remuka.com.\n",
      "guide/support/changelog/ru.md": "Адрес сменился: remo.letii.ru → app.remuka.com.\n",
      "apps/sync/origins.test.mjs": 'const old = "https://remo.letii.ru";\n',
      "scripts/brand-check.mjs": 'const OLD = /\\bletii\\.ru\\b/;\n',
    });
    expect(findings(root)).toEqual([]);
  });

  it("allows the old host in a production example only on the alias line", () => {
    const allowed = tree({
      "deploy/production.env.example":
        "# REMO_APP_ORIGIN_ALIASES=https://remo.letii.ru\nREMO_APP_ORIGIN=https://app.remuka.com\n",
    });
    expect(findings(allowed)).toEqual([]);

    const stray = tree({
      "deploy/production.env.example":
        "# REMO_APP_ORIGIN_ALIASES=https://remo.letii.ru\nREMO_CORS_ORIGIN=https://remo.letii.ru\n",
    });
    expect(findings(stray)).toEqual(["deploy/production.env.example:2:remo.letii.ru"]);
  });

  it("reads plain .ts and service .mjs modules for the old name", () => {
    const root = tree({
      "apps/web/src/plain.ts": 'export const label = "Работает на remo";\n',
      "apps/sync/job.mjs": 'export const done = "Сделано в remo";\n',
      "apps/sync/job.test.mjs": 'it("starts remo", () => {});\n',
      "apps/web/src/topics.generated.ts": 'export const text = "В remo";\n',
    });
    expect(findings(root)).toEqual(["apps/sync/job.mjs:1:remo", "apps/web/src/plain.ts:1:remo"]);
  });

  it("fails the brand written out in code and points at @remo/brand", () => {
    const root = tree({
      "apps/web/src/about.ts": 'export const source = "https://github.com/jaggalex/remo";\n',
      "scripts/guide.mjs": 'export const title = "Remuka documentation";\n',
    });
    expect(findings(root)).toEqual([
      "apps/web/src/about.ts:1:remo",
      "apps/web/src/about.ts:1:github.com/jaggalex/remo",
      "scripts/guide.mjs:1:Remuka",
    ]);
    const [problem] = scanBrand(root).problems.filter((entry) => entry.term === "Remuka");
    expect(problem.why).toContain("@remo/brand");
  });

  it("allows the brand in interface copy and in the brand module itself", () => {
    const root = tree({
      "apps/web/src/i18n/ru-core.ts": 'export const core = { title: "Ремука" };\n',
      "apps/web/src/i18n/en-core.ts": 'export const core = { site: "remuka.com" };\n',
      "apps/web/src/about.ts": 'import { BRAND } from "@remo/brand";\nexport const source = BRAND.repo.url;\n',
      "apps/sync/mail.mjs": 'const host = BRAND.domains.app;\n',
    });
    expect(findings(root)).toEqual([]);
  });
});
