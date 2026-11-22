import { describe, expect, it } from "vitest";
import type { BoardFragment } from "@remo/doc";
import { decodeFragment, encodeFragment } from "./clipboard";

/**
 * The clipboard envelope (ADR-053).
 *
 * A fragment travels as our own JSON in `text/plain`; the editor uses the same decoder
 * to tell "objects" from "characters" when a paste lands inside an open note
 * (ADR-252 §5.4.2).
 */

const fragment: BoardFragment = {
  version: 1,
  widgets: [
    { id: "s1", type: "sticky_note", parentId: null, x: 0, y: 0, width: 200, height: 200 },
  ],
  texts: { s1: { delta: [{ insert: "note", attributes: { bold: true } }] } },
  kanbans: {},
  placements: {},
  roots: ["s1"],
};

describe("clipboard fragments", () => {
  it("round-trips a fragment through the envelope", () => {
    expect(decodeFragment(encodeFragment(fragment))).toEqual(fragment);
  });

  it("recognises only its own kind and version", () => {
    expect(decodeFragment("hello")).toBeNull();
    expect(decodeFragment("**not a fragment**")).toBeNull();
    expect(decodeFragment('{"kind":"remo/other","version":1,"fragment":{}}')).toBeNull();
    expect(
      decodeFragment(JSON.stringify({ kind: "remo/fragment", version: 2, fragment })),
    ).toBeNull();
    expect(
      decodeFragment(JSON.stringify({ kind: "remo/fragment", version: 1, fragment: {} })),
    ).toBeNull();
  });

  it("does not mistake a note's text for a fragment", () => {
    expect(decodeFragment("{\"kind\":\"remo/fragment\",\"version\":1}")).toBeNull();
    expect(decodeFragment("[docs](https://example.test)")).toBeNull();
  });
});
