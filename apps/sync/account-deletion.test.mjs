import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_GRACE_MS,
  AccountDeletionError,
  USER_REFERENCES,
  cancelAccountDeletion,
  deleteAccount,
  deletionDueAt,
} from "./account-deletion.mjs";

const DAY = 24 * 60 * 60 * 1000;

function fakeStore({ blockers = [], result = { state: "deleting", changed: true } } = {}) {
  const calls = [];
  return {
    calls,
    async accountDeletionBlockers(userId) {
      calls.push(["blockers", userId]);
      return blockers;
    },
    async beginAccountDeletion(args) {
      calls.push(["begin", args]);
      return result;
    },
  };
}

describe("account.delete (ADR-257 §1–§2)", () => {
  it("gives the person fourteen days before the erasure", () => {
    expect(ACCOUNT_DELETION_GRACE_MS).toBe(14 * DAY);
    const requested = new Date("2026-11-22T12:00:00Z");
    expect(deletionDueAt(requested).toISOString()).toBe("2026-12-06T12:00:00.000Z");
  });

  it("refuses a caller who is not the account itself", async () => {
    const store = fakeStore();
    await expect(
      deleteAccount({ store, userId: "u1", actorId: "u2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(deleteAccount({ store, userId: "u1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(store.calls).toEqual([]);
  });

  it("needs a session before it names blockers", async () => {
    const store = fakeStore();
    await expect(deleteAccount({ store, actorId: "u1" })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
    });
    expect(store.calls).toEqual([]);
  });

  it("names the shared organisations that still need an administrator", async () => {
    const blockers = [{ id: "o1", name: "Studio", slug: "studio", members: 3 }];
    const store = fakeStore({ blockers });
    const error = await deleteAccount({ store, userId: "u1", actorId: "u1" }).catch((e) => e);
    expect(error).toBeInstanceOf(AccountDeletionError);
    expect(error).toMatchObject({ code: "LAST_ORG_ADMIN", status: 409 });
    expect(error.details).toEqual({ orgs: blockers });
    // Nothing was written while an organisation still blocks the request (§1.3).
    expect(store.calls.map(([name]) => name)).toEqual(["blockers"]);
  });

  it("is idempotent: a repeated request reports the first one", async () => {
    const store = fakeStore({
      result: { state: "deleting", changed: false, deletionRequestedAt: new Date(0) },
    });
    await expect(deleteAccount({ store, userId: "u1", actorId: "u1" })).resolves.toMatchObject({
      state: "deleting",
      changed: false,
    });
  });

  it("cancels the personal plan through the billing mechanism, before the stop", async () => {
    const calls = [];
    const store = {
      async accountDeletionBlockers() {
        calls.push("blockers");
        return [];
      },
      async personalOrgIds() {
        calls.push("personal");
        return ["o1"];
      },
      async cancelAtPeriodEnd(orgId) {
        calls.push(`cancel:${orgId}`);
        return { cancel_at_period_end: true };
      },
      async beginAccountDeletion() {
        calls.push("begin");
        return { state: "deleting", changed: true };
      },
    };
    await deleteAccount({ store, userId: "u1", actorId: "u1" });
    expect(calls).toEqual(["blockers", "personal", "cancel:o1", "begin"]);
  });

  it("turns a missing or erased account into a stable error", async () => {
    const missing = fakeStore({ result: { state: "missing" } });
    await expect(
      deleteAccount({ store: missing, userId: "u1", actorId: "u1" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND", status: 404 });

    const deleted = fakeStore({ result: { state: "deleted" } });
    await expect(
      deleteAccount({ store: deleted, userId: "u1", actorId: "u1" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_DELETED", status: 409 });
  });

  it("says so honestly when the store cannot delete accounts", async () => {
    await expect(
      deleteAccount({ store: {}, userId: "u1", actorId: "u1" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_DELETION_UNAVAILABLE", status: 501 });
  });
});

describe("account.delete cancellation (ADR-257 §2.4)", () => {
  const now = () => new Date("2026-11-22T12:00:00Z");

  it("passes the grace cutoff to the store and reports the restored state", async () => {
    const calls = [];
    const store = {
      async cancelAccountDeletion(args) {
        calls.push(args);
        return { state: "active", changed: true };
      },
    };
    await expect(
      cancelAccountDeletion({ store, userId: "u1", actorId: "u1", now }),
    ).resolves.toMatchObject({ state: "active", changed: true });
    expect(calls[0].cutoff.toISOString()).toBe("2026-11-08T12:00:00.000Z");
  });

  it("refuses a cancellation after the fourteen days or an erased row", async () => {
    const expired = {
      async cancelAccountDeletion() {
        return { state: "expired", changed: false };
      },
    };
    await expect(
      cancelAccountDeletion({ store: expired, userId: "u1", actorId: "u1" }),
    ).rejects.toMatchObject({ code: "TOO_LATE", status: 410 });

    const deleted = {
      async cancelAccountDeletion() {
        return { state: "deleted", changed: false };
      },
    };
    await expect(
      cancelAccountDeletion({ store: deleted, userId: "u1", actorId: "u1" }),
    ).rejects.toMatchObject({ code: "TOO_LATE", status: 410 });
  });

  it("lets only the account itself undo its request", async () => {
    const store = {
      async cancelAccountDeletion() {
        return { state: "active", changed: true };
      },
    };
    await expect(
      cancelAccountDeletion({ store, userId: "u1", actorId: "u2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
});

describe("the reference table is a decision for every foreign key (ADR-257, §3)", () => {
  it("uses only the three outcomes the purge implements", () => {
    for (const [column, action] of Object.entries(USER_REFERENCES)) {
      expect(column, `${column} must be table.column`).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(["delete", "keep", "conditional"], column).toContain(action);
    }
  });

  it("covers the columns the purge touches explicitly", () => {
    expect(USER_REFERENCES["sessions.user_id"]).toBe("delete");
    expect(USER_REFERENCES["agents.owner_id"]).toBe("delete");
    expect(USER_REFERENCES["mail_outbox.user_id"]).toBe("delete");
    expect(USER_REFERENCES["consent_events.user_id"]).toBe("keep");
    expect(USER_REFERENCES["legal_acceptances.user_id"]).toBe("keep");
    expect(USER_REFERENCES["invitations.created_by"]).toBe("conditional");
  });
});
