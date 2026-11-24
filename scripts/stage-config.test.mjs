/**
 * The stand's shipped files (ADR-261, spec/stage.md §4).
 *
 * `nginx -t` runs on the stand, but four decisions must not drift: basic auth closes every
 * host except the two paths a provider and the release script need, nothing is indexed,
 * the database publishes no port, and the backup timer is the templated one. A stand that
 * quietly opens a path is worse than one that does not answer.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const NGINX = read("deploy/stage/nginx-stage.conf");
const DIRECTIVES = NGINX.split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .join("\n");
const SERVERS = DIRECTIVES.split(/^server\s*\{/m).slice(1);
const HTTPS = SERVERS.filter((block) => /listen 443/.test(block));
const APP = HTTPS.find((block) => block.includes("server_name app.STAGE_SUFFIX;"));
const LOCATIONS = [...DIRECTIVES.matchAll(/location\s+([^{]+)\{([^{}]*)\}/g)].map((match) => ({
  name: match[1].trim(),
  body: match[2],
}));

const DB = read("deploy/stage/compose.db.yml");
const MAIL = read("deploy/stage/compose.mail.yml");
const DOC = read("docs/operations/stage.md");

describe("the stand's edge template", () => {
  it("names the four values substituted before nginx -t", () => {
    for (const name of ["STAGE_SUFFIX", "WEB_ALIAS", "MAIL_ALIAS", "LEGAL_ZONE"]) {
      expect(NGINX).toMatch(new RegExp(name));
    }
  });

  it("answers four hosts per zone over TLS", () => {
    const names = HTTPS.flatMap((block) => [...block.matchAll(/server_name\s+([^;]+);/g)].map((m) => m[1].trim()));
    expect(names.sort()).toEqual(
      ["STAGE_SUFFIX", "app.STAGE_SUFFIX", "docs.STAGE_SUFFIX", "mail.STAGE_SUFFIX"].sort(),
    );
  });

  it("requires basic auth on every TLS host", () => {
    for (const block of HTTPS) {
      expect(block).toMatch(/auth_basic "Ремука — тестовый стенд";/);
      expect(block).toMatch(/auth_basic_user_file \/etc\/nginx\/stage\.htpasswd;/);
    }
  });

  it("opens only the two application paths the stand itself needs", () => {
    const open = LOCATIONS.filter((location) => /auth_basic off;/.test(location.body)).map(
      (location) => location.name,
    );
    // ACME challenges are open on every host: a certificate authority does not log in.
    expect(open.sort()).toEqual(
      [
        "= /api/health",
        "/api/billing/webhooks/",
        "^~ /.well-known/acme-challenge/",
        "^~ /.well-known/acme-challenge/",
        "^~ /.well-known/acme-challenge/",
      ].sort(),
    );
    // `/mcp` and the agent routes are not exempt: the catch-all keeps the login.
    expect(APP).not.toMatch(/mcp[^{]*\{[^}]*auth_basic off/);
  });

  it("keeps WebSocket upgrades on the socket location", () => {
    const sync = LOCATIONS.find((location) => location.name === "/sync/");
    expect(sync).toBeTruthy();
    expect(sync.body).toMatch(/proxy_set_header Upgrade \$http_upgrade;/);
    expect(sync.body).toMatch(/proxy_set_header Connection "upgrade";/);
    expect(sync.body).not.toMatch(/auth_basic off;/);
  });

  it("keeps search engines out of every host and of robots.txt", () => {
    for (const block of HTTPS) {
      expect(block).toMatch(/add_header X-Robots-Tag "noindex, nofollow" always;/);
    }
    expect(DIRECTIVES.match(/Disallow: \/\\n/g)).toHaveLength(4);
    expect(DIRECTIVES.match(/location = \/robots\.txt/g)).toHaveLength(4);
  });

  it("proxies to the web alias, never to a fixed container name", () => {
    expect(DIRECTIVES).toMatch(/proxy_pass http:\/\/WEB_ALIAS:8080;/);
    expect(DIRECTIVES).toMatch(/proxy_pass http:\/\/WEB_ALIAS:8081;/);
    expect(DIRECTIVES).toMatch(/proxy_pass http:\/\/MAIL_ALIAS:8025;/);
    expect(DIRECTIVES).not.toMatch(/proxy_pass http:\/\/remo-web/);
  });

  it("serves the instance's own legal pages from the mounted legal directory", () => {
    const legal = LOCATIONS.find((location) => location.name === "/legal/");
    expect(legal).toBeTruthy();
    expect(legal.body).toContain("alias /srv/legal/LEGAL_ZONE/;");
    expect(legal.body).not.toContain("auth_basic off");
  });
});

describe("the stand's database and mail", () => {
  it("publishes no port and takes the password from the instance's environment", () => {
    expect(DB).toMatch(/image: postgres:16-alpine/);
    expect(DB).toMatch(/POSTGRES_PASSWORD: \$\{REMO_DB_PASSWORD:\?Set REMO_DB_PASSWORD\}/);
    expect(DB).not.toMatch(/^\s*ports:/m);
    expect(DB).toMatch(/name: \$\{REMO_DB_NETWORK:\?Set REMO_DB_NETWORK\}/);
    expect(DB).toMatch(/name: \$\{REMO_COMPOSE_PROJECT:-remo\}-pg/);
  });

  it("keeps Mailpit on the private networks, SMTP included", () => {
    expect(MAIL).toMatch(/image: axllent\/mailpit:/);
    expect(MAIL).not.toMatch(/^\s*ports:/m);
    expect(MAIL).toMatch(/backend:\s*\n\s*aliases: \[mail\]/);
    expect(MAIL).toMatch(/aliases: \["\$\{REMO_COMPOSE_PROJECT:-remo\}-mail"\]/);
  });
});

describe("the backup timer", () => {
  it("is a template keyed by the instance name", () => {
    expect(existsSync(new URL("../deploy/remo-backup.service", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../deploy/remo-backup.timer", import.meta.url))).toBe(false);
    expect(read("deploy/remo-backup@.service")).toContain("ExecStart=/srv/%i/remo backup");
    expect(read("deploy/remo-backup@.timer")).toContain("WantedBy=timers.target");
  });
});

describe("the stand runbook", () => {
  it("names both instances, their roots and their private release files", () => {
    for (const text of [
      "/srv/stage-ru",
      "/srv/stage-eu",
      ".config/remo/stage-ru.env.local",
      ".config/remo/stage-eu.env.local",
      "REMO_COMPOSE_PROJECT=stage-ru",
      "REMO_WEB_ALIAS=stage-ru-web",
      "stage.remuka.ru",
      "stage.remuka.com",
    ]) {
      expect(DOC, text).toContain(text);
    }
  });

  it("describes DNS, basic auth, backups and the switch of the production timer", () => {
    expect(DOC).toMatch(/\*\.stage\.remuka\.ru/);
    expect(DOC).toMatch(/\*\.stage\.remuka\.com/);
    expect(DOC).toContain("htpasswd");
    expect(DOC).toContain("REMO_BACKUP_KEEP_DAYS");
    expect(DOC).toContain("REMO_DEPLOY_HTTP_AUTH");
    expect(DOC).toContain("remo-backup@stage-ru.timer");
    // Two timers would run two backups a night.
    expect(DOC).toContain("disable --now remo-backup.timer");
    expect(DOC).toContain("remo-backup@remo.timer");
  });

  it("keeps secrets out and points the reset at the specification", () => {
    expect(DOC).not.toMatch(/REMO_KEK=\S/);
    expect(DOC).not.toMatch(/REMO_APP_DB_PASSWORD=\S+/);
    expect(DOC).toContain("spec/stage.md` §6");
    expect(DOC).toContain("stage:reset");
  });
});

describe("the server's operator command bridge", () => {
  const CONTROLLER = read("deploy/remo");
  const CLOUD = read("docs/operations/cloud.md");

  it("runs a release script inside the sync image with shared/ mounted read-only", () => {
    expect(CONTROLLER).toMatch(/^\s*cli\)/m);
    expect(CONTROLLER).toContain('compose run --rm --no-deps -T -w /app -v "$ROOT/shared:/shared:ro" sync node "/app/scripts/$script"');
    expect(CONTROLLER).toContain("Usage: remo cli SCRIPT");
  });

  it("documents the host command without pnpm", () => {
    expect(CLOUD).toContain("remo cli billing-providers list");
    expect(CLOUD).toContain("/shared/yookassa-test.json");
    expect(CLOUD).toMatch(/no `pnpm`/);
  });
});

