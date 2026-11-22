/**
 * The Pulse commands refuse before touching data (`spec/pulse.md` §4.4, §5.4).
 *
 * A future day, a day outside the 730-day window, a revoke without a reason or without an
 * author: each is a one-line refusal with a non-zero exit code, and none needs a database.
 */
import { describe, expect, it } from "vitest";
import {
  normalisePeerOrigin,
  runPulsePeerList,
  runPulsePeerRevoke,
  runPulseRecompute,
} from "./cli.mjs";

const NOW = new Date("2026-11-23T12:00:00.000Z");

function capture() {
  const out = [];
  const err = [];
  return { out, err, print: (line) => out.push(String(line)), printErr: (line) => err.push(String(line)) };
}

const store = {
  async connect() {},
  async close() {},
  async findUserById() {
    return null;
  },
};

describe("pulse:recompute", () => {
  const env = { DATABASE_URL: "postgres://unused" };

  it("prints usage on --help", async () => {
    const sink = capture();
    expect(await runPulseRecompute({ argv: ["--help"], env, store, out: sink.print, err: sink.printErr, now: NOW })).toBe(0);
    expect(sink.out[0]).toContain("pulse:recompute");
  });

  it.each([
    [["--from", "2026-11-23", "--to", "2026-11-23"], "future"],
    [["--from", "2023-01-01", "--to", "2026-11-22"], "730-day"],
    [["--from", "2026-11-22", "--to", "2026-11-01"], "after"],
    [["--from", "not-a-day"], "UTC day"],
    [["--from"], "needs a value"],
    [["--wat", "1"], "does not take"],
  ])("refuses %o", async (argv, message) => {
    const sink = capture();
    expect(await runPulseRecompute({ argv, env, store, out: sink.print, err: sink.printErr, now: NOW })).toBe(1);
    expect(sink.err.join("\n")).toContain(message);
  });

  it("refuses without a metrics database", async () => {
    const sink = capture();
    expect(
      await runPulseRecompute({
        argv: ["--from", "2026-11-20", "--to", "2026-11-22"],
        env,
        store,
        out: sink.print,
        err: sink.printErr,
        now: NOW,
      }),
    ).toBe(1);
    expect(sink.err.join("\n")).toContain("REMO_METRICS_DATABASE_URL");
  });
});

describe("pulse:peer:list", () => {
  it("refuses without a metrics database", async () => {
    const sink = capture();
    expect(await runPulsePeerList({ env: {}, out: sink.print, err: sink.printErr })).toBe(1);
    expect(sink.err.join("\n")).toContain("REMO_METRICS_DATABASE_URL");
  });
});

describe("pulse:peer:revoke", () => {
  const env = { DATABASE_URL: "postgres://unused", REMO_OPERATOR: "ops@example.com" };

  it("refuses a missing reason", async () => {
    const sink = capture();
    const code = await runPulsePeerRevoke({
      argv: ["--origin", "https://app.remuka.ru", "--as", "ops@example.com"],
      env,
      store,
      out: sink.print,
      err: sink.printErr,
    });
    expect(code).toBe(1);
    expect(sink.err.join("\n")).toContain("--reason");
  });

  it("refuses a missing author", async () => {
    const sink = capture();
    const code = await runPulsePeerRevoke({
      argv: ["--origin", "https://app.remuka.ru", "--reason", "left"],
      env: { DATABASE_URL: "postgres://unused" },
      store,
      out: sink.print,
      err: sink.printErr,
    });
    expect(code).toBe(1);
    expect(sink.err.join("\n")).toContain("--as");
  });

  it("refuses an origin with a path", async () => {
    const sink = capture();
    const code = await runPulsePeerRevoke({
      argv: ["--origin", "https://app.remuka.ru/export", "--reason", "left", "--as", "ops@example.com"],
      env,
      store,
      out: sink.print,
      err: sink.printErr,
    });
    expect(code).toBe(1);
    expect(sink.err.join("\n")).toContain("without a path");
  });

  it("normalises the origin", () => {
    expect(normalisePeerOrigin("https://app.remuka.ru")).toBe("https://app.remuka.ru");
    expect(() => normalisePeerOrigin("http://app.remuka.ru")).toThrow();
  });
});
