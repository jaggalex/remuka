import { test, expect } from "@playwright/test";
import { freshBoard, savedAfterEdit, selectKanbanCard, watchSave } from "./helpers";

test("a card keeps status, assignee and a date range", async ({ page }) => {
  const account = await freshBoard(page, "card-fields");
  const cardId = await selectKanbanCard(page);

  const inspector = page.locator(".card-fields");
  await expect(inspector).toBeVisible();
  await watchSave(page);

  await inspector.locator("select").first().selectOption("in_progress");
  const assignee = inspector.locator("select").nth(1);
  await expect(assignee.locator("option")).toHaveCount(2);
  await assignee.selectOption({ index: 1 });
  await inspector.locator('input[type="date"]').first().fill("2026-10-30");
  await inspector.locator('input[type="date"]').nth(1).fill("2026-10-31");
  await expect(inspector.locator("select").first()).toHaveValue("in_progress");
  await savedAfterEdit(page);
  // The projection is a server-side mirror; waiting for it proves the edit reached
  // the service before the reload, not only the local Yjs copy.
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/boards/${account.boardId}/widgets`);
      const data = (await response.json()) as {
        widgets?: Array<{ id: string; props?: { status?: string } }>;
      };
      return data.widgets?.find((widget) => widget.id === cardId)?.props?.status;
    })
    .toBe("in_progress");

  await page.reload();
  await selectKanbanCard(page, cardId);

  const restored = page.locator(".card-fields");
  await expect(restored.locator("select").first()).toHaveValue("in_progress");
  await expect(restored.locator("select").nth(1)).not.toHaveValue("");
  await expect(restored.locator('input[type="date"]').first()).toHaveValue("2026-10-30");
  await expect(restored.locator('input[type="date"]').nth(1)).toHaveValue("2026-10-31");
});

test("the card inspector keeps its title, dated fields, tags and column colour together", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-23T12:00:00Z"));
  await freshBoard(page, "card-inspector");
  const cardId = await selectKanbanCard(page);
  const panel = page.locator(".card-fields");
  const status = panel.getByRole("combobox", { name: "Status", exact: true });
  const title = await page.evaluate(id => {
    const widget = (window as any).__remo.widgets.find((w: { id: string }) => w.id === id);
    return widget.title || widget.content;
  }, cardId);
  await expect(panel.locator(".card-record-title")).toHaveText(title);
  await status.selectOption("in_progress");
  await panel.getByLabel("Start", { exact: true }).fill("2026-11-20");
  const due = panel.getByLabel("Due", { exact: true });
  await due.fill("2026-11-22");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const titleLines = await panel.locator(".inspector-title").evaluate(heading => {
      const text = document.createRange();
      text.selectNodeContents(heading);
      return text.getClientRects().length;
    });
    expect(titleLines).toBe(1);
    await expect(panel.locator(".card-overdue")).toHaveText("The due date was yesterday.");
    const startBox = (await panel.getByLabel("Start", { exact: true }).boundingBox())!;
    const dueBox = (await due.boundingBox())!;
    expect(dueBox.y).toBe(startBox.y);
    expect(dueBox.x).toBeGreaterThanOrEqual(startBox.x + startBox.width);
    expect(dueBox.x + dueBox.width).toBeLessThanOrEqual(width);
    await expect(panel.locator(".tags-fold > summary")).toBeVisible();
    await expect(panel.getByRole("radio", { name: "Same as column" })).toBeChecked();
  }
  const own = panel.getByRole("radio", { name: "Custom colour", exact: true });
  await own.check();
  const palette = panel.getByRole("radiogroup", { name: "Card colour" });
  await palette.getByRole("radio").nth(2).click();
  await expect(own).toBeChecked();
  await panel.getByRole("radio", { name: "Same as column" }).check();
  await expect(palette).toHaveCount(0);
  await due.fill("2026-11-23");
  await expect(panel.locator(".card-overdue")).toHaveCount(0);
  await due.fill("2026-11-25");
  await expect(panel.locator(".card-overdue")).toHaveCount(0);
});

test("selects cards by assignee and due state", async ({ page }) => {
  await freshBoard(page, "card-filter");
  await selectKanbanCard(page);

  const fields = page.locator(".card-fields");
  await fields.locator("select").nth(1).selectOption({ index: 1 });

  // The filter belongs to the room: it is in the panel with nothing selected (ADR-236),
  // and what it finds becomes the selection.
  const selected = () =>
    page.evaluate(() => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds.length);
  await page.keyboard.press("Escape");
  await expect.poll(selected).toBe(0);
  const filter = page.locator(".card-filter");
  await filter.locator("select").first().selectOption({ index: 1 });
  await filter.getByRole("button", { name: "Select cards" }).click();
  await expect.poll(selected).toBe(1);
  await expect(filter).toHaveCount(0);
  await expect(page.locator(".canvas-notice")).toContainText("Cards found: 1");

  await page.keyboard.press("Escape");
  await expect.poll(selected).toBe(0);
  await filter.locator("select").first().selectOption({ index: 1 });
  await filter.locator("select").nth(1).selectOption("none");
  await filter.getByRole("button", { name: "Select cards" }).click();
  await expect.poll(selected).toBe(1);
});

test("the empty-cell plus adds a card and focuses its editor", async ({ page }) => {
  await freshBoard(page, "kanban-plus");
  const point = await page.evaluate(() => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{
          padding: number;
          columns: Array<{ id: string; left: number }>;
          lanes: Array<{ id: string; centerY: number }>;
          placements: Array<{ columnId: string; swimlaneId: string }>;
        }>;
      };
    };
    const layout = probe.__remo.layouts.find(
      (entry) => entry.columns.length > 0 && entry.lanes.length > 0,
    )!;
    const occupied = new Set(
      layout.placements.map((placement) => `${placement.columnId}|${placement.swimlaneId}`),
    );
    const column = layout.columns.find((candidate) =>
      layout.lanes.some((lane) => !occupied.has(`${candidate.id}|${lane.id}`)),
    )!;
    const lane = layout.lanes.find((candidate) => !occupied.has(`${column.id}|${candidate.id}`))!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    const x = column.left + layout.padding + 16;
    const y = lane.centerY;
    return {
      x: rect.left + rect.width / 2 + (x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  });

  const camera = () =>
    page.evaluate(() => (window as unknown as { __remo: { camera: { x: number; y: number; zoom: number } } }).__remo.camera);
  const before = await camera();
  await page.mouse.click(point.x, point.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  // The view stays where the person clicked: the card was in sight, so nothing pans.
  // A new card is stored at (0, 0), and reading that used to pan to the room's middle.
  await page.waitForTimeout(200);
  expect(await camera()).toEqual(before);
  // The editor opens where the plus was, and its edge is its only frame: no focus ring.
  const box = (await editor.boundingBox())!;
  expect(Math.abs(box.x - point.x)).toBeLessThan(40);
  expect(await editor.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
  await page.keyboard.type("New card");
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as {
            __remo: { widgets: Array<{ type: string; text: string }> };
          }).__remo.widgets.some(
            (widget) => widget.type === "card" && widget.text === "New card",
          ),
      ),
    )
    .toBe(true);
});

test("a full cell makes its lane and the kanban taller instead of overlapping (ADR-240)", async ({ page }) => {
  await freshBoard(page, "kanban-full-cell");
  type Probe = {
    __remo: {
      camera: { x: number; y: number; zoom: number };
      widgets: Array<{ id: string; type: string; height: number }>;
      layouts: Array<{
        id: string;
        padding: number;
        laneStrip: number;
        columns: Array<{ id: string; left: number; width: number }>;
        lanes: Array<{ id: string; top: number; height: number }>;
        placements: Array<{ swimlaneId: string; y: number; height: number }>;
      }>;
    };
  };
  const read = () =>
    page.evaluate(() => {
      const probe = (window as unknown as Probe).__remo;
      const layout = probe.layouts.find((entry) => entry.lanes.length > 1)!;
      const kanban = probe.widgets.find((widget) => widget.id === layout.id)!;
      return { layout, kanbanHeight: kanban.height, camera: probe.camera };
    });

  const before = await read();
  // The template's lanes have titles, so the first column sits beside their strip.
  expect(before.layout.laneStrip).toBeGreaterThan(0);

  // Six cards into one cell, each by a double-click in the empty space under the others.
  for (let i = 0; i < 6; i += 1) {
    const point = await page.evaluate(() => {
      const probe = (window as unknown as Probe).__remo;
      const layout = probe.layouts.find((entry) => entry.lanes.length > 1)!;
      const column = layout.columns[0]!;
      const lane = layout.lanes[0]!;
      const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
      const x = column.left + column.width / 2;
      const y = lane.top + lane.height - 8;
      return {
        x: canvas.left + canvas.width / 2 + (x - probe.camera.x) * probe.camera.zoom,
        y: canvas.top + canvas.height / 2 + (y - probe.camera.y) * probe.camera.zoom,
      };
    });
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.locator(".inline-editor")).toBeFocused();
    await page.keyboard.type(`Card ${i}`);
    await page.keyboard.press("Escape");
    await expect(page.locator(".inline-editor")).toHaveCount(0);
    // Clear the selection too: a selected card shows its "continue" handles below it,
    // exactly where the next double-click goes.
    await page.keyboard.press("Escape");
  }

  const after = await read();
  const [first, second] = after.layout.lanes;
  // Lanes follow one another; every card stays inside its own lane.
  expect(second!.top).toBeCloseTo(first!.top + first!.height, 3);
  for (const placement of after.layout.placements) {
    const lane = after.layout.lanes.find((entry) => entry.id === placement.swimlaneId)!;
    expect(placement.y - placement.height / 2).toBeGreaterThanOrEqual(lane.top - 0.5);
    expect(placement.y + placement.height / 2).toBeLessThanOrEqual(lane.top + lane.height + 0.5);
  }
  // The kanban grew to hold them.
  expect(after.kanbanHeight).toBeGreaterThan(before.kanbanHeight);
  // And the section around it grew with it, so it still holds the kanban (ADR-243).
  const held = await page.evaluate(() => {
    const widgets = (window as unknown as {
      __remo: { widgets: Array<{ id: string; type: string; parentId: string | null; y: number; height: number }> };
    }).__remo.widgets;
    const kanban = widgets.find((widget) => widget.type === "kanban")!;
    const section = widgets.find((widget) => widget.id === kanban.parentId);
    return section
      ? { kanbanBottom: kanban.y + kanban.height / 2, sectionBottom: section.y + section.height / 2 }
      : null;
  });
  expect(held, "the template puts the kanban in a section").not.toBeNull();
  expect(held!.sectionBottom).toBeGreaterThanOrEqual(held!.kanbanBottom);
});

test("a card dragged above another in its cell takes its place", async ({ page }) => {
  await freshBoard(page, "kanban-reorder");
  type Placement = { cardId: string; columnId: string; swimlaneId: string; x: number; y: number; height: number };
  const cellCards = () =>
    page.evaluate(() => {
      const probe = (window as unknown as {
        __remo: { layouts: Array<{ placements: Placement[] }> };
      }).__remo;
      const placements = probe.layouts.find((layout) => layout.placements.length > 1)!.placements;
      const first = placements[0]!;
      return placements
        .filter((p) => p.columnId === first.columnId && p.swimlaneId === first.swimlaneId)
        .sort((a, b) => a.y - b.y);
    });
  const toClient = (point: { x: number; y: number }) =>
    page.evaluate((world) => {
      const probe = (window as unknown as { __remo: { camera: { x: number; y: number; zoom: number } } }).__remo;
      const rect = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 + (world.x - probe.camera.x) * probe.camera.zoom,
        y: rect.top + rect.height / 2 + (world.y - probe.camera.y) * probe.camera.zoom,
      };
    }, point);

  const before = await cellCards();
  expect(before.length).toBeGreaterThanOrEqual(2);
  const [top, second] = before;
  const from = await toClient({ x: second!.x, y: second!.y });
  // Into the upper half of the first card: the drop line goes above it.
  const to = await toClient({ x: top!.x, y: top!.y - top!.height / 4 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => (await cellCards()).map((p) => p.cardId))
    .toEqual([second!.cardId, top!.cardId, ...before.slice(2).map((p) => p.cardId)]);

  // One undo puts the order back.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await cellCards()).map((p) => p.cardId)).toEqual(before.map((p) => p.cardId));
});

test("a column's colour comes from its menu and paints its cards", async ({ page }) => {
  await freshBoard(page, "kanban-stripe");
  const header = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{ id: string; top: number; headerHeight: number; columns: Array<{ id: string; centerX: number }> }>;
      };
    }).__remo;
    const layout = probe.layouts.find((entry) => entry.columns.length > 0)!;
    const rect = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
    const world = { x: layout.columns[0]!.centerX, y: layout.top + layout.headerHeight * 0.42 };
    return {
      x: rect.left + rect.width / 2 + (world.x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (world.y - probe.camera.y) * probe.camera.zoom,
      kanbanId: layout.id,
      columnId: layout.columns[0]!.id,
    };
  });
  await page.mouse.click(header.x, header.y, { button: "right" });
  const colour = page.getByRole("group", { name: "Column colour" });
  const choices = colour.getByRole("menuitemradio");
  await expect(choices).toHaveCount(7);
  const swatch = colour.getByRole("menuitemradio", { name: "Bright blue" });
  await swatch.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(colour.getByRole("menuitemradio", { name: "Bright violet" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(swatch).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(swatch).toHaveAttribute("aria-checked", "true");
  await expect(swatch).toHaveCSS("outline-style", "solid");

  await expect
    .poll(() =>
      page.evaluate(
        ({ kanbanId, columnId }) =>
          (window as unknown as {
            __remo: { layouts: Array<{ id: string; columns: Array<{ id: string; accent: string }> }> };
          }).__remo.layouts
            .find((layout) => layout.id === kanbanId)
            ?.columns.find((column) => column.id === columnId)?.accent ?? null,
        { kanbanId: header.kanbanId, columnId: header.columnId },
      ),
    )
    .toBe("#78b4ff");

  // The menu shows the colour it has now.
  await page.keyboard.press("Escape");
  await page.mouse.click(header.x, header.y, { button: "right" });
  await expect(swatch).toHaveAttribute("aria-checked", "true");
});

/** The colour the board layer paints at a client point, as `#rrggbb`. */
async function paintedAt(page: import("@playwright/test").Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.board")!;
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const data = canvas
      .getContext("2d")!
      .getImageData(Math.round((x - rect.left) * dpr), Math.round((y - rect.top) * dpr), 1, 1).data;
    return `#${[data[0], data[1], data[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }, point);
}

/** Where a card is now: its centre, a plain patch of its sheet, and its column. */
async function cardOnBoard(page: import("@playwright/test").Page, cardId: string) {
  return page.evaluate((id) => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{
          placements: Array<{ cardId: string; columnId: string; x: number; y: number; width: number; height: number }>;
        }>;
      };
    }).__remo;
    const rect = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
    const toClient = (x: number, y: number) => ({
      x: rect.left + rect.width / 2 + (x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (y - probe.camera.y) * probe.camera.zoom,
    });
    for (const layout of probe.layouts) {
      const placement = layout.placements.find((entry) => entry.cardId === id);
      if (!placement) continue;
      // The top-right corner is plain sheet: away from the title, the meta line and the
      // 2 px outline.
      return {
        columnId: placement.columnId,
        centre: toClient(placement.x, placement.y),
        sample: toClient(
          placement.x - placement.width / 2 + placement.width - 24,
          placement.y - placement.height / 2 + 12,
        ),
      };
    }
    return null;
  }, cardId);
}

/**
 * The card colour rule of ADR-267 §2.1, read off the board.
 *
 * The rule is computed at paint time, so the only proof that it reached the screen is the
 * pixel; the only proof that no colour was written is the document.
 */
test("a card takes its column's colour and keeps only a chosen one", async ({ page }) => {
  await freshBoard(page, "kanban-card-colour");

  const cards = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: {
        widgets: Array<{ id: string; type: string; style?: { fillColor?: string } | null }>;
        layouts: Array<{
          columns: Array<{ id: string; title: string }>;
          placements: Array<{ cardId: string; columnId: string }>;
        }>;
      };
    }).__remo;
    const layout = probe.layouts[0]!;
    return layout.columns.map((column) => {
      const placement = layout.placements.find((entry) => entry.columnId === column.id);
      return {
        columnId: column.id,
        title: column.title,
        cardId: placement?.cardId,
        own:
          probe.widgets.find((widget) => widget.id === placement?.cardId)?.style?.fillColor ?? null,
      };
    });
  });
  const backlog = cards.find((card) => card.title === "Backlog")!;
  const doing = cards.find((card) => card.title === "In progress")!;
  const done = cards.find((card) => card.title === "Done")!;
  const [backlogAt, doingAt, doneAt] = await Promise.all([
    cardOnBoard(page, backlog.cardId!),
    cardOnBoard(page, doing.cardId!),
    cardOnBoard(page, done.cardId!),
  ]);

  // White "To do", yellow "Doing", green "Done" — and nothing written to the cards.
  await expect.poll(() => paintedAt(page, backlogAt!.sample)).toBe("#ffffff");
  await expect.poll(() => paintedAt(page, doingAt!.sample)).toBe("#f2b94a");
  await expect.poll(() => paintedAt(page, doneAt!.sample)).toBe("#85d965");
  expect([backlog.own, doing.own, done.own]).toEqual([null, null, null]);

  // A move recolours the card on its own: drag "To do" into "In progress".
  await page.mouse.move(backlogAt!.centre.x, backlogAt!.centre.y);
  await page.mouse.down();
  await page.mouse.move(doingAt!.centre.x, doingAt!.centre.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const at = await cardOnBoard(page, backlog.cardId!);
      return at ? paintedAt(page, at.sample) : null;
    })
    .toBe("#f2b94a");
  expect(
    await page.evaluate(
      (id) =>
        (window as unknown as { __remo: { widgets: Array<{ id: string; style?: { fillColor?: string } | null }> } })
          .__remo.widgets.find((widget) => widget.id === id)?.style?.fillColor ?? null,
      backlog.cardId!,
    ),
  ).toBeNull();

  // A chosen colour wins and survives a move; "Same as column" clears it again.
  const moved = (await cardOnBoard(page, backlog.cardId!))!;
  await page.mouse.click(moved.centre.x, moved.centre.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Card colour" }).click();
  const cardColour = page.getByRole("menu", { name: "Card colour" });
  // Fourteen fills plus "Same as column".
  await expect(cardColour.getByRole("menuitemradio")).toHaveCount(15);
  await cardColour.getByRole("menuitemradio", { name: "Blue", exact: true }).click();
  await expect.poll(async () => paintedAt(page, (await cardOnBoard(page, backlog.cardId!))!.sample)).toBe("#cddff8");

  const chosen = (await cardOnBoard(page, backlog.cardId!))!;
  const target = (await cardOnBoard(page, done.cardId!))!;
  await page.mouse.move(chosen.centre.x, chosen.centre.y);
  await page.mouse.down();
  await page.mouse.move(target.centre.x, target.centre.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const at = await cardOnBoard(page, backlog.cardId!);
      return at ? paintedAt(page, at.sample) : null;
    })
    .toBe("#cddff8");

  const afterMove = (await cardOnBoard(page, backlog.cardId!))!;
  await page.mouse.click(afterMove.centre.x, afterMove.centre.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Card colour" }).click();
  await page
    .getByRole("menu", { name: "Card colour" })
    .getByRole("menuitemradio", { name: "Same as column" })
    .click();
  await expect
    .poll(async () => {
      const at = await cardOnBoard(page, backlog.cardId!);
      return at ? paintedAt(page, at.sample) : null;
    })
    .toBe("#85d965");
  expect(
    await page.evaluate(
      (id) =>
        (window as unknown as { __remo: { widgets: Array<{ id: string; style?: { fillColor?: string } | null }> } })
          .__remo.widgets.find((widget) => widget.id === id)?.style?.fillColor ?? null,
      backlog.cardId!,
    ),
  ).toBeNull();
});

/** World → client for the canvas, the same inverse the handlers use. */
async function kanbanTitles(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{
          id: string;
          left: number;
          top: number;
          headerHeight: number;
          padding: number;
          columns: Array<{ id: string; title: string; left: number; width: number; centerX: number }>;
          lanes: Array<{ id: string; title: string; top: number; height: number; centerY: number }>;
        }>;
      };
    }).__remo;
    const layout = probe.layouts.find((entry) => entry.columns.length > 1 && entry.lanes.length > 1)!;
    const rect = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
    const toClient = (x: number, y: number) => ({
      x: rect.left + rect.width / 2 + (x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (y - probe.camera.y) * probe.camera.zoom,
    });
    const titleY = layout.top + layout.headerHeight * 0.42;
    return {
      columns: layout.columns.map((c) => ({ id: c.id, title: c.title, at: toClient(c.left + layout.padding + 8, titleY), right: toClient(c.left + c.width - 4, titleY) })),
      lanes: layout.lanes.map((l) => ({ id: l.id, title: l.title, at: toClient(layout.left + layout.padding + 8, l.top + 30), bottom: toClient(layout.left + layout.padding + 8, l.top + l.height - 6) })),
    };
  });
}

test("a column is renamed on the kanban, by double click and from its menu (ADR-244)", async ({ page }) => {
  await freshBoard(page, "kanban-rename");
  const before = await kanbanTitles(page);
  const first = before.columns[0]!;

  await page.mouse.dblclick(first.at.x, first.at.y);
  const field = page.locator(".kanban-title-editor");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(first.title);
  await field.fill("Ideas");
  await field.press("Enter");
  await expect(field).toHaveCount(0);
  await expect.poll(async () => (await kanbanTitles(page)).columns[0]!.title).toBe("Ideas");

  // Escape keeps the title.
  await page.mouse.dblclick(first.at.x, first.at.y);
  await field.fill("Discarded");
  await field.press("Escape");
  await expect.poll(async () => (await kanbanTitles(page)).columns[0]!.title).toBe("Ideas");

  // The menu opens the same field on the kanban, not one of its own.
  await page.mouse.click(first.at.x, first.at.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Rename column" }).click();
  await expect(field).toBeFocused();
  await field.fill("Later");
  await field.press("Enter");
  await expect.poll(async () => (await kanbanTitles(page)).columns[0]!.title).toBe("Later");
});

test("a title click and the keyboard button open the same column WIP control", async ({ page }) => {
  await freshBoard(page, "kanban-column-limit");
  const column = (await kanbanTitles(page)).columns[0]!;
  const button = page.getByRole("button", { name: "Column “" + column.title + "”" });
  await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  const hit = (await button.boundingBox())!;
  expect(hit.x).toBeLessThan(column.at.x);
  expect(hit.x + hit.width).toBeGreaterThan(column.at.x);
  expect(hit.width).toBeGreaterThan(hit.height);
  await expect(button).toHaveAccessibleDescription(new RegExp(" · [0-9]+"));
  const marker = (await button.locator(".kanban-column-marker").boundingBox())!;
  expect(marker.width).toBeLessThan(hit.width);
  await page.mouse.click(column.at.x, column.at.y);
  const menu = page.getByRole("menu", { name: "Column “" + column.title + "”" });
  const value = menu.locator(".context-menu-stepper output");
  await expect(value).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const before = Number(await value.textContent()) || 0;
  await menu.getByRole("menuitem", { name: "Increase card limit" }).click();
  await expect(value).toHaveText(String(before + 1));
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(value).toHaveText(String(before + 1));
  const decrease = menu.getByRole("menuitem", { name: "Decrease card limit" });
  await decrease.click();
  await expect(value).toHaveText(before ? String(before) : "No limit");
  await expect(decrease).toBeFocused();
  if (before === 0) {
    await expect(decrease).toBeDisabled();
    await decrease.press("Enter");
    await expect(value).toHaveText("No limit");
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  await page.getByRole("button", {name: "Zoom in", exact: true}).click();
  await expect.poll(async () => (await button.boundingBox())?.width ?? 0).toBeGreaterThan(hit.width);
  await expect.poll(async () => (await button.locator(".kanban-column-marker").boundingBox())?.width ?? 0)
    .toBeGreaterThan(marker.width);

  await button.press("Enter");
  const moves = menu.locator(".rm-menu-pair");
  const left = moves.getByRole("menuitem", { name: "Move left", exact: true });
  const right = moves.getByRole("menuitem", { name: "Move right", exact: true });
  await expect(left).toBeDisabled();
  await left.focus();
  await page.keyboard.press("ArrowDown");
  await expect(right).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect.poll(async () => (await kanbanTitles(page)).columns[1]!.title).toBe(column.title);
});

test.describe("column menu on a touch screen", () => {
  test.use({ hasTouch: true });
  test("the transparent corner of the control opens its column", async ({ page }) => {
    await freshBoard(page, "kanban-column-touch");
    const column = (await kanbanTitles(page)).columns[0]!;
    const name = "Column “" + column.title + "”";
    const button = page.getByRole("button", { name, exact: true });
    await button.tap({ position: { x: 4, y: 4 } });
    await expect(page.getByRole("menu", { name, exact: true })).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
  });
});

test("columns and lanes are reordered by dragging their titles (ADR-244)", async ({ page }) => {
  await freshBoard(page, "kanban-reorder-axes");
  const before = await kanbanTitles(page);
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
  };

  // The first column's title, dropped past the second column's middle.
  await drag(before.columns[0]!.at, before.columns[1]!.right);
  await expect
    .poll(async () => (await kanbanTitles(page)).columns.map((c) => c.id))
    .toEqual([before.columns[1]!.id, before.columns[0]!.id, ...before.columns.slice(2).map((c) => c.id)]);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await kanbanTitles(page)).columns.map((c) => c.id)).toEqual(before.columns.map((c) => c.id));

  // The first lane's title, dropped at the bottom of the second lane.
  await drag(before.lanes[0]!.at, before.lanes[1]!.bottom);
  await expect
    .poll(async () => (await kanbanTitles(page)).lanes.map((l) => l.id))
    .toEqual([before.lanes[1]!.id, before.lanes[0]!.id, ...before.lanes.slice(2).map((l) => l.id)]);

  // The rest of the header band still moves the kanban, not a column.
  const kanbanX = () =>
    page.evaluate(
      () => (window as unknown as { __remo: { widgets: Array<{ type: string; x: number }> } }).__remo.widgets.find((w) => w.type === "kanban")!.x,
    );
  const x0 = await kanbanX();
  const band = before.columns[0]!.right;
  await drag(band, { x: band.x + 60, y: band.y });
  await expect.poll(kanbanX).not.toBe(x0);
});
