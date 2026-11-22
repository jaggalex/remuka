/**
 * The `app.remuka.ru` stub (`spec/rebrand-fixes.md` §2).
 *
 * The Russia region does not exist yet. A visitor of the `.ru` host must see one honest
 * page with code 200 — not a redirect into the EU cloud, which would look like data
 * residency in Russia. These checks are static: they read the shipped files, because the
 * alternative is finding out on the host.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const CONFIG = read("deploy/ru-stub/nginx.conf");
/** Directives only: the comment explaining the rule may name what it forbids. */
const DIRECTIVES = CONFIG.split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");
const PAGE = read("deploy/ru-stub/index.html");
const ROBOTS = read("deploy/ru-stub/robots.txt");

describe("the Russia-region stub", () => {
  it("answers one host and never proxies or redirects", () => {
    expect(CONFIG).toContain("server_name app.remuka.ru;");
    expect(DIRECTIVES).not.toMatch(/\bproxy_pass\b/);
    expect(DIRECTIVES).not.toMatch(/\breturn\s+30[0-9]\b/);
    expect(DIRECTIVES).not.toMatch(/\breturn\s+https?:/);
  });

  it("serves the page itself for every path with code 200", () => {
    // `/index.html` as the last try_files argument is an internal redirect: the response
    // is the page and the status is 200, for `/`, `/anything` and a deep link alike.
    expect(CONFIG).toMatch(/try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/);
    expect(CONFIG).not.toContain("=404");
  });

  it("carries no script and no external resource", () => {
    expect(PAGE).not.toMatch(/<script\b/i);
    expect(PAGE).not.toMatch(/<link\b[^>]*\brel=["']?stylesheet/i);
    expect(PAGE).not.toMatch(/@import/);
    expect(PAGE).not.toMatch(/url\(\s*["']?https?:/i);
    expect(PAGE).not.toMatch(/<img\b/i);
    expect(PAGE).not.toMatch(/<iframe\b/i);
  });

  it("says both headlines and points at both clouds", () => {
    expect(PAGE).toContain("Регион Россия готовится");
    expect(PAGE).toContain("The Russia region is coming");
    expect(PAGE).toContain("работает в Европейском союзе");
    expect(PAGE).toContain("runs in the European Union");
    expect(PAGE).toContain('href="https://app.remuka.com"');
    expect(PAGE).toContain('href="https://remuka.ru"');
    expect(PAGE).toContain("Открыть Ремуку (ЕС)");
  });

  it("keeps itself out of search indexes in the page and in the header", () => {
    expect(PAGE).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(CONFIG).toMatch(/add_header X-Robots-Tag "noindex, nofollow" always;/);
    expect(ROBOTS).toMatch(/^User-agent: \*$/m);
    expect(ROBOTS).toMatch(/^Disallow: \/$/m);
  });

  it("includes the shared security headers in both listeners", () => {
    expect(CONFIG.match(/include \/srv\/remo\/deploy\/nginx-security-headers\.conf;/g)).toHaveLength(2);
  });
});
