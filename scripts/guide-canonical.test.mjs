/**
 * Every guide page names one canonical address (`spec/cloud-zones.md` §4.1).
 *
 * Both installations serve the same static files from their own documentation host, so a
 * search engine must see one page, not two. The address is absolute and comes from
 * `@remo/brand`: a relative canonical would silently name whichever host answered.
 *
 * The build runs into a temporary directory, so the test reads real pages without writing
 * into the tree that `pnpm guide:check` compares.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), "remo-guide-canonical-"));
const { BRAND } = await import("../packages/brand/src/index.mjs");
const CANONICAL_BASE = `https://${BRAND.domains.docs}/guide`;

function htmlFiles(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) htmlFiles(path, found);
    else if (entry.endsWith(".html")) found.push(path);
  }
  return found;
}

describe("the guide's canonical address", () => {
  let pages;

  beforeAll(() => {
    execFileSync(process.execPath, ["scripts/guide-build.mjs", "--out", OUT], {
      cwd: ROOT,
      stdio: "pipe",
    });
    pages = htmlFiles(OUT).map((path) => ({
      path: relative(OUT, path).split("\\").join("/"),
      html: readFileSync(path, "utf8"),
    }));
  });

  afterAll(() => {
    rmSync(OUT, { recursive: true, force: true });
  });

  it("builds the portal it serves", () => {
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.map((page) => page.path)).toContain("ru/overview/index.html");
  });

  it("puts exactly one absolute canonical on every page", () => {
    const problems = [];
    for (const { path, html } of pages) {
      const links = [...html.matchAll(/<link rel="canonical" href="([^"]*)">/g)];
      if (links.length !== 1) {
        problems.push(`${path}: ${links.length} canonical links`);
        continue;
      }
      // The portal's own entry page is a redirect stub; it names the page it opens.
      const expected =
        path === "index.html" ? `${CANONICAL_BASE}/ru/overview/index.html` : `${CANONICAL_BASE}/${path}`;
      if (links[0][1] !== expected) problems.push(`${path}: ${links[0][1]} instead of ${expected}`);
    }
    expect(problems).toEqual([]);
  });

  it("points the Russian host at the same page, never at itself", () => {
    for (const { path, html } of pages) {
      const canonical = html.match(/<link rel="canonical" href="([^"]*)">/)?.[1] ?? "";
      expect(canonical.startsWith(`${CANONICAL_BASE}/`)).toBe(true);
      expect(canonical).not.toContain(BRAND.domains.docsRu);
    }
  });
});
