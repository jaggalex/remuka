import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyEnvFile } from "./stage-env.mjs";

/** An environment file is data: no interpolation, no commands, the shell env wins. */
describe("the stand environment file", () => {
  it("reads KEY=VALUE, quotes and leaves an existing value alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "remo-stage-env-"));
    const file = join(dir, "production.env");
    writeFileSync(
      file,
      [
        "# a comment",
        "REMO_STAGE=1",
        'REMO_MAIL_FROM="Remuka <no-reply@mail.example.test>"',
        "REMO_STAGE_RESET_ACTOR='tester'",
        "REMO_STAGE_SEED_DOMAIN=example.test",
      ].join("\n"),
    );
    const env = { REMO_STAGE_SEED_DOMAIN: "from-shell.test" };
    expect(applyEnvFile(env, file)).toBe(true);
    expect(env).toEqual({
      REMO_STAGE: "1",
      REMO_MAIL_FROM: "Remuka <no-reply@mail.example.test>",
      REMO_STAGE_RESET_ACTOR: "tester",
      REMO_STAGE_SEED_DOMAIN: "from-shell.test",
    });
  });

  it("ignores a missing file and a line that is not an assignment", () => {
    const dir = mkdtempSync(join(tmpdir(), "remo-stage-env-"));
    const file = join(dir, "production.env");
    writeFileSync(file, "not an assignment\n$(touch /tmp/owned)\n");
    const env = {};
    expect(applyEnvFile(env, file)).toBe(true);
    expect(env).toEqual({});
    expect(applyEnvFile({}, join(dir, "absent.env"))).toBe(false);
  });
});
