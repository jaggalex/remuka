import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanConsent } from "./consent-check.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "consent-check-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A minimal valid record; the tests vary one field at a time. */
function record(name, kind = "localStorage", category = "necessary", owner = "web") {
  return {
    name,
    kind,
    category,
    owner,
    purpose: { ru: "Назначение", en: "Purpose" },
    lifetime: "1 day",
  };
}

function findings(root, registry) {
  return scanConsent(root, { registry }).problems;
}

function ofRule(problems, rule) {
  return problems.filter((problem) => problem.rule === rule);
}

describe("consent check: storage keys (§8 rule 2)", () => {
  it("passes a key that has a registry record", () => {
    const root = tree({
      "apps/web/src/Store.ts": 'const KEY = "remo.lang";\nlocalStorage.setItem(KEY, "ru");\n',
    });
    expect(findings(root, [record("remo.lang")])).toEqual([]);
  });

  it("fails a key that has no registry record", () => {
    const root = tree({
      "apps/web/src/Store.ts": 'localStorage.setItem("remo.unknown", "1");\n',
    });
    const unregistered = ofRule(findings(root, [record("remo.known")]), "unregistered");
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0]).toMatchObject({
      file: "apps/web/src/Store.ts",
      line: 1,
      name: "remo.unknown",
      kind: "localStorage",
    });
    expect(unregistered[0].why).toContain("registry");
  });

  it("resolves a key held in a constant and a helper-built template", () => {
    const root = tree({
      "apps/web/src/Banner.ts":
        'const PREFIX = "remo.verifyBanner.";\n' +
        "function bannerKey(userId) {\n" +
        "  return `${PREFIX}${userId}`;\n" +
        "}\n" +
        'sessionStorage.setItem(bannerKey("u-1"), "1");\n',
    });
    const problems = findings(root, [record("remo.verifyBanner.*", "sessionStorage", "preferences")]);
    expect(problems).toEqual([]);
  });

  it("reads the receiver kind, and accepts a Storage passed as a parameter", () => {
    const root = tree({
      "apps/web/src/Move.ts":
        'export const KEY = "remo.moveBanner.dismissed";\n' +
        "export function dismissed(storage = globalThis.sessionStorage) {\n" +
        "  return storage.getItem(KEY) === \"1\";\n" +
        "}\n",
    });
    expect(findings(root, [record("remo.moveBanner.dismissed", "sessionStorage")])).toEqual([]);
  });

  it("fails a key it cannot resolve instead of guessing", () => {
    const root = tree({
      "apps/web/src/Dynamic.ts": "localStorage.setItem(window.name, \"1\");\n",
    });
    const unresolved = ofRule(findings(root, [record("remo.known")]), "unresolved");
    expect(unresolved[0]).toMatchObject({ file: "apps/web/src/Dynamic.ts", line: 1 });
  });

  it("does not read keys from comments", () => {
    const root = tree({
      "packages/consent/src/Note.mjs":
        '// localStorage.setItem("remo.commented", "1")\nexport const note = true;\n',
    });
    expect(findings(root, [record("remo.known")])).toEqual([expect.objectContaining({ rule: "unused" })]);
  });

  it("fails a document.cookie name that has no record", () => {
    const root = tree({
      "apps/web/src/Cookie.ts":
        'export function token() {\n  return /(?:^|;\\s*)remo_secret=([^;]*)/.exec(document.cookie);\n}\n',
    });
    const unregistered = ofRule(findings(root, [record("remo.other", "cookie")]), "unregistered");
    expect(unregistered[0]).toMatchObject({ name: "remo_secret", kind: "cookie" });
  });

  it("passes a document.cookie name that has a record", () => {
    const root = tree({
      "apps/web/src/Cookie.ts":
        'export function token() {\n  return /(?:^|;\\s*)remo_secret=([^;]*)/.exec(document.cookie);\n}\n',
    });
    expect(findings(root, [record("remo_secret", "cookie")])).toEqual([]);
  });
});

describe("consent check: the service's cookies (§8 rule 1)", () => {
  it("fails a Set-Cookie name that has no registry record", () => {
    const root = tree({
      "apps/sync/secret.mjs":
        'const NAME = "remo_secret";\n' +
        "export function cookie(token) {\n" +
        "  return `${NAME}=${token}; Path=/; HttpOnly; SameSite=Lax`;\n" +
        "}\n",
    });
    const unregistered = ofRule(findings(root, [record("remo_other", "cookie", "necessary", "sync")]), "unregistered");
    expect(unregistered[0]).toMatchObject({ file: "apps/sync/secret.mjs", name: "remo_secret" });
  });

  it("passes a cookie name it can resolve through a constant", () => {
    const root = tree({
      "apps/sync/secret.mjs":
        'const NAME = "remo_secret";\n' +
        "export function cookie(token) {\n" +
        "  return `${NAME}=${token}; Path=/; HttpOnly; SameSite=Lax`;\n" +
        "}\n",
    });
    expect(findings(root, [record("remo_secret", "cookie", "necessary", "sync")])).toEqual([]);
  });
});

describe("consent check: external scripts (§8 rule 3)", () => {
  it("fails a script host that is not a necessary third party", () => {
    const root = tree({
      "apps/web/index.html":
        '<!doctype html><script src="https://tracker.example/tag.js"></script>\n',
    });
    const scripts = ofRule(findings(root, [record("remo.known")]), "script");
    expect(scripts[0]).toMatchObject({ file: "apps/web/index.html", name: "tracker.example" });
  });

  it("passes a script host that is a necessary third-party record", () => {
    const root = tree({
      "apps/web/index.html":
        '<!doctype html><script src="https://chat.example/widget.js"></script>\n',
    });
    expect(
      findings(root, [record("chat.example", "third-party", "necessary", "support")]),
    ).toEqual([]);
  });

  it("allows a self-hosted script", () => {
    const root = tree({
      "apps/web/index.html": '<!doctype html><script src="/theme-boot.js"></script>\n',
    });
    expect(findings(root, [record("remo.known")])).toEqual([
      expect.objectContaining({ rule: "unused", name: "remo.known" }),
    ]);
  });
});

describe("consent check: the registry does not lie (§8 rule 4)", () => {
  it("fails a record that no file uses", () => {
    const root = tree({
      "apps/web/src/Store.ts": 'localStorage.setItem("remo.real", "1");\n',
    });
    const unused = ofRule(findings(root, [record("remo.real"), record("remo.ghost")]), "unused");
    expect(unused).toHaveLength(1);
    expect(unused[0].name).toBe("remo.ghost");
  });

  it("surfaces an invalid registry record as a registry finding", () => {
    const invalid = { ...record("remo.odd"), category: "tracking" };
    const root = tree({ "apps/web/src/Store.ts": "export const nothing = true;\n" });
    const registry = ofRule(findings(root, [invalid]), "registry");
    expect(registry[0].why).toContain("unknown category");
  });
});

describe("consent check: the real tree", () => {
  it("passes, and every real storage key has a record", () => {
    const result = scanConsent();
    expect(result.problems).toEqual([]);

    const names = new Set(result.uses.map((use) => use.name));
    for (const expected of [
      "remo.identity",
      "remo.session",
      "remo.settings",
      "remo.lang",
      "remo.theme",
      "remo.canvas.hint",
      "remo.inspector",
      "remo.moveBanner.dismissed",
      "remo.verifyBanner.*",
      "remo_session",
      "remo_csrf",
      "remo_link_unlock",
      "remo_visitor",
    ]) {
      expect(names, `${expected} is used by the code`).toContain(expected);
    }
    expect(result.entries).toBe(17);
  });
});
