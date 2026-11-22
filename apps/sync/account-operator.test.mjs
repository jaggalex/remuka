import { describe, expect, it } from "vitest";
import { purgeAccount } from "./account-purge.mjs";
import {
  deleteAccountAsOperator,
  purgeAccount as operatorPurge,
} from "./account-operator.mjs";

/**
 * The operator path (ADR-257 §4): a role check before anything is read, a dry run that
 * writes nothing, the same fourteen-day request as the person's own command, and `--now`
 * through the hourly job's purge rather than a second erasure.
 */
function summaryOf({
  state = "active",
  blockers = [],
  rooms = [{ id: "b1", title: "Personal", archived: false }],
  subscription = null,
} = {}) {
  return {
    user: {
      id: "u1",
      email: "person@example.test",
      name: "Anna",
      state,
      deletionRequestedAt: null,
    },
    blockers,
    sharedOrgs: [{ id: "o1", name: "Studio", slug: "studio", admin: false }],
    rooms,
    subscription,
  };
}

function fakeStore({
  operator = true,
  summary = summaryOf(),
  begin = { state: "deleting", changed: true, deletionRequestedAt: new Date(0) },
  orgs = ["o1"],
  boards = ["b1"],
  files = [],
} = {}) {
  const calls = [];
  const store = {
    calls,
    rooms: new Map([["b1", { ydoc: { name: "b1" } }]]),
    async isInstanceOperator(userId) {
      calls.push(["operator", userId]);
      return operator;
    },
    async accountDeletionSummary(userId) {
      calls.push(["summary", userId]);
      return summary;
    },
    async personalOrgIds(userId) {
      calls.push(["orgs", userId]);
      return orgs;
    },
    async cancelAtPeriodEnd(orgId) {
      calls.push(["cancel", orgId]);
      return { cancel_at_period_end: true };
    },
    async beginAccountDeletion(args) {
      calls.push(["begin", args]);
      return begin;
    },
    async accountBoardIds(userId) {
      calls.push(["boards", userId]);
      return boards;
    },
    async writeState(boardId) {
      calls.push(["write", boardId]);
    },
    async accountFilesToErase(userId) {
      calls.push(["files", userId]);
      return files;
    },
    async revokePaymentMethod(orgId) {
      calls.push(["revoke", orgId]);
      return { revoked: 1 };
    },
    async anonymiseAccount({ userId }) {
      calls.push(["anonymise", userId]);
      return { state: "deleted", boards: 1, personalOrgs: 1, keptOrgs: 0 };
    },
  };
  return store;
}

function names(store) {
  return store.calls.map(([name]) => name);
}

