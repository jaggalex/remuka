import { describe, expect, it } from "vitest";
import { USAGE, parseMfaResetArgs, runMfaReset } from "./mfa-reset.mjs";

const ADMIN = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ops@example.test",
};
const PERSON = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "person@example.test",
};

function capture() {
  const lines = [];
  return { lines, out: (line) => lines.push(String(line)), err: (line) => lines.push(String(line)) };
}

function fakeStore({ hadSecret = true, operators = [ADMIN.email], target = PERSON } = {}) {
  const calls = [];
  return {
    calls,
    async findUserByEmail(email) {
      if (email === ADMIN.email) return ADMIN;
      if (email === target?.email) return target;
      return null;
    },
    async findUserById() {
      return null;
    },
    async isInstanceOperator(userId) {
      return userId === ADMIN.id && operators.includes(ADMIN.email);
    },
    async resetMfa(userId) {
      calls.push(["reset", userId]);
      return { hadSecret, recoveryCodes: hadSecret ? 10 : 0, challenges: hadSecret ? 2 : 0 };
    },
    async revokeUserSessions(userId) {
      calls.push(["revoke", userId]);
    },
    async recordAudit(event) {
      calls.push(["audit", event]);
    },
  };
}

describe("mfa:reset command line", () => {
  it("prints usage on --help and on no arguments", () => {
    expect(parseMfaResetArgs([])).toEqual({ help: true });
    expect(parseMfaResetArgs(["--help"])).toEqual({ help: true });
    expect(USAGE).toContain("pnpm mfa:reset");
    expect(USAGE).toContain("--as");
  });

  it("requires an address and a reason", () => {
    expect(() => parseMfaResetArgs(["--reason", "lost"])).toThrow(/--email/);
    expect(() => parseMfaResetArgs(["--email", "ops@example.test"])).toThrow(/--reason/);
    expect(() => parseMfaResetArgs(["--email", "not-an-address", "--reason", "lost"])).toThrow(
      /email address/,
    );
  });

  it("takes no unknown flag or positional", () => {
    expect(() =>
      parseMfaResetArgs(["--email", "ops@example.test", "--reason", "x", "--now", "yes"]),
    ).toThrow(/does not take --now/);
    expect(() => parseMfaResetArgs(["--email", "ops@example.test", "--reason", "x", "extra"])).toThrow(
      /unexpected argument/,
    );
    expect(() => parseMfaResetArgs(["--email", "ops@example.test", "--reason", "x", "--as", ""])).toThrow(
      /--as/,
    );
  });
});

describe("mfa:reset", () => {
  it("refuses a command that does not name its author", async () => {
    const store = fakeStore();
    const log = capture();
    const code = await runMfaReset({
      argv: ["--email", PERSON.email, "--reason", "lost"],
      env: {},
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("REMO_OPERATOR");
    expect(store.calls).toEqual([]);
  });

  it("refuses an author who is not an operator", async () => {
    const store = fakeStore({ operators: [] });
    const log = capture();
    const code = await runMfaReset({
      argv: ["--email", PERSON.email, "--reason", "lost", "--as", ADMIN.email],
      env: {},
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(store.calls).toEqual([]);
  });

  it("removes the factor, ends the sessions and writes one audit row", async () => {
    const store = fakeStore();
    const log = capture();
    const code = await runMfaReset({
      argv: ["--email", PERSON.email, "--reason", "lost the phone", "--as", ADMIN.email],
      env: {},
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(0);
    expect(log.lines.join("\n")).toContain("second factor removed");
    expect(store.calls.map(([kind]) => kind)).toEqual(["reset", "revoke", "audit"]);
    expect(store.calls[0][1]).toBe(PERSON.id);
    expect(store.calls[1][1]).toBe(PERSON.id);
    expect(store.calls[2][1]).toMatchObject({
      actorId: ADMIN.id,
      action: "mfa.reset",
      subject: PERSON.id,
      reason: "lost the phone",
    });
  });

  it("says nothing changed when there is no factor and writes no audit", async () => {
    const store = fakeStore({ hadSecret: false });
    const log = capture();
    const code = await runMfaReset({
      argv: ["--email", PERSON.email, "--reason", "lost", "--as", ADMIN.email],
      env: {},
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(0);
    expect(log.lines.join("\n")).toContain("has no second factor");
    expect(store.calls.map(([kind]) => kind)).toEqual(["reset"]);
  });

  it("refuses an address with no account", async () => {
    const store = fakeStore({ target: null });
    const log = capture();
    const code = await runMfaReset({
      argv: ["--email", "ghost@example.test", "--reason", "lost", "--as", ADMIN.email],
      env: {},
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("no account with the address");
    expect(store.calls).toEqual([]);
  });
});
