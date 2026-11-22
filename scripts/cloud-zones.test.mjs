/**
 * The cloud's address map is a pair of shipped nginx templates (`spec/cloud-zones.md` §4.1).
 *
 * These checks are static: `nginx -t` runs on the host, but the decision that must not
 * drift is the *kind* of answer. An apex that promises a permanent redirect while the
 * landing page does not exist is a browser cache that only each visitor can clear, and an
 * API host that redirects drops `Authorization`. The runbook is checked too, because a
 * map that exists only in a specification is not a map.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const SITE = read("deploy/nginx-site.conf");
const DOCS = read("deploy/nginx-docs.conf");
const RUNBOOK = read("docs/operations/cloud.md");

/** Directives only: a comment may name the redirect it forbids. */
const directives = (config) =>
  config
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

const SITE_DIRECTIVES = directives(SITE);
const DOCS_DIRECTIVES = directives(DOCS);

/** `server { … }` chunks; locations nest but never start a line with `server {`. */
const servers = (config) => config.split(/^server\s*\{/m).slice(1);

describe("the apex and `www` template", () => {
  const blocks = servers(SITE_DIRECTIVES);

  it("names the two variables it substitutes", () => {
    expect(SITE).toMatch(/SITE_HOST\s+remuka\.com/);
    expect(SITE).toMatch(/APP_HOST\s+app\.remuka\.com/);
  });

  it("answers four hosts: both names on both ports", () => {
    expect(blocks).toHaveLength(4);
    expect(SITE_DIRECTIVES.match(/server_name www\.remuka\.com;/g)).toHaveLength(2);
    expect(SITE_DIRECTIVES.match(/server_name remuka\.com;/g)).toHaveLength(2);
  });

  it("upgrades plain HTTP on the same host", () => {
    for (const block of blocks.filter((entry) => /listen 80;/.test(entry))) {
      expect(block).toMatch(/return 301 https:\/\/\$host\$request_uri;|return 301 https:\/\/remuka\.com\$request_uri;/);
    }
  });

  it("sends the apex to the application with 302 and keeps the path", () => {
    const apex = blocks.find((block) => block.includes("server_name remuka.com;") && /listen 443/.test(block));
    expect(apex).toMatch(/return 302 https:\/\/app\.remuka\.com\$request_uri;/);
    // 301/308 here would be remembered by every browser; the landing page is not built.
    expect(apex).not.toMatch(/return 30[18] https:\/\/app\./);
  });

  it("moves `www` to the apex permanently, with the path", () => {
    const www = blocks.find(
      (block) => block.includes("server_name www.remuka.com;") && /listen 443/.test(block),
    );
    expect(www).toMatch(/return 301 https:\/\/remuka\.com\$request_uri;/);
  });

  it("never answers 308 anywhere", () => {
    expect(SITE_DIRECTIVES).not.toMatch(/\breturn 308\b/);
  });
});

describe("the guide host template", () => {
  it("names its one variable", () => {
    expect(DOCS).toMatch(/DOCS_HOST\s+docs\.remuka\.com/);
  });

  it("opens the guide from the root and serves the built site", () => {
    expect(DOCS_DIRECTIVES).toMatch(/location = \/ \{\s*return 302 \/guide\/;/);
    expect(DOCS_DIRECTIVES).toMatch(/location \/guide\/ \{\s*alias \/srv\/remo\/docs-site\/;/);
    expect(DOCS_DIRECTIVES).toMatch(/try_files \$uri \$uri\/ =404;/);
  });

  it("carries the guide's own security policy, not the app's", () => {
    expect(DOCS_DIRECTIVES).toMatch(/nginx-security-headers-docs\.conf/);
    expect(DOCS_DIRECTIVES).not.toMatch(/nginx-security-headers\.conf/);
  });

  it("is only a documentation host: no application behind it", () => {
    expect(DOCS_DIRECTIVES).not.toMatch(/\bproxy_pass\b/);
    expect(DOCS_DIRECTIVES).not.toMatch(/\breturn 30[18] https:\/\/(?:app|remuka)\./);
  });
});

describe("the runbook", () => {
  it("names both installations and the command that releases each", () => {
    expect(RUNBOOK).toContain("REMO_DEPLOY_ENV_FILE=.config/remo/com.env.local bash deploy/release.sh");
    expect(RUNBOOK).toContain("REMO_DEPLOY_ENV_FILE=.config/remo/ru.env.local bash deploy/release.sh");
    expect(RUNBOOK).toContain("app.remuka.com");
    expect(RUNBOOK).toContain("app.remuka.ru");
  });

  it("describes the rollback the server controller implements", () => {
    expect(RUNBOOK).toContain("rollback --schema-compatible");
    // A rollback that silently restores data would lose the writes after the dump.
    expect(RUNBOOK).toMatch(/db:restore/);
  });

  it("keeps secrets out of the repository", () => {
    expect(RUNBOOK).not.toMatch(/REMO_KEK=\S/);
    expect(RUNBOOK).not.toMatch(/REMO_APP_DB_PASSWORD=\S/);
  });
});
