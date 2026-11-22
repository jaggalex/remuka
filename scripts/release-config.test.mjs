/**
 * The release configuration is read, not executed.
 *
 * `release.sh` used to `source` the operator's file, so a document could run commands
 * and change the environment the verification gate sees. These cases pin the replacement:
 * strict `KEY=VALUE` lines, an owned file with mode 600, no symlink.
 *
 * The installation parameters (ADR-261) are part of the same parser: a deploy root is a
 * path that is concatenated into directories and quoted into a remote shell, and the
 * compose project and edge alias are Docker names. All three may also arrive through the
 * environment, so they have their own check that does not go through the file.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIB = join(ROOT, "deploy", "config.sh");

function fileWith(content, mode = 0o600) {
  const dir = mkdtempSync(join(tmpdir(), "remo-release-"));
  const path = join(dir, "deploy.env");
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
}

function cleanEnvironment() {
  const env = { ...process.env };
  for (const key of ["REMO_DEPLOY_ROOT", "REMO_COMPOSE_PROJECT", "REMO_WEB_ALIAS"]) delete env[key];
  return env;
}

function read(path) {
  const script = [
    `source ${JSON.stringify(LIB)}`,
    `read_release_config ${JSON.stringify(path)} || exit $?`,
    `printf '%s|%s|%s|%s|%s|%s|%s' "\${REMO_DEPLOY_HOST:-}" "\${REMO_APP_ORIGIN:-}" "\${REMO_DOCS_ORIGIN:-}" "\${REMO_DEPLOY_ROOT:-}" "\${REMO_COMPOSE_PROJECT:-}" "\${REMO_WEB_ALIAS:-}" "\${REMO_DEPLOY_HTTP_AUTH:-}"`,
  ].join("; ");
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8", env: cleanEnvironment() });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function checkParameters(root, project, alias, auth = "") {
  const script = '. "$1"; check_release_parameters "$2" "$3" "$4" "$5"';
  return spawnSync("bash", ["-c", script, "check", LIB, root, project, alias, auth], {
    encoding: "utf8",
    env: cleanEnvironment(),
  });
}

describe("the release configuration parser", () => {
  it("reads plain assignments, comments and blank lines", () => {
    const path = fileWith(
      [
        "# release configuration",
        "",
        "REMO_DEPLOY_HOST=deploy@example.com",
        "REMO_APP_ORIGIN=https://boards.example.com",
        "REMO_DOCS_ORIGIN=https://docs.example.com",
        "",
      ].join("\n"),
    );
    const result = read(path);
    expect(result.status).toBe(0);
    // Absent installation parameters keep today's production layout.
    expect(result.stdout).toBe(
      "deploy@example.com|https://boards.example.com|https://docs.example.com|/srv/remo|remo|remo-web|",
    );
  });

  it("reads the installation parameters of a second instance", () => {
    const result = read(
      fileWith(
        [
          "REMO_DEPLOY_HOST=deploy@example.com",
          "REMO_APP_ORIGIN=https://app.stage.example.com",
          "REMO_DOCS_ORIGIN=https://docs.stage.example.com",
          "REMO_DEPLOY_ROOT=/srv/stage-eu",
          "REMO_COMPOSE_PROJECT=stage-eu",
          "REMO_WEB_ALIAS=stage-eu-web",
          "REMO_DEPLOY_HTTP_AUTH=tester1:stand-password",
        ].join("\n"),
      ),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "deploy@example.com|https://app.stage.example.com|https://docs.stage.example.com|/srv/stage-eu|stage-eu|stage-eu-web|tester1:stand-password",
    );
  });

  it("refuses a stand credential without user:password", () => {
    for (const value of ["tester1", "tester1:", "tester1:two words"]) {
      const result = read(fileWith(`REMO_DEPLOY_HTTP_AUTH=${value}\n`));
      expect(result.status, value).not.toBe(0);
      expect(result.stderr, value).toContain("REMO_DEPLOY_HTTP_AUTH");
    }
  });

  it("refuses a deploy root that is not a clean absolute path", () => {
    for (const value of [
      "srv/stage-ru",
      "/srv/stage-ru/",
      "/srv/../stage-ru",
      "/srv/stage.ru",
      "/srv//stage-ru",
      "/srv/stage ru",
      "/",
    ]) {
      const result = read(fileWith(`REMO_DEPLOY_ROOT=${value}\n`));
      expect(result.status, value).not.toBe(0);
      expect(result.stderr, value).toContain("REMO_DEPLOY_ROOT");
    }
  });

  it("refuses a project or alias outside [a-z0-9-]", () => {
    for (const [key, value] of [
      ["REMO_COMPOSE_PROJECT", "Stage-ru"],
      ["REMO_COMPOSE_PROJECT", "stage_ru"],
      ["REMO_COMPOSE_PROJECT", "stage.ru"],
      ["REMO_WEB_ALIAS", "stage-ru-web "],
      ["REMO_WEB_ALIAS", "stage/web"],
    ]) {
      const result = read(fileWith(`${key}=${value}\n`));
      expect(result.status, `${key}=${value}`).not.toBe(0);
      expect(result.stderr, `${key}=${value}`).toContain(key);
    }
  });

  it("validates parameters that come from the environment", () => {
    expect(checkParameters("/srv/stage-ru", "stage-ru", "stage-ru-web").status).toBe(0);
    expect(checkParameters("/srv/stage-ru", "stage-ru", "stage-ru-web", "tester1:pw").status).toBe(0);
    expect(checkParameters("srv/stage-ru", "stage-ru", "stage-ru-web").status).not.toBe(0);
    expect(checkParameters("/srv/stage-ru", "Stage", "stage-ru-web").status).not.toBe(0);
    expect(checkParameters("/srv/stage-ru", "stage-ru", "stage_ru").status).not.toBe(0);
    expect(checkParameters("/srv/stage-ru", "stage-ru", "stage-ru-web", "tester1").status).not.toBe(0);
  });

  it("refuses a line that is not KEY=VALUE", () => {
    for (const line of ["export REMO_DEPLOY_HOST=x", "REMO DEPLOY HOST=x", "just a word"]) {
      const result = read(fileWith(`${line}\n`));
      expect(result.status, line).not.toBe(0);
      expect(result.stderr).toContain("Invalid line");
    }
  });

  it("refuses shell syntax in a value", () => {
    for (const line of ["REMO_DEPLOY_HOST=$(whoami)", "REMO_DEPLOY_HOST=`whoami`"]) {
      const result = read(fileWith(`${line}\n`));
      expect(result.status, line).not.toBe(0);
      expect(result.stderr).toContain("Shell syntax is not allowed");
    }
  });

  it("refuses an unknown key instead of silently ignoring a typo", () => {
    const result = read(fileWith("REMO_DEPLOY_HOTS=deploy@example.com\n"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown key");
  });

  it("refuses a file another user could read", () => {
    const result = read(fileWith("REMO_DEPLOY_HOST=deploy@example.com\n", 0o644));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mode 600");
  });

  it("refuses a symlink, even to a valid file", () => {
    const target = fileWith("REMO_DEPLOY_HOST=deploy@example.com\n");
    const link = join(mkdtempSync(join(tmpdir(), "remo-release-")), "deploy.env");
    symlinkSync(target, link);
    const result = read(link);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("symlinked");
  });
});