describe("operator account deletion (ADR-257 §4)", () => {
  it("needs an instance operator before it even reads the target", async () => {
    const store = fakeStore({ operator: false });
    await expect(
      deleteAccountAsOperator({ store, userId: "u1", actorId: "u2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(names(store)).toEqual(["operator"]);
  });

  it("needs the operator to name themselves", async () => {
    const store = fakeStore();
    await expect(deleteAccountAsOperator({ store, userId: "u1" })).rejects.toMatchObject({
      code: "OPERATOR_REQUIRED",
      status: 401,
    });
    expect(store.calls).toEqual([]);
  });

  it("prints a dry run from the same summary and writes nothing", async () => {
    const store = fakeStore({
      summary: summaryOf({
        subscription: {
          plan: "pro",
          status: "active",
          currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
          cancelAtPeriodEnd: false,
        },
      }),
    });
    const result = await deleteAccountAsOperator({
      store,
      userId: "u1",
      actorId: "operator",
      dryRun: true,
    });
    expect(result).toMatchObject({ dryRun: true, blocked: false });
    expect(result.summary.user.email).toBe("person@example.test");
    expect(names(store)).toEqual(["operator", "summary"]);
  });

  it("refuses the last administrator of a shared organisation", async () => {
    const blockers = [{ id: "o1", name: "Studio", slug: "studio", members: 2 }];
    const store = fakeStore({ summary: summaryOf({ blockers }) });
    const error = await deleteAccountAsOperator({
      store,
      userId: "u1",
      actorId: "operator",
    }).catch((e) => e);
    expect(error).toMatchObject({ code: "LAST_ADMIN", status: 409 });
    expect(error.details).toEqual({ orgs: blockers });
    expect(names(store)).toEqual(["operator", "summary"]);
  });

  it("stops the account for fourteen days without erasing it", async () => {
    const store = fakeStore();
    const result = await deleteAccountAsOperator({
      store,
      userId: "u1",
      actorId: "operator",
      reason: "privacy request",
    });
    expect(result).toMatchObject({ state: "deleting", purged: false });
    expect(names(store)).toEqual(["operator", "summary", "orgs", "cancel", "begin"]);
    const begin = store.calls.find(([name]) => name === "begin")[1];
    expect(begin).toMatchObject({
      actorId: "operator",
      action: "account.delete_operator",
      reason: "privacy request",
      auditWhenUnchanged: false,
    });
  });

  it("erases now through the hourly job's own purge", async () => {
    // The exact binding, not a copy of the order in a second place.
    expect(operatorPurge).toBe(purgeAccount);

    const store = fakeStore({ files: [{ id: "f1", org_id: "o1" }] });
    const fileStore = { deleted: [], async delete(key) { this.deleted.push(key); } };
    const result = await deleteAccountAsOperator({
      store,
      userId: "u1",
      actorId: "operator",
      reason: "court order",
      purgeNow: true,
      fileStore,
    });

    expect(result).toMatchObject({ state: "deleted", purged: true, alreadyDeleted: false });
    expect(names(store)).toEqual([
      "operator",
      "summary",
      "orgs",
      "cancel",
      "begin",
      "boards",
      "write",
      "orgs",
      "revoke",
      "files",
      "anonymise",
    ]);
    // Rooms are unloaded before the bytes and the transaction, as in the hourly job.
    expect(names(store).indexOf("boards")).toBeLessThan(names(store).indexOf("files"));
    expect(names(store).indexOf("files")).toBeLessThan(names(store).indexOf("anonymise"));
    expect(fileStore.deleted).toEqual([
      "orgs/o1/files/f1/original",
      "orgs/o1/files/f1/w256",
      "orgs/o1/files/f1/w1024",
      "orgs/o1/files/f1/w2048",
    ]);
    const begin = store.calls.find(([name]) => name === "begin")[1];
    expect(begin.auditWhenUnchanged).toBe(true);
  });

  it("repeats --now on a tombstone as ok without a second audit row", async () => {
    const store = fakeStore({ summary: summaryOf({ state: "deleted" }) });
    await expect(
      deleteAccountAsOperator({
        store,
        userId: "u1",
        actorId: "operator",
        purgeNow: true,
        reason: "repeated",
      }),
    ).resolves.toMatchObject({ state: "deleted", alreadyDeleted: true, purged: false });
    // No begin, no purge: there is nothing left to write.
    expect(names(store)).toEqual(["operator", "summary"]);
  });

  it("refuses a repeated request without --now on a tombstone", async () => {
    const store = fakeStore({ summary: summaryOf({ state: "deleted" }) });
    await expect(
      deleteAccountAsOperator({ store, userId: "u1", actorId: "operator" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_DELETED", status: 409 });
    expect(names(store)).toEqual(["operator", "summary"]);
  });

  it("reports a lost race with a cancellation instead of a false success", async () => {
    const store = fakeStore();
    store.anonymiseAccount = async () => ({ state: "active" });
    await expect(
      deleteAccountAsOperator({
        store,
        userId: "u1",
        actorId: "operator",
        purgeNow: true,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_DELETED", status: 409 });
  });

  it("says so honestly when the store cannot check operators", async () => {
    await expect(
      deleteAccountAsOperator({ store: {}, userId: "u1", actorId: "operator" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_DELETION_UNAVAILABLE", status: 501 });
  });
});
