import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPERATOR_ACTOR_HINT,
  OPERATOR_ROLE_USAGE,
  parseOperatorRoleArgs,
  runOperatorRole,
} from "./operator-role.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function capture() {
  const lines = [];
  return {
    lines,
    out: (line) => lines.push(String(line)),
    err: (line) => lines.push(String(line)),
  };
}

function fakeStore({ verified = true, operators = ["ops@example.test"] } = {}) {
  const calls = [];
  const holders = new Set(operators);
  return {
    calls,
    holders,
    async findUserByEmail(email) {
      if (email !== "ops@example.test") return null;
      return {
        id: "11111111-1111-4111-8111-111111111111",
        email,
        state: "active",
        email_verified_at: verified ? new Date("2026-11-01T00:00:00Z") : null,
      };
    },
    async findUserById() {
      return null;
    },
    async isInstanceOperator(userId) {
      return holders.has("ops@example.test") && userId === "11111111-1111-4111-8111-111111111111";
    },
    async grantInstanceOperator(args) {
      calls.push(["grant", args]);
      return { userId: "11111111-1111-4111-8111-111111111111", email: args.email };
    },
    async revokeInstanceOperator(args) {
      calls.push(["revoke", args]);
      return { removed: true, userId: "11111111-1111-4111-8111-111111111111", email: args.email };
    },
    async recordAudit(event) {
      calls.push(["audit", event]);
    },
    async listInstanceOperators() {
      return holders.size === 0
        ? []
        : [
            {
              userId: "11111111-1111-4111-8111-111111111111",
              email: "ops@example.test",
              grantedAt: new Date("2026-11-01T00:00:00Z"),
              grantedByEmail: null,
            },
          ];
    },
  };
}

