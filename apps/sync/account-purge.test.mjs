import { describe, expect, it } from "vitest";
import { createAccountPurge } from "./account-purge.mjs";

/**
 * The order inside one purge (ADR-257 §2.5, §3): close sockets, flush the personal rooms,
 * stop a saved card, then anonymise. A later room flush would otherwise write against a
 * row the erasure has already deleted.
 */
function fakeStore({ due = [{ id: "u1" }], boards = ["b1"], orgs = ["o1"] } = {}) {
  const calls = [];
  return {
    calls,
    rooms: new Map([["b1", { ydoc: { name: "b1" } }]]),
    async accountsDueForDeletion() {
      calls.push("due");
      return due;
    },
    async accountBoardIds(userId) {
      calls.push(`boards:${userId}`);
      return boards;
    },
    async personalOrgIds(userId) {
      calls.push(`orgs:${userId}`);
      return orgs;
    },
    async revokePaymentMethod(orgId) {
      calls.push(`revoke:${orgId}`);
      return { revoked: 1 };
    },
    async writeState(docName, ydoc) {
      calls.push(`write:${docName}:${ydoc.name}`);
    },
    async anonymiseAccount({ userId }) {
      calls.push(`purge:${userId}`);
      return { state: "deleted" };
    },
  };
}

function jobFor(store, connections) {
  return createAccountPurge({
    store,
    connections,
    log: { log() {}, error() {} },
    now: () => new Date(),
  });
}

describe("account purge unloads rooms and cards first", () => {
  it("closes the person's sockets, flushes their rooms, then erases", async () => {
    const store = fakeStore();
    const connections = {
      closeUserConnections(userId) {
        store.calls.push(`close:${userId}`);
      },
    };
    await expect(jobFor(store, connections).runOnce()).resolves.toBe(1);
    expect(store.calls).toEqual([
      "due",
      "boards:u1",
      "close:u1",
      "write:b1:b1",
      "orgs:u1",
      "revoke:o1",
      "purge:u1",
    ]);
  });

  it("revokes the saved card before the organisation is anonymised", async () => {
    const store = fakeStore({ boards: [] });
    const calls = [];
    store.revokePaymentMethod = async (orgId) => {
      calls.push(`revoke:${orgId}`);
      return { revoked: 1 };
    };
    store.anonymiseAccount = async ({ userId }) => {
      calls.push(`purge:${userId}`);
      return { state: "deleted" };
    };
    await jobFor(store).runOnce();
    expect(calls).toEqual(["revoke:o1", "purge:u1"]);
  });

  it("needs no socket registry and no in-memory room to finish", async () => {
    const store = fakeStore({ boards: [] });
    store.accountBoardIds = undefined;
    await expect(jobFor(store, null).runOnce()).resolves.toBe(1);
    expect(store.calls).toEqual(["due", "orgs:u1", "revoke:o1", "purge:u1"]);
  });
});
