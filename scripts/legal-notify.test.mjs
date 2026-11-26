/**
 * `pnpm legal:notify` is an operator action, not a start-up side effect (ADR-256 §5).
 *
 * The test proves the command line refuses the wrong revision and that the plan speaks
 * each recipient's language before a single row is queued.
 */
import { describe, expect, it } from "vitest";
import { formatEffective, noticePlan, parseNotifyArgs } from "./legal-notify.mjs";

describe("legal:notify arguments", () => {
  it("accepts a document, an optional date and a dry run", () => {
    expect(parseNotifyArgs(["--doc", "consent"])).toEqual({
      doc: "consent",
      date: null,
      dryRun: false,
    });
    expect(parseNotifyArgs(["--doc", "consent", "--date", "2027-01-01", "--dry-run"])).toEqual({
      doc: "consent",
      date: "2027-01-01",
      dryRun: true,
    });
  });

  it("refuses a missing document, an unknown flag and a fake date", () => {
    expect(() => parseNotifyArgs([])).toThrow(/--doc/);
    expect(() => parseNotifyArgs(["--doc", "consent", "--everyone"])).toThrow(/does not take/);
    expect(() => parseNotifyArgs(["--doc", "consent", "--date", "2027-02-30"])).toThrow(/date/);
  });
});

describe("the letter plan", () => {
  const users = [
    { id: "u-1", email: "anna@example.test", name: "Анна", lang: "ru" },
    { id: "u-2", email: "john@example.test", name: "John", lang: "en" },
    { id: "u-3", email: "no-lang@example.test", name: null, lang: null },
  ];
  const title = { ru: "Согласие на обработку персональных данных", en: "Personal data processing consent" };

  it("names the document in each recipient's language", () => {
    const plan = noticePlan({ document: "consent", title, effective: "2027-01-01", users });
    expect(plan.map((item) => item.locale)).toEqual(["ru", "en", "en"]);
    expect(plan[0].params.doc).toBe("Согласие на обработку персональных данных");
    expect(plan[1].params.doc).toBe("Personal data processing consent");
    expect(plan[2].params.name).toBeNull();
    const changes = { ru: "Изменили сроки." };
    const fallback = noticePlan({ document: "consent", title, changes, effective: "2027-01-01", users });
    expect(fallback.map(item => item.params.changes)).toEqual([changes.ru, changes.ru, changes.ru]);
  });

  it("prints the effective date the way the reader says it", () => {
    expect(formatEffective("2027-01-01", "ru")).toMatch(/2027/);
    expect(formatEffective("2027-01-01", "en")).toMatch(/2027/);
    expect(formatEffective("2027-01-01", "ru")).not.toBe(formatEffective("2027-01-01", "en"));
  });
});
