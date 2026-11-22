import { describe, expect, it } from "vitest";
import { brandName } from "@remo/brand";
import { interpolate } from "./i18n";
import { enCore } from "./i18n/en-core";
import { ruCore } from "./i18n/ru-core";
import {
  MOVE_BANNER_KEY,
  daysUntilMove,
  dismissMoveBanner,
  moveBannerDismissed,
  moveDate,
  moveHost,
  parseMoveDay,
  shouldShowMove,
} from "./moveBanner";

const MOVE = { to: "https://app.remuka.com", at: "2026-12-01" };
/** The reader's local calendar day; the function compares dates, not instants. */
const today = (year: number, month: number, day: number) => new Date(year, month - 1, day);

describe("whether the move notice is due (spec/rebrand-fixes.md §1)", () => {
  it("appears exactly in the last seven days, including the day itself", () => {
    // Day offsets from the move day: −8 and +1 are silent, −7…0 show the notice.
    for (const [offset, expected] of [
      [-8, false],
      [-7, true],
      [0, true],
      [1, false],
    ] as const) {
      const day = today(2026, 12, 1 + offset);
      expect(shouldShowMove(MOVE, day), `${offset} days from the move`).toBe(expected);
      expect(daysUntilMove(MOVE.at, day)).toBe(offset === 0 ? 0 : -offset);
    }
  });

  it("needs a valid https address and a real calendar day", () => {
    expect(shouldShowMove(null, today(2026, 11, 25))).toBe(false);
    expect(shouldShowMove({ ...MOVE, at: "2026-02-30" }, today(2026, 2, 20))).toBe(false);
    expect(shouldShowMove({ ...MOVE, to: "http://app.remuka.com" }, today(2026, 11, 25))).toBe(false);
    expect(shouldShowMove({ ...MOVE, to: "not a url" }, today(2026, 11, 25))).toBe(false);
  });

  it("counts calendar days across a month boundary and a clock change", () => {
    expect(daysUntilMove("2026-03-01", today(2026, 2, 22))).toBe(7);
    // The local day is the unit: an evening in late March is still the same count.
    expect(daysUntilMove("2026-04-01", new Date(2026, 2, 29, 23, 30))).toBe(3);
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseMoveDay("2026-02-29")).toBeNull();
    expect(parseMoveDay("2026-13-01")).toBeNull();
    expect(parseMoveDay("01.12.2026")).toBeNull();
    expect(parseMoveDay("2026-12-01")).toBe(Date.UTC(2026, 11, 1));
  });
});

describe("the move notice text", () => {
  const date = (lang: "ru" | "en") => moveDate(MOVE.at, lang);

  function fill(lang: "ru" | "en", productName: string | null) {
    const table = lang === "ru" ? ruCore : enCore;
    return interpolate(table["move.body"], {
      product: brandName({ locale: lang, productName }),
      host: moveHost(MOVE.to),
      date: date(lang),
    });
  }

  it("names the brand, the new host and the date in Russian", () => {
    expect(fill("ru", null)).toBe(
      `Ремука переезжает на app.remuka.com ${date("ru")}. После переезда войдите заново — комнаты и данные останутся на месте.`,
    );
  });

  it("uses an installation's own name when the service supplies one", () => {
    expect(fill("ru", "Acme Boards")).toContain("Acme Boards переезжает на app.remuka.com");
    expect(fill("en", "Acme Boards")).toContain(
      "Acme Boards is moving to app.remuka.com on",
    );
  });

  it("says the same in English and keeps the brand without an own name", () => {
    expect(fill("en", null)).toBe(
      `Remuka is moving to app.remuka.com on ${date("en")}. Sign in again after the move — your rooms and data stay where they are.`,
    );
    expect(fill("en", "Acme Boards")).not.toContain("Remuka");
  });

  it("writes the date in the interface language", () => {
    expect(moveDate("2026-12-01", "ru")).toMatch(/декабря/);
    expect(moveDate("2026-12-01", "en")).toMatch(/December/);
  });
});

describe("closing the notice", () => {
  it("remembers the dismissal under the code-name key for this session only", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    expect(MOVE_BANNER_KEY).toBe("remo.moveBanner.dismissed");
    expect(moveBannerDismissed(storage)).toBe(false);
    dismissMoveBanner(storage);
    expect(moveBannerDismissed(storage)).toBe(true);
    expect(values.get(MOVE_BANNER_KEY)).toBe("1");
  });

  it("stays visible when storage is refused", () => {
    const refused = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(moveBannerDismissed(refused)).toBe(false);
    expect(() => dismissMoveBanner(refused)).not.toThrow();
  });
});
