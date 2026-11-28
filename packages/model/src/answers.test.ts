import { describe, expect, it } from "vitest";
import {
  answersKey,
  backTextKey,
  frameIdOfAnswersKey,
  hasBackSide,
  sideOf,
  widgetIdOfTextKey,
} from "./answers";

const shown = new Set(["f1"]);

describe("two-sided sticky notes (ADR-320)", () => {
  it("builds and reads the meta and text keys", () => {
    expect(answersKey("f1")).toBe("answers:f1");
    expect(frameIdOfAnswersKey("answers:f1")).toBe("f1");
    expect(frameIdOfAnswersKey("title")).toBeNull();
    expect(frameIdOfAnswersKey("answers:")).toBeNull();
    expect(backTextKey("s1")).toBe("s1#back");
    expect(widgetIdOfTextKey("s1#back")).toBe("s1");
    expect(widgetIdOfTextKey("s1")).toBe("s1");
  });

  it("treats whitespace as no back side", () => {
    expect(hasBackSide({ type: "sticky_note", backContent: "answer" })).toBe(true);
    expect(hasBackSide({ type: "sticky_note", backContent: "  \n" })).toBe(false);
    expect(hasBackSide({ type: "sticky_note" })).toBe(false);
    expect(hasBackSide({ type: "text", backContent: "answer" })).toBe(false);
  });

  it("draws the back only for a two-sided sticker in a shown frame", () => {
    const note = { type: "sticky_note" as const, parentId: "f1" };
    expect(sideOf(note, true, shown)).toBe("back");
    expect(sideOf(note, false, shown)).toBe("front");
    expect(sideOf(note, true, new Set())).toBe("front");
    expect(sideOf({ ...note, parentId: null }, true, shown)).toBe("front");
    expect(sideOf({ ...note, type: "text" }, true, shown)).toBe("front");
  });

  it("uses the direct parent, so a nested frame owns its stickers", () => {
    const inNested = { type: "sticky_note" as const, parentId: "nested" };
    expect(sideOf(inNested, true, new Set(["outer"]))).toBe("front");
    expect(sideOf(inNested, true, new Set(["nested"]))).toBe("back");
  });
});
