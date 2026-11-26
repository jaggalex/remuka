import { describe, expect, it } from "vitest";
import type { Widget } from "@remo/model";
import { cardAssignees, cardsMatching, daysPastDue } from "./cardFilter";

const card = (id: string, patch: Partial<Widget> = {}): Widget => ({
  id,
  type: "card",
  parentId: "k1",
  x: 0,
  y: 0,
  width: 200,
  height: 80,
  ...patch,
});

describe("card filter", () => {
  it("counts calendar boundaries, including DST changes and leap day", () => {
    expect(daysPastDue(undefined, "2026-11-23")).toBe(0);
    expect(daysPastDue("2026-11-23", "2026-11-23")).toBe(0);
    expect(daysPastDue("2026-11-24", "2026-11-23")).toBe(0);
    expect(daysPastDue("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysPastDue("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysPastDue("2024-02-28", "2024-03-01")).toBe(2);
  });

  it("matches by assignee", () => {
    const widgets = [card("a", { assigneeId: "u1" }), card("b", { assigneeId: "u2" })];
    expect(cardsMatching(widgets, { assigneeId: "u1", due: "any" }).map((w) => w.id)).toEqual(["a"]);
  });

  it("separates overdue from no due date", () => {
    const widgets = [
      card("late", { dueAt: "2026-10-01" }),
      card("future", { dueAt: "2026-12-01" }),
      card("none"),
    ];
    expect(cardsMatching(widgets, { assigneeId: "", due: "overdue" }, "2026-10-29").map((w) => w.id)).toEqual(["late"]);
    expect(cardsMatching(widgets, { assigneeId: "", due: "none" }).map((w) => w.id)).toEqual(["none"]);
  });

  it("lists distinct assignees by name", () => {
    const widgets = [
      card("a", { assigneeId: "u1", assigneeName: "Ann" }),
      card("b", { assigneeId: "u1", assigneeName: "Ann" }),
      card("c", { assigneeId: "u2", assigneeName: "Bob" }),
    ];
    expect(cardAssignees(widgets)).toEqual([
      { id: "u1", name: "Ann" },
      { id: "u2", name: "Bob" },
    ]);
  });

  it("ignores objects that are not cards", () => {
    const widgets: Widget[] = [{ ...card("s"), type: "sticky_note" }];
    expect(cardsMatching(widgets, { assigneeId: "", due: "any" })).toEqual([]);
  });
});
