import { beforeEach, describe, expect, it, vi } from "vitest";
import { TONE_LEVELS } from "@remo/model";
import {
  rememberedRouting,
  rememberedShapeKind,
  rememberedStickerFill,
  rememberRouting,
  rememberShapeKind,
  rememberStickerFill,
} from "./toolDefaults";
import { defaultStickerFill } from "./object-panel/palette";

/** One in-memory `localStorage`, enough for the preference contract. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe("the rail remembers its variant choices (ADR-266 §10a)", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
  });

  it("falls back to the model's defaults before anything is chosen", () => {
    expect(rememberedStickerFill()).toBe(defaultStickerFill());
    expect(rememberedShapeKind()).toBe("rectangle");
    expect(rememberedRouting()).toBeNull();
  });

  it("keeps a note fill, a shape kind and a line type for the next object", () => {
    rememberStickerFill(TONE_LEVELS.blue[100]);
    rememberShapeKind("ellipse");
    rememberRouting("elbow");
    expect(rememberedStickerFill()).toBe(TONE_LEVELS.blue[100]);
    expect(rememberedShapeKind()).toBe("ellipse");
    expect(rememberedRouting()).toBe("elbow");
  });

  it("ignores a value the product does not offer", () => {
    window.localStorage.setItem("remo.tool.shape", "hexagon");
    window.localStorage.setItem("remo.tool.sticky", "#123456");
    window.localStorage.setItem("remo.tool.connector", "zigzag");
    expect(rememberedShapeKind()).toBe("rectangle");
    expect(rememberedStickerFill()).toBe(defaultStickerFill());
    expect(rememberedRouting()).toBeNull();
  });

  it("does not throw without storage", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("denied");
      },
    });
    expect(rememberedShapeKind()).toBe("rectangle");
    expect(rememberedRouting()).toBeNull();
    expect(rememberedStickerFill()).toBe(defaultStickerFill());
  });
});
