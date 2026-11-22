import { describe, expect, it } from "vitest";
import { deletedUserName } from "./deletedUser";

describe("deletedUserName", () => {
  it("keeps a name the account still has", () => {
    expect(deletedUserName("Anna Petrova", "Deleted user")).toBe("Anna Petrova");
  });

  it("uses the reader's label for a tombstone or a missing name", () => {
    expect(deletedUserName("", "Удалённый участник")).toBe("Удалённый участник");
    expect(deletedUserName("   ", "Удалённый участник")).toBe("Удалённый участник");
    expect(deletedUserName(null, "Deleted user")).toBe("Deleted user");
    expect(deletedUserName(undefined, "Deleted user")).toBe("Deleted user");
  });
});
