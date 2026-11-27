import type { Presence } from "@remo/doc";
import { describe, expect, it } from "vitest";
import { REMOTE_CURSOR, cursorName, drawRemoteCursor } from "./remoteCursor";

/**
 * A 2D context stand-in: methods are recorded no-ops, property writes land in `state`,
 * and `measureText` reports a width proportional to the string so a plate can be
 * checked against the text it holds.
 */
function fakeContext() {
  const calls: string[] = [];
  const texts: string[] = [];
  const measured: string[] = [];
  const fills: string[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") {
        return (text: string) => {
          measured.push(text);
          return { width: text.length * 7 };
        };
      }
      return (...args: unknown[]) => {
        calls.push(String(key));
        if (key === "fillText" && typeof args[0] === "string") texts.push(args[0]);
        if (key === "fill" && typeof state.fillStyle === "string") fills.push(state.fillStyle);
        return undefined;
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts, measured, fills, state };
}

function peer(overrides: Partial<Presence> = {}): Presence {
  return {
    clientId: 1,
    sessionKey: "ilya",
    accountId: null,
    name: "Илья Петров",
    handle: "",
    label: "Илья Петров",
    joinedAt: 0,
    color: "#c93e0a",
    cursor: { x: 40, y: 50 },
    self: false,
    camera: null,
    followTo: null,
    stopFollowersAt: null,
    invite: null,
    presenting: null,
    reaction: null,
    ...overrides,
  };
}

describe("a colleague's cursor (ADR-265 §3.4)", () => {
  it("puts the name on the plate, not initials", () => {
    const { ctx, texts } = fakeContext();
    drawRemoteCursor(ctx, peer(), 1);
    expect(texts).toEqual(["Илья Петров"]);
    expect(texts[0]).not.toBe("ИП");
  });

  it("leaves the name out when the peer has none", () => {
    const { ctx, texts, calls } = fakeContext();
    drawRemoteCursor(ctx, peer({ name: "", label: "" }), 1);
    expect(texts).toEqual([]);
    // The arrow is still drawn.
    expect(calls).toContain("fill");
  });

  it("shortens a long name so the plate never covers the board", () => {
    const long = "Александра Константинопольская-Северова";
    const shortened = cursorName(long);
    expect(shortened.length).toBe(REMOTE_CURSOR.plate.maxChars);
    expect(shortened.endsWith("…")).toBe(true);
    expect(long.startsWith(shortened.slice(0, -1))).toBe(true);

    const { ctx, texts, measured } = fakeContext();
    drawRemoteCursor(ctx, peer({ name: long, label: long }), 1);
    expect(texts).toEqual([shortened]);
    expect(measured).toContain(shortened);
  });

  it("keeps a short name whole and trims the edges", () => {
    expect(cursorName("  Аня  ")).toBe("Аня");
    expect(cursorName("Sess (2)")).toBe("Sess (2)");
  });

  it("draws with the person's colour and the light text token", () => {
    const { ctx, fills, state } = fakeContext();
    drawRemoteCursor(ctx, peer(), 1);
    // Arrow first, then the plate: both are the person's colour.
    expect(fills.filter((fill) => fill === "#c93e0a").length).toBeGreaterThanOrEqual(2);
    // The name is painted last, in the light text colour of the palette.
    expect(state.fillStyle).toBe("#ffffff");
  });

  it("fades with the alpha the motion gives, and skips a hidden cursor", () => {
    const faded = fakeContext();
    drawRemoteCursor(faded.ctx, peer(), 1, undefined, undefined, 0.4);
    expect(faded.state.globalAlpha).toBe(0.4);
    expect(faded.texts).toEqual(["Илья Петров"]);

    const hidden = fakeContext();
    drawRemoteCursor(hidden.ctx, peer(), 1, undefined, undefined, 0);
    expect(hidden.calls).toEqual([]);
    expect(hidden.texts).toEqual([]);
  });

  it("does not paint a peer without a cursor", () => {
    const { ctx, calls } = fakeContext();
    drawRemoteCursor(ctx, peer({ cursor: null }), 1);
    expect(calls).toEqual([]);
  });
});
