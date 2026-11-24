import { expect, test, type Page } from "@playwright/test";
import {
  addSticky,
  enableLink,
  freshBoard,
  openBoard,
  seedConnector,
} from "./helpers";

/**
 * Shapes: five kinds, switching the kind, sharp/rounded corners and drawing by dragging
 * (ADR-271, T17).
 *
 * The canvas has no DOM nodes, so the drawing cases drive the same mouse events a person
 * produces and read the document from the dev probe. The kind and corner cases go
 * through the object bar, which is a real toolbar: its labels are what a screen reader
 * reads, so they are asserted too.
 */

interface View {
  camera: { x: number; y: number; zoom: number };
  rect: { left: number; top: number; width: number; height: number };
}

interface ProbeWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shapeKind?: string | null;
  style?: { fillColor?: string } | null;
  text?: string;
}

async function view(page: Page): Promise<View> {
  return page.evaluate(() => {
    const probe = window as unknown as { __remo: { camera: View["camera"] } };
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.__remo.camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

function toClient(current: View, point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: current.rect.left + current.rect.width / 2 + (point.x - current.camera.x) * current.camera.zoom,
    y: current.rect.top + current.rect.height / 2 + (point.y - current.camera.y) * current.camera.zoom,
  };
}

function shapes(page: Page): Promise<ProbeWidget[]> {
  return page.evaluate(
    () =>
      ((window as unknown as { __remo: { widgets: ProbeWidget[] } }).__remo.widgets).filter(
        (widget) => widget.type === "shape",
      ),
  );
}

/** Zoom by the canvas's own ctrl+wheel rule until it is the requested value. */
async function setZoom(page: Page, target: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await view(page);
    if (Math.abs(current.camera.zoom - target) < 0.01) return;
    const factor = Math.min(1.25, Math.max(0.8, target / current.camera.zoom));
    const dy = -Math.log(factor) / 0.005;
    await page.mouse.move(
      current.rect.left + current.rect.width / 2,
      current.rect.top + current.rect.height / 2,
    );
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, dy);
    await page.keyboard.up("Control");
    await page.waitForTimeout(20);
  }
  throw new Error(`could not reach zoom ${target}`);
}

/** Drag a screen box with the shape tool already armed. */
async function dragBox(
  page: Page,
  from: { x: number; y: number },
  size: { width: number; height: number },
  modifiers: { shift?: boolean; alt?: boolean } = {},
): Promise<void> {
  const current = await view(page);
  const start = toClient(current, from);
  const end = {
    x: start.x + size.width * current.camera.zoom,
    y: start.y + size.height * current.camera.zoom,
  };
  if (modifiers.shift) await page.keyboard.down("Shift");
  if (modifiers.alt) await page.keyboard.down("Alt");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  if (modifiers.shift) await page.keyboard.up("Shift");
  if (modifiers.alt) await page.keyboard.up("Alt");
}

