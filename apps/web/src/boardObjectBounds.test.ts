import { fitToBounds, layoutKanban, visibleWorldRect } from "@remo/canvas";
import { rotatedBounds, type Widget } from "@remo/model";
import { expect, it } from "vitest";
import { boardObjectBounds } from "./boardObjectBounds";

const note: Widget = { id: "note", type: "sticky_note", x: 1800, y: 100, width: 200, height: 120, parentId: null };
const board: Widget = { ...note, id: "board", type: "kanban", x: 4500, y: 3500, width: 800, height: 500 };
const card: Widget = { ...note, id: "card", type: "card", parentId: board.id, x: 0, y: 0 };

it("fits a distant note and a kanban cell to a mobile canvas, excluding deleted and unrelated objects", () => {
  const layout = layoutKanban(board, [card], {
    columns: [{ id: "column", title: "Doing", width: 800, accent: "" }],
    swimlanes: [{ id: "lane", title: "Team" }],
    cards: { card: { columnId: "column", swimlaneId: "lane", order: "n" } },
    newColumnWidth: 800, headerHeight: 96,
  });
  const placedCard = { ...card, ...layout.placements[0]! };
  const widgets = new Map([note, board, placedCard].map(widget => [widget.id, widget]));
  const bounds = boardObjectBounds(["missing", card.id, note.id], id => widgets.get(id), {})!;
  expect(bounds.x).toBe(rotatedBounds(note).x);
  expect(bounds.x + bounds.width).toBe(placedCard.x + placedCard.width / 2);
  const viewport = { x: 0, y: 0, width: 390, height: 700 };
  const visible = visibleWorldRect(fitToBounds(bounds, viewport), viewport);
  for (const widget of [note, placedCard]) {
    const box = rotatedBounds(widget);
    expect(box.x).toBeGreaterThanOrEqual(visible.x);
    expect(box.y).toBeGreaterThanOrEqual(visible.y);
    expect(box.x + box.width).toBeLessThanOrEqual(visible.x + visible.width);
    expect(box.y + box.height).toBeLessThanOrEqual(visible.y + visible.height);
  }
  expect(boardObjectBounds(["missing"], id => widgets.get(id), {})).toBeNull();
});

it("uses live endpoints when the session object is a connector", () => {
  const end = { ...note, id: "end", x: 3000 };
  const line: Widget = { ...note, id: "line", type: "connector", x: 0, y: 0,
    start: { item: note.id }, end: { item: end.id } };
  const widgets = new Map([note, end, line].map(widget => [widget.id, widget]));
  expect(boardObjectBounds([line.id], id => widgets.get(id), {}))
    .toMatchObject({ x: 1900, y: 100, width: 1000, height: 0 });
  widgets.delete(end.id);
  expect(boardObjectBounds([line.id], id => widgets.get(id), {})).toBeNull();
});
