import { describe, expect, it } from "vitest";
import {
  USAGE,
  formatSummary,
  parseAccountDeleteArgs,
  runAccountDelete,
} from "./account-delete.mjs";

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";

const SUMMARY = {
  user: {
    id: TARGET,
    email: "person@example.test",
    name: "Anna",
    state: "active",
    deletionRequestedAt: null,
  },
  blockers: [],
  sharedOrgs: [{ id: "o1", name: "Studio", slug: "studio", admin: true }],
  rooms: [{ id: "b1", title: "Personal room", archived: false }],
  subscription: {
    plan: "pro",
    status: "active",
    currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
  },
};

function fakeStore({
  operator = true,
  summary = SUMMARY,
  begin = { state: "deleting", changed: true, deletionRequestedAt: new Date("2026-11-22T00:00:00Z") },
} = {}) {
  const calls = [];
  return {
    calls,
    async findUserById(id) {
      calls.push(["find", id]);
      return [{ id: OPERATOR, email: "ops@example.test" }, { id: TARGET, email: "person@example.test" }].find(
        (user) => user.id === id,
      ) ?? null;
    },
    async findUserByEmail(email) {
      calls.push(["find-email", email]);
      return email === "person@example.test"
        ? { id: TARGET, email }
        : email === "ops@example.test"
          ? { id: OPERATOR, email }
          : null;
    },
    async isInstanceOperator(id) {
      calls.push(["operator", id]);
      return operator;
    },
    async accountDeletionSummary(id) {
      calls.push(["summary", id]);
      return summary;
    },
    async personalOrgIds() {
      calls.push(["orgs"]);
      return [];
    },
    async cancelAtPeriodEnd() {
      calls.push(["cancel"]);
      return {};
    },
    async beginAccountDeletion(args) {
      calls.push(["begin", args]);
      return begin;
    },
    async anonymiseAccount() {
      calls.push(["anonymise"]);
      return { state: "deleted", boards: 1, personalOrgs: 1, keptOrgs: 0 };
    },
  };
}

function capture() {
  const out = [];
  const err = [];
  return {
    out: (line) => out.push(String(line)),
    err: (line) => err.push(String(line)),
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  };
}

async function run(argv, { store = fakeStore(), env = { REMO_OPERATOR: "ops@example.test" } } = {}) {
  const io = capture();
  const code = await runAccountDelete({ argv, env, store, out: io.out, err: io.err });
  return { code, ...io, store };
}

describe("pnpm account:delete arguments (ADR-257 §4)", () => {
  it("refuses to guess which account to erase", () => {
    expect(() => parseAccountDeleteArgs([])).not.toThrow();
    expect(parseAccountDeleteArgs([])).toEqual({ help: true });
    expect(() => parseAccountDeleteArgs(["delete"])).toThrow("unexpected argument");
    expect(() => parseAccountDeleteArgs(["--user"])).toThrow("--user needs a value");
    expect(() => parseAccountDeleteArgs(["--user", "someone"])).toThrow("uuid");
    expect(() => parseAccountDeleteArgs(["--user", TARGET, "--force", "yes"])).toThrow(
      "does not take --force",
    );
  });

  it("reads the id or email, the reason and the two switches", () => {
    expect(parseAccountDeleteArgs(["--user", TARGET, "--now", "--reason", "court order"])).toEqual({
      help: false,
      user: TARGET,
      as: null,
      reason: "court order",
      purgeNow: true,
      dryRun: false,
    });
    expect(parseAccountDeleteArgs(["--user", "person@example.test", "--dry-run"]).user).toBe(
      "person@example.test",
    );
  });
});

describe("pnpm account:delete dry run", () => {
  it("describes what goes and what stays", () => {
    const text = formatSummary(SUMMARY, { purgeNow: true });
    expect(text).toContain("person@example.test");
    expect(text).toContain("Studio (studio) — org_admin");
    expect(text).toContain("personal rooms to delete: 1");
    expect(text).toContain("Personal room (b1)");
    expect(text).toContain("subscription: pro/active until 2027-01-01T00:00:00.000Z — no renewal");
    expect(text).toContain("would erase immediately (--now)");
  });

  it("writes nothing and says so", async () => {
    const result = await run(["--user", TARGET, "--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.stdout()).toContain("Studio (studio)");
    expect(result.stdout()).toContain("nothing changed (--dry-run)");
    expect(result.store.calls.map(([name]) => name)).toEqual([
      "find-email",
      "find",
      "operator",
      "summary",
    ]);
  });
});

describe("pnpm account:delete permissions", () => {
  it("refuses a caller who is not an instance operator", async () => {
    const result = await run(["--user", TARGET], { store: fakeStore({ operator: false }) });
    expect(result.code).toBe(1);
    expect(result.stderr()).toContain("FORBIDDEN");
    expect(result.store.calls.some(([name]) => name === "begin")).toBe(false);
  });

  it("needs the operator to name themselves", async () => {
    const result = await run(["--user", TARGET], { env: {} });
    expect(result.code).toBe(1);
    expect(result.stderr()).toContain("--as");
    expect(result.stderr()).toContain(USAGE);
  });

  it("refuses the last administrator of a shared organisation", async () => {
    const summary = {
      ...SUMMARY,
      blockers: [{ id: "o1", name: "Studio", slug: "studio", members: 2 }],
    };
    const result = await run(["--user", TARGET], { store: fakeStore({ summary }) });
    expect(result.code).toBe(1);
    expect(result.stderr()).toContain("LAST_ADMIN");
    expect(result.stderr()).toContain("Studio");
  });
});

describe("pnpm account:delete --now", () => {
  it("erases the account and reports the counts", async () => {
    const result = await run(["--user", TARGET, "--now", "--reason", "court order"]);
    expect(result.code).toBe(0);
    expect(result.stdout()).toContain("purged now");
    const begin = result.store.calls.find(([name]) => name === "begin")[1];
    expect(begin).toMatchObject({
      action: "account.delete_operator",
      actorId: OPERATOR,
      reason: "court order",
    });
    expect(result.store.calls.some(([name]) => name === "anonymise")).toBe(true);
  });

  it("answers ok on an account that is already a tombstone", async () => {
    const summary = { ...SUMMARY, user: { ...SUMMARY.user, state: "deleted" } };
    const result = await run(["--user", TARGET, "--now"], { store: fakeStore({ summary }) });
    expect(result.code).toBe(0);
    expect(result.stdout()).toContain("already deleted");
    expect(result.store.calls.some(([name]) => name === "begin")).toBe(false);
  });
});

describe("pnpm account:delete without --now", () => {
  it("stops the account and names the final date", async () => {
    const result = await run(["--user", TARGET]);
    expect(result.code).toBe(0);
    expect(result.stdout()).toContain("deleting; final erasure on");
    expect(result.stdout()).toContain("2026-12-06T00:00:00.000Z");
    expect(result.store.calls.some(([name]) => name === "anonymise")).toBe(false);
  });
});
