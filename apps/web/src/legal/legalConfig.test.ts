import { describe, expect, it } from "vitest";
import { readLegalConfig, signupLegalDocuments } from "./legalConfig";

const HASH = "a".repeat(64);

function document(overrides: Record<string, unknown> = {}) {
  return {
    doc: "offer",
    zone: "ru",
    version: 1,
    sha256: HASH,
    effective: "2026-12-01",
    required: "signup",
    reaccept: true,
    status: "published",
    withdrawable: false,
    url: "https://app.remuka.ru/legal/offer",
    ...overrides,
  };
}

describe("the legal field of /config (ADR-256 §4)", () => {
  it("keeps the documents the server publishes", () => {
    const legal = readLegalConfig({
      documents: [
        document(),
        document({ doc: "consent", withdrawable: true }),
        document({ doc: "privacy", required: "none", reaccept: false }),
      ],
    });
    expect(legal.map((entry) => entry.doc)).toEqual(["offer", "consent", "privacy"]);
    expect(legal[1]!.withdrawable).toBe(true);
    expect(signupLegalDocuments(legal).map((entry) => entry.doc)).toEqual(["offer", "consent"]);
  });

  it("drops a malformed document instead of rendering it", () => {
    const legal = readLegalConfig({
      documents: [
        document({ doc: "Bad Doc" }),
        document({ sha256: "nope" }),
        document({ version: 0 }),
        document({ required: "sometimes" }),
        document({ url: "javascript:alert(1)" }),
        document({ url: "https://user:pass@example.test/legal/offer" }),
        document(),
      ],
    });
    expect(legal).toHaveLength(1);
    expect(legal[0]!.doc).toBe("offer");
  });

  it("treats a missing or broken field as no documents", () => {
    expect(readLegalConfig(undefined)).toEqual([]);
    expect(readLegalConfig({})).toEqual([]);
    expect(readLegalConfig({ documents: "offer" })).toEqual([]);
    // A duplicate id is one document, not two checkboxes for the same acceptance.
    expect(readLegalConfig({ documents: [document(), document()] })).toHaveLength(1);
  });
});