test("R draws a shape at the dragged size on any zoom, and the size plate says it", async ({
  page,
}) => {
  await freshBoard(page, "shape-drag-size", { template: "empty" });
  const rail = page.getByRole("toolbar", { name: "Tools" });

  await setZoom(page, 1);
  await page.keyboard.press("r");
  await expect(rail.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const current = await view(page);
  const start = toClient(current, { x: -240, y: -160 });
  const end = { x: start.x + 150, y: start.y + 90 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  // The draft is the promise: the dashed silhouette and its numbers, before the commit.
  await expect(page.locator(".shape-draft-size")).toHaveText("150 × 90");
  await page.mouse.up();

  await expect.poll(async () => (await shapes(page)).length).toBe(1);
  let [shape] = await shapes(page);
  expect(shape!.shapeKind).toBe("rectangle");
  expect(Math.round(shape!.width)).toBe(150);
  expect(Math.round(shape!.height)).toBe(90);
  // The rail is back on Select after one shape.
  await expect(rail.getByRole("button", { name: "Select" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The same 150 × 90 at 200 %: the drag is twice as long on screen, the board is not.
  await setZoom(page, 2);
  await page.keyboard.press("r");
  await dragBox(page, { x: 120, y: -80 }, { width: 150, height: 90 });
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
  const second = (await shapes(page)).find((entry) => entry.id !== shape!.id)!;
  expect(Math.round(second.width)).toBe(150);
  expect(Math.round(second.height)).toBe(90);

  // Shift keeps the longer side, Alt grows around the press.
  await page.keyboard.press("r");
  await dragBox(page, { x: -280, y: 160 }, { width: 90, height: 40 }, { shift: true });
  const square = (await shapes(page)).find((entry) => entry.id !== shape!.id && entry.id !== second.id)!;
  expect(Math.round(square.width)).toBe(90);
  expect(Math.round(square.height)).toBe(90);

  await page.keyboard.press("r");
  const from = { x: 280, y: 160 };
  await dragBox(page, from, { width: 120, height: 80 }, { alt: true });
  const centred = (await shapes(page)).find(
    (entry) => entry.id !== shape!.id && entry.id !== second.id && entry.id !== square.id,
  )!;
  expect(Math.round(centred.x)).toBe(from.x);
  expect(Math.round(centred.y)).toBe(from.y);
  // Alt draws around the press: the pointer travels half a side, the box is whole.
  expect(Math.round(centred.width)).toBe(240);
  expect(Math.round(centred.height)).toBe(160);
});

test("a click without a drag creates the default shape, and Escape cancels a draw", async ({
  page,
}) => {
  await freshBoard(page, "shape-drag-click", { template: "empty" });
  await setZoom(page, 1);
  await page.keyboard.press("r");
  const current = await view(page);
  const point = toClient(current, { x: -400, y: -260 });
  await page.mouse.click(point.x, point.y);

  await expect.poll(async () => (await shapes(page)).length).toBe(1);
  const [created] = await shapes(page);
  expect(created!.width).toBe(260);
  expect(created!.height).toBe(160);

  // A second press of the key is the same "make one now" action as ADR-119 promised.
  await page.keyboard.press("r");
  await page.keyboard.press("r");
  await expect.poll(async () => (await shapes(page)).length).toBe(2);

  // Esc during the drag leaves no object and no armed tool.
  await page.keyboard.press("r");
  const start = toClient(await view(page), { x: -500, y: -300 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 180, start.y + 120, { steps: 5 });
  await expect(page.locator(".shape-draft")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".shape-draft")).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => (await shapes(page)).length).toBe(2);
  await expect(
    page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Select" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a double click on the tool keeps it armed for a series until Escape", async ({ page }) => {
  await freshBoard(page, "shape-series", { template: "empty" });
  await setZoom(page, 1);
  const rail = page.getByRole("toolbar", { name: "Tools" });
  await rail.getByRole("button", { name: "Shape", exact: true }).dblclick();
  await expect(rail.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  for (let index = 0; index < 3; index += 1) {
    await dragBox(page, { x: -600 + index * 320, y: -120 }, { width: 140, height: 100 });
  }
  await expect.poll(async () => (await shapes(page)).length).toBe(3);
  await expect(rail.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Escape");
  await expect(rail.getByRole("button", { name: "Select" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rail.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("the bar switches the kind of every selected shape and keeps text, size and links", async ({
  page,
}) => {
  const account = await freshBoard(page, "shape-kind-bar", { template: "empty" });
  await setZoom(page, 1);
  const selected = () =>
    page.evaluate(
      () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
    );
  await page.keyboard.press("r");
  await dragBox(page, { x: -420, y: -70 }, { width: 220, height: 140 });
  const left = await selected();
  await page.keyboard.press("o");
  await dragBox(page, { x: 180, y: -70 }, { width: 220, height: 140 });
  const right = await selected();
  const above = await addSticky(page);
  const below = await addSticky(page);
  await seedConnector(page, account.boardId, left, right);
  await seedConnector(page, account.boardId, left, above);
  await seedConnector(page, account.boardId, left, below);

  // Text on the shape survives the switch, which is the point of changing only the kind.
  const first = (await shapes(page)).find((entry) => entry.id === left)!;
  const at = toClient(await view(page), { x: first.x, y: first.y });
  await page.mouse.dblclick(at.x, at.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Заявка");
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);

  await page.mouse.click(at.x, at.y);
  const bar = page.getByRole("toolbar", { name: "Object properties" });
  const before = (await shapes(page)).find((entry) => entry.id === left)!;
  await expect(bar.getByRole("button", { name: /Kind: Rectangle/ })).toBeVisible();

  await bar.getByRole("button", { name: /Kind: Rectangle/ }).click();
  await page.getByRole("button", { name: "Triangle", exact: true }).click();
  await expect
    .poll(async () => (await shapes(page)).find((entry) => entry.id === left)?.shapeKind)
    .toBe("triangle");
  const after = (await shapes(page)).find((entry) => entry.id === left)!;
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  expect(Math.round(after.height)).toBe(Math.round(before.height));
  expect(after.text).toBe("Заявка");
  expect(after.style).toEqual(before.style);
  expect(
    await page.evaluate(
      (id) =>
        (window as unknown as {
          __remo: { widgets: Array<{ type: string; start: string | null; end: string | null }> };
        }).__remo.widgets.filter(
          (widget) => widget.type === "connector" && (widget.start === id || widget.end === id),
        ).length,
      left,
    ),
  ).toBe(3);

  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await shapes(page)).find((entry) => entry.id === left)?.shapeKind)
    .toBe("rectangle");

  // Each of the other kinds keeps the same box, text, style and the three connectors.
  for (const [name, kind] of [
    ["Diamond", "diamond"],
    ["Ellipse", "ellipse"],
    ["Rounded rectangle", "round_rectangle"],
    ["Rectangle", "rectangle"],
  ] as const) {
    await bar.getByRole("button", { name: /Kind:/ }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect
      .poll(async () => (await shapes(page)).find((entry) => entry.id === left)?.shapeKind)
      .toBe(kind);
    const next = (await shapes(page)).find((entry) => entry.id === left)!;
    expect(Math.round(next.width)).toBe(Math.round(before.width));
    expect(Math.round(next.height)).toBe(Math.round(before.height));
    expect(next.text).toBe("Заявка");
    expect(next.style).toEqual(before.style);
  }

  // Sharp / Rounded toggles the two rectangle kinds; an ellipse cannot take it.
  await bar.getByRole("button", { name: "Rounded", exact: true }).click();
  await expect
    .poll(async () => (await shapes(page)).find((entry) => entry.id === left)?.shapeKind)
    .toBe("round_rectangle");
  await bar.getByRole("button", { name: "Sharp", exact: true }).click();
  await expect
    .poll(async () => (await shapes(page)).find((entry) => entry.id === left)?.shapeKind)
    .toBe("rectangle");

  await bar.getByRole("button", { name: /Kind: Rectangle/ }).click();
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  const rounded = bar.getByRole("button", { name: /Rounded/ });
  await expect(rounded).toBeDisabled();
  await expect(rounded).toHaveAttribute("aria-label", /Rectangles only/);
});

test("a shape-only selection changes every kind; a mixed one hides the item", async ({
  page,
}) => {
  await freshBoard(page, "shape-kind-multi", { template: "empty" });
  await setZoom(page, 1);
  const selected = () =>
    page.evaluate(
      () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
    );
  await page.keyboard.press("r");
  await dragBox(page, { x: -420, y: -70 }, { width: 220, height: 140 });
  const first = await selected();
  await page.keyboard.press("o");
  await dragBox(page, { x: 180, y: -70 }, { width: 220, height: 140 });
  const second = await selected();
  const note = await addSticky(page);

  const boxes = await shapes(page);
  const viewNow = await view(page);
  const one = toClient(viewNow, { x: boxes.find((entry) => entry.id === first)!.x, y: boxes.find((entry) => entry.id === first)!.y });
  const two = toClient(viewNow, { x: boxes.find((entry) => entry.id === second)!.x, y: boxes.find((entry) => entry.id === second)!.y });
  await page.mouse.click(one.x, one.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(two.x, two.y);
  await page.keyboard.up("Shift");

  const bar = page.locator(".arrange-bar");
  await expect(bar.getByRole("button", { name: /Kind:/ })).toBeVisible();
  await bar.getByRole("button", { name: /Kind:/ }).click();
  await page.getByRole("button", { name: "Diamond", exact: true }).click();
  await expect
    .poll(async () => (await shapes(page)).map((entry) => entry.shapeKind))
    .toEqual(["diamond", "diamond"]);

  // The sticky joins the selection: no single type to change, so the item is hidden.
  const noteAt = await page.evaluate(
    (id) =>
      (window as unknown as { __remo: { widgets: Array<{ id: string; x: number; y: number; width: number; height: number }> } }).__remo.widgets.find(
        (widget) => widget.id === id,
      ),
    note,
  );
  // Near the note's bottom-right corner: the arrange bar of the two selected shapes
  // sits above the block and may cover the note's middle (T18 moves it up for the
  // rotation handle), but the note itself is still a plain click target.
  const notePoint = toClient(await view(page), {
    x: noteAt!.x + noteAt!.width / 2 - 8,
    y: noteAt!.y + noteAt!.height / 2 - 8,
  });
  await page.keyboard.down("Shift");
  await page.mouse.click(notePoint.x, notePoint.y);
  await page.keyboard.up("Shift");
  await expect(bar.getByRole("button", { name: /Kind:/ })).toHaveCount(0);
});

test("the second participant sees the new shape and its switched kind", async ({ page, context }) => {
  const account = await freshBoard(page, "shape-sync", { template: "empty" });
  const other = await context.newPage();
  await openBoard(other, account.boardId);

  await page.bringToFront();
  await setZoom(page, 1);
  await page.keyboard.press("r");
  await dragBox(page, { x: -300, y: -200 }, { width: 200, height: 120 });
  await expect
    .poll(async () => (await shapes(other)).length, { timeout: 15_000 })
    .toBe(1);

  const shape = (await shapes(page))[0]!;
  const at = toClient(await view(page), { x: shape.x, y: shape.y });
  await page.mouse.click(at.x, at.y);
  await page
    .getByRole("toolbar", { name: "Object properties" })
    .getByRole("button", { name: /Kind: Rectangle/ })
    .click();
  await page.getByRole("button", { name: "Rounded rectangle", exact: true }).click();
  await expect
    .poll(async () => (await shapes(other))[0]?.shapeKind, { timeout: 15_000 })
    .toBe("round_rectangle");
  await other.close();
});

test("a reader's rail does not arm the shape tool", async ({ page, browser }) => {
  const account = await freshBoard(page, "shape-reader", { template: "empty" });
  await enableLink(page, account.boardId);

  const visitor = await browser.newContext({ locale: "en-US" });
  const reader = await visitor.newPage();
  await reader.goto(`/?room=${account.boardId}&lang=en`);
  await expect(reader.locator(".rm-readonly")).toContainText(/View only/);

  const rail = reader.getByRole("toolbar", { name: "Tools" });
  await expect(rail.getByRole("button", { name: "Shape", exact: true })).toBeDisabled();
  await reader.keyboard.press("r");
  await expect(rail.getByRole("button", { name: "Select" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const canvas = reader.locator(".layer.overlay");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the canvas is not visible");
  await reader.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => (await shapes(reader)).length).toBe(0);
  await visitor.close();
});

test("the shape bar carries the lift level, as the mockup does", async ({ page }) => {
  await freshBoard(page, "shape-lift", { template: "empty" });
  await setZoom(page, 1);
  const rail = page.getByRole("toolbar", { name: "Tools" });
  await page.keyboard.press("r");
  await expect(rail.getByRole("button", { name: "Shape", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const current = await view(page);
  const start = toClient(current, { x: -320, y: -200 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 200, start.y + 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await shapes(page)).length).toBe(1);

  const control = page.getByRole("button", { name: /^Shadow: / }).first();
  await expect(control).toHaveAttribute("aria-label", "Shadow: None");
  await control.click();
  await page.getByRole("menuitemcheckbox", { name: "Cardboard", exact: true }).click();
  await expect(control).toHaveAttribute("aria-label", "Shadow: Cardboard");
  const lifted = () =>
    page.evaluate(
      () =>
        (window as unknown as { __remo: { widgets: Array<{ type: string; style?: { elevation?: string } | null }> } })
          .__remo.widgets.find((widget) => widget.type === "shape")?.style?.elevation ?? null,
    );
  await expect.poll(lifted).toBe("cardboard");
});