describe("operator role command line", () => {
  it("prints usage on --help", () => {
    expect(parseOperatorRoleArgs("grant", ["--help"])).toEqual({ command: "grant", help: true });
    expect(OPERATOR_ROLE_USAGE).toContain("operator:grant");
    expect(OPERATOR_ROLE_USAGE).toContain("--as");
    expect(OPERATOR_ACTOR_HINT).toContain("REMO_OPERATOR");
  });

  it("requires a reason on grant and revoke", () => {
    expect(() => parseOperatorRoleArgs("grant", ["--email", "ops@example.test"])).toThrow(
      /--reason/,
    );
    expect(() =>
      parseOperatorRoleArgs("revoke", ["--email", "ops@example.test", "--reason", "  "]),
    ).toThrow(/--reason/);
  });

  it("keeps list flag-free", () => {
    expect(parseOperatorRoleArgs("list", [])).toEqual({ command: "list", help: false });
    expect(() => parseOperatorRoleArgs("list", ["--email", "a@b.c"])).toThrow(/no flags/);
  });

  it("refuses an unconfirmed address before the store is asked to grant", async () => {
    const store = fakeStore({ verified: false });
    const log = capture();
    const code = await runOperatorRole({
      command: "grant",
      argv: ["--email", "ops@example.test", "--reason", "bootstrap", "--as", "ops@example.test"],
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(store.calls.some(([name]) => name === "grant")).toBe(false);
    expect(log.lines.join("\n")).toContain("no confirmed address");
  });

  it("grants a confirmed address and records the reason", async () => {
    const store = fakeStore();
    const log = capture();
    const code = await runOperatorRole({
      command: "grant",
      argv: ["--email", "ops@example.test", "--reason", "bootstrap", "--as", "ops@example.test"],
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(0);
    const audit = store.calls.find(([name]) => name === "audit")?.[1];
    expect(audit).toMatchObject({
      action: "operator.granted",
      subject: "11111111-1111-4111-8111-111111111111",
      reason: "bootstrap",
    });
  });

  it("refuses a command without an author", async () => {
    const store = fakeStore();
    const log = capture();
    const code = await runOperatorRole({
      command: "revoke",
      argv: ["--email", "ops@example.test", "--reason", "cleanup"],
      env: {},
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("--as");
    expect(store.calls).toEqual([]);
  });

  it("takes the author from REMO_OPERATOR when --as is absent", async () => {
    const store = fakeStore();
    const log = capture();
    const code = await runOperatorRole({
      command: "revoke",
      argv: ["--email", "ops@example.test", "--reason", "cleanup"],
      env: { REMO_OPERATOR: "ops@example.test" },
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(0);
    const audit = store.calls.find(([name]) => name === "audit")?.[1];
    expect(audit.actorId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("refuses an author who does not hold the role", async () => {
    const store = fakeStore();
    store.findUserById = async () => ({
      id: "33333333-3333-4333-8333-333333333333",
      email: "stranger@example.test",
    });
    const log = capture();
    const code = await runOperatorRole({
      command: "revoke",
      argv: [
        "--email",
        "ops@example.test",
        "--reason",
        "cleanup",
        "--as",
        "33333333-3333-4333-8333-333333333333",
      ],
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("is not an instance operator");
    expect(store.calls.some(([name]) => name === "revoke")).toBe(false);
  });

  it("bootstraps only by naming the account being granted while nobody holds the role", async () => {
    const store = fakeStore({ operators: [] });
    const log = capture();
    const code = await runOperatorRole({
      command: "grant",
      argv: ["--email", "ops@example.test", "--reason", "bootstrap", "--as", "ops@example.test"],
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(0);
    const grant = store.calls.find(([name]) => name === "grant")?.[1];
    expect(grant.grantedBy).toBe("11111111-1111-4111-8111-111111111111");

    const second = fakeStore({ operators: [] });
    const ops = {
      id: "11111111-1111-4111-8111-111111111111",
      email: "ops@example.test",
      state: "active",
      email_verified_at: new Date("2026-11-01T00:00:00Z"),
    };
    second.findUserByEmail = async (email) =>
      email === ops.email
        ? ops
        : email === "other@example.test"
          ? {
              id: "44444444-4444-4444-8444-444444444444",
              email,
              state: "active",
              email_verified_at: new Date("2026-11-01T00:00:00Z"),
            }
          : null;
    const refused = await runOperatorRole({
      command: "grant",
      argv: ["--email", "other@example.test", "--reason", "second", "--as", "ops@example.test"],
      store: second,
      out: log.out,
      err: log.err,
    });
    expect(refused).toBe(1);
    expect(second.calls.some(([name]) => name === "grant")).toBe(false);
  });

  it("names the operator from --as when one person acts", async () => {
    const store = fakeStore();
    store.findUserById = async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      email: "lead@example.test",
    });
    store.isInstanceOperator = async () => true;
    const log = capture();
    const code = await runOperatorRole({
      command: "revoke",
      argv: [
        "--email",
        "ops@example.test",
        "--reason",
        "left the team",
        "--as",
        "22222222-2222-4222-8222-222222222222",
      ],
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(0);
    const audit = store.calls.find(([name]) => name === "audit")?.[1];
    expect(audit).toMatchObject({
      action: "operator.revoked",
      actorId: "22222222-2222-4222-8222-222222222222",
      reason: "left the team",
    });
  });

  it("reports the store's refusal to remove the last operator", async () => {
    const store = fakeStore();
    store.revokeInstanceOperator = async () => {
      const error = new Error("this is the last operator");
      error.code = "LAST_OPERATOR";
      throw error;
    };
    const log = capture();
    const code = await runOperatorRole({
      command: "revoke",
      argv: ["--email", "ops@example.test", "--reason", "cleanup", "--as", "ops@example.test"],
      store,
      out: log.out,
      err: log.err,
    });
    expect(code).toBe(1);
    expect(log.lines.join("\n")).toContain("LAST_OPERATOR");
  });
});

describe("no route may change instance_operators", () => {
  it("keeps the mutation in the command module and nowhere in the HTTP surface", () => {
    const routeFiles = readdirSync(HERE).filter(
      (name) =>
        (name.endsWith("-api.mjs") || name === "server.mjs" || name === "iam-http.mjs") &&
        !name.endsWith(".test.mjs"),
    );
    const offenders = [];
    for (const name of routeFiles) {
      const source = readFileSync(join(HERE, name), "utf8");
      if (/\b(?:insert\s+into|update|delete\s+from)\s+instance_operators\b/i.test(source)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
