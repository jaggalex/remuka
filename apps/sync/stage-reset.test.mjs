import { describe, expect, it } from "vitest";
import { composeServiceCommand, maintenanceUrl, quoteIdentifier, runStageReset } from "./stage-reset.mjs";

/** Destructive commands are refused before anything is touched (`spec/stage.md` §6). */
describe("stage reset guards", () => {
  it("refuses without the stage flag and without --yes", async () => {
    await expect(runStageReset({ env: {} })).rejects.toThrow(/only on a test stand/);
    await expect(
      runStageReset({ env: { REMO_STAGE: "1", DATABASE_URL: "postgres://u:p@db/test" } }),
    ).rejects.toThrow(/--yes/);
  });

  it("reads the database name from the URL and refuses to drop maintenance databases", () => {
    expect(maintenanceUrl("postgres://u:p@db:5432/stage_ru").database).toBe("stage_ru");
    expect(() => quoteIdentifier("stage_ru; drop table users")).toThrow(/refusing/);
    expect(quoteIdentifier("stage_ru")).toBe('"stage_ru"');
  });

  it("names the instance's own compose project for stop and start", () => {
    const env = {
      REMO_COMPOSE_PROJECT: "stage-ru",
      REMO_PRODUCTION_ENV: "/srv/stage-ru/shared/production.env",
    };
    const stop = composeServiceCommand(env, "stop");
    expect(stop.command).toBe("docker");
    expect(stop.args.slice(0, 3)).toEqual(["compose", "-p", "stage-ru"]);
    expect(stop.args).toContain("--env-file");
    expect(stop.args.slice(-2)).toEqual(["stop", "sync"]);
    expect(composeServiceCommand({}, "stop")).toBeNull();
  });
});
