import { 
expect, test, type Page } from "@playwright/test";
import { addSticky, createShape, freshBoard, seedObject, ensureProperties, openFold } from "./helpers";

/**
 * The object bar after S5d (ADR-119 §4.2, ADR-127).
 *
 * One sample per object opens one colour window: seven tonal columns, 100/300 for fills and
 * 600 for lines, borders and text, with the chosen value named in words. Keys 1–7 paint the
 * main colour without opening the window. A multi-selection names its content and shows the
 * one shared role, or "≠" when the values differ.
 */

interface Box {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: Record<string, string> | null;
}

async function widgets(page: Page): Promise<Box[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __remo: { widgets: Box[] } }).__remo.widgets.filter(
        (widget) => widget.type !== "card" && widget.type !== "kanban",
      ),
  );
}

async function styleOf(page: Page, id: string): Promise<Record<string, unknown>> {
  return page.evaluate(
    (widgetId) =>
      (window as unknown as { __remo: { widgets: Array<{ id: string; style: Record<string, string> | null }> } })
        .__remo.widgets.find((widget) => widget.id === widgetId)?.style ?? {},
    id,
  );
}

async function toClient(page: Page, world: { x: number; y: number }) {
  return page.evaluate((point) => {
    const probe = (window as unknown as {
      __remo: { camera: { x: number; y: number; zoom: number } };
    }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (point.x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (point.y - probe.camera.y) * probe.camera.zoom,
    };
  }, world);
}

test("a note has one sheet sample and one tonal window with ink in the same place", async ({
  page,
}) => {
  await freshBoard(page, "object-panel-note", { template: "empty" });
  const id = await addSticky(page);
  const bar = page.getByRole("toolbar", { name: "Object properties" });
  await expect(bar).toBeVisible();

  // Seven chips and "Customize" are gone: one sample, drawn as the sheet it paints.
  const sample = bar.getByRole("button", { name: "Sheet colour: Yellow" });
  await expect(sample).toBeVisible();
  await expect(bar.getByRole("group", { name: "Sheet colour" })).toHaveCount(0);

  await sample.click();
  const panel = page.getByRole("dialog", { name: "Sheet colour" });
  await expect(panel).toBeVisible();
  const grid = panel.getByRole("radiogroup", { name: "Sheet colour" });
  // Seven columns × two rows: 100 and 300 are the fills.
  await expect(grid.getByRole("radio")).toHaveCount(14);
  await expect(grid.getByRole("radio", { name: "Yellow", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // The chosen value is named in words, and the key hints stand under the top row.
  await expect(panel).toContainText("Yellow");
  await expect(panel.locator(".cw-keys span")).toHaveCount(7);

  await grid.getByRole("radio", { name: "Green", exact: true }).click();
  await expect.poll(async () => (await styleOf(page, id)).fillColor).toBe("#c8e8d4");
  await expect(grid.getByRole("radio", { name: "Green", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(panel).toContainText("Green");

  // Text is four segments in the same window: no second popover, no second palette.
  const ink = panel.getByRole("radiogroup", { name: "Text" });
  await ink.getByLabel("Dark").check();
  await expect.poll(async () => (await styleOf(page, id)).textColor).toBe("#1d1b1a");
  await ink.getByLabel("Black").check();
  // Black is true black: the old near-black reads as Auto (ADR-281).
  await expect.poll(async () => (await styleOf(page, id)).textColor).toBe("#000000");
  await ink.getByLabel("White").check();
  await expect.poll(async () => (await styleOf(page, id)).textColor).toBe("#ffffff");
  await ink.getByLabel("Auto").check();
  await expect.poll(async () => (await styleOf(page, id)).textColor).toBeUndefined();

  // Escape and an outside click close the window; no nested surface is left behind.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("a note offers White and Black beside the grid, and no transparency", async ({
  page,
}) => {
  await freshBoard(page, "object-panel-named-note", { template: "empty" });
  const id = await addSticky(page);
  const bar = page.getByRole("toolbar", { name: "Object properties" });
  await bar.getByRole("button", { name: /Sheet colour/ }).click();
  const panel = page.getByRole("dialog", { name: "Sheet colour" });

  // Named values are square swatches in a column to the left of the grid, not pills.
  const extras = panel.locator(".cw-extras");
  const grid = panel.getByRole("radiogroup", { name: "Sheet colour" });
  await expect(extras.getByRole("button")).toHaveCount(2);
  await expect(extras.getByRole("button", { name: "White" })).toHaveClass(/cw-swatch/);
  await expect(grid.getByRole("radio").first()).toHaveClass(/cw-swatch/);
  await expect(extras.getByRole("button", { name: "White" })).toHaveText("");

  // A named swatch and a grid swatch are the same square: 34 px, one gap.
  const extraBox = (await extras.getByRole("button", { name: "White" }).boundingBox())!;
  const gridBox = (await grid.getByRole("radio").first().boundingBox())!;
  expect(extraBox.width).toBe(34);
  expect(extraBox.height).toBe(34);
  expect(gridBox.width).toBe(34);
  expect((await extras.boundingBox())!.x).toBeLessThan((await grid.boundingBox())!.x);

  // No pill buttons and no "Custom colour" label in the head: the value is a swatch.
  await expect(panel.locator(".cw-chip, .cw-actions")).toHaveCount(0);

  // Named swatches are values of their own: they write the stored value and name it.
  await extras.getByRole("button", { name: "White" }).click();
  await expect.poll(async () => (await styleOf(page, id)).fillColor).toBe("#ffffff");
  await expect(extras.getByRole("button", { name: "White" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const sheetValue = panel.locator(".cw-section").first().locator(".cw-value");
  await expect(sheetValue).toHaveText("White");

  await extras.getByRole("button", { name: "Black" }).click();
  await expect.poll(async () => (await styleOf(page, id)).fillColor).toBe("#000000");
  await expect(sheetValue).toHaveText("Black");

  // A note has no transparency: an invisible sheet would look like a lost object.
  await expect(panel.getByRole("button", { name: "Transparent" })).toHaveCount(0);
  // And the named swatches are not grid entries: seven columns × two rows still.
  await expect(grid.getByRole("radio")).toHaveCount(14);
});

test("the rail offers seven quick sticky colours and properties offer the full palette", async ({
  page,
}) => {
  await freshBoard(page, "object-panel-one-palette", { template: "empty" });
  const rail = page.getByRole("toolbar", { name: "Tools" });

  await rail.getByRole("button", { name: "Sticky note colours" }).click();
  const flyout = page.getByRole("group", { name: "Sticky note colours" });
  const choices = flyout.getByRole("button");
  await expect(choices).toHaveCount(7);
  const railColours = await choices.evaluateAll((buttons) => buttons.map((button) => ({
    hex: button.getAttribute("data-hex"), name: button.getAttribute("aria-label"),
  })));
  expect(railColours.map(({ hex }) => hex)).toEqual([
    "#f4e0a8", "#c8e8d4", "#cddff8", "#f9d3cd", "#f3e8ff", "#ffdcc6", "#f3f1ec",
  ]);
  await expect(choices.first()).toHaveAttribute("aria-pressed", "true");
  const first = (await choices.first().boundingBox())!;
  const fourth = (await choices.nth(3).boundingBox())!;
  const fifth = (await choices.nth(4).boundingBox())!;
  expect(first.width).toBe(40);
  expect(first.height).toBe(40);
  expect(fourth.y).toBe(first.y);
  expect(fifth.y).toBe(first.y + 48);
  expect(fifth.x).toBe(first.x);
  await page.keyboard.press("Escape");
  await expect(flyout).toHaveCount(0);

  await addSticky(page);
  const bar = page.getByRole("toolbar", { name: "Object properties" });
  await bar.getByRole("button", { name: /Sheet colour/ }).click();
  const grid = page.getByRole("radiogroup", { name: "Sheet colour" });
  const windowSwatches = grid.getByRole("radio");
  await expect(windowSwatches).toHaveCount(14);
  const fullColours = await windowSwatches.evaluateAll((buttons) => buttons.map((button) => ({
    hex: button.getAttribute("data-hex"), name: button.getAttribute("aria-label"),
  })));
  expect(fullColours).toEqual(expect.arrayContaining(railColours));
  await expect(grid.getByRole("radio", { name: "Yellow", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  // Named fills remain available in properties.
  const windowExtras = page
    .getByRole("dialog", { name: "Sheet colour" })
    .locator(".cw-extras .cw-swatch");
  await expect(windowExtras).toHaveCount(2);
  expect(
    await windowExtras.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    ),
  ).toEqual(["White", "Black"]);
});

test("keys 1–7 paint the main colour of the selection", async ({ page }) => {
  await freshBoard(page, "object-panel-keys", { template: "empty" });
  const id = await addSticky(page);
  const note = (await widgets(page)).find((widget) => widget.id === id)!;
  const point = await toClient(page, { x: note.x, y: note.y });
  await page.mouse.click(point.x, point.y);

  const bar = page.getByRole("toolbar", { name: "Object properties" });
  await expect(bar).toBeVisible();
  // 4 is the pink column of the 100 row; the window never opens.
  await page.keyboard.press("4");
  await expect.poll(async () => (await styleOf(page, id)).fillColor).toBe("#f9d3cd");
  await expect(bar.getByRole("button", { name: "Sheet colour: Pink" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Sheet colour" })).toHaveCount(0);
});

test("a shape's one sample opens presets, fill, border and text in that order", async ({
  page,
}) => {
  await freshBoard(page, "object-panel-shape", { template: "empty" });
  await createShape(page, "Rectangle");

  const bar = page.getByRole("toolbar", { name: "Object properties" });
  const sample = bar.getByRole("button", { name: "Shape style: Plain" });
  await expect(sample).toBeVisible();
  const shape = (await widgets(page)).find((widget) => widget.type === "shape")!;

  await sample.click();
  const panel = page.getByRole("dialog", { name: "Shape style" });
  await expect(panel).toBeVisible();

  // Presets first, in the order §9 № 3 approved.
  const presets = panel.getByRole("group", { name: "Presets" });
  await expect(presets.getByRole("button")).toHaveCount(6);
  await expect(presets.getByRole("button", { name: "Plain" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Fill is the 7 × 2 grid; White, Black and Transparent are named swatches to its left.
  const fill = panel.getByRole("radiogroup", { name: "Fill" });
  await expect(fill.getByRole("radio")).toHaveCount(14);
  await fill.getByRole("radio", { name: "Orange", exact: true }).click();
  await expect.poll(async () => (await styleOf(page, shape.id)).fillColor).toBe("#ffdcc6");

  const fillSection = panel.locator(".cw-section").nth(1);
  const fillExtras = fillSection.locator(".cw-extras");
  await expect(fillExtras.locator(".cw-swatch")).toHaveCount(3);
  expect(
    await fillExtras
      .locator(".cw-swatch")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))),
  ).toEqual(["White", "Black", "Transparent"]);
  // The word is the accessible name, never a truncated caption: the swatch has no text.
  await expect(fillExtras.getByRole("button", { name: "Transparent" })).toHaveText("");
  expect((await fillExtras.boundingBox())!.x).toBeLessThan((await fill.boundingBox())!.x);

  await fillExtras.getByRole("button", { name: "White" }).click();
  await expect.poll(async () => (await styleOf(page, shape.id)).fillColor).toBe("#ffffff");
  await fillSection.getByRole("button", { name: "Black" }).click();
  await expect.poll(async () => (await styleOf(page, shape.id)).fillColor).toBe("#000000");

  // Transparency is painted as a checkerboard, not as an empty white square (ADR-140).
  await fillSection.getByRole("button", { name: "Transparent" }).click();
  await expect.poll(async () => (await styleOf(page, shape.id)).fillColor).toBe(
    "transparent",
  );
  // Transparent fill alone is a custom state: a new shape's outline is ink (ADR-267),
  // while the Outline preset is transparent plus the grey 600 border.
  await presets.getByRole("button", { name: "Outline" }).click();
  await expect(presets.getByRole("button", { name: "Outline" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    presets.getByRole("button", { name: "Outline" }).locator(".cw-aa-chip"),
  ).toHaveClass(/checkerboard/);
  await expect(
    bar.getByRole("button", { name: "Shape style: Outline" }).locator(".sb-paint-sample"),
  ).toHaveClass(/checkerboard/);
  // A transparent fill is the checkerboard alone; only an absent border is crossed out.
  const transparentSwatch = fillExtras.getByRole("button", { name: "Transparent" });
  await expect(transparentSwatch).toHaveClass(/checkerboard/);
  await expect(transparentSwatch).not.toHaveClass(/is-none/);

  // Border is the 600 row, with width and dash in the same window.
  const border = panel.getByRole("radiogroup", { name: "Border", exact: true });
  await expect(border.getByRole("radio")).toHaveCount(7);
  await border.getByRole("radio", { name: "Deep blue" }).click();
  await expect.poll(async () => (await styleOf(page, shape.id)).strokeColor).toBe("#1a6ad8");
  await panel.getByRole("radiogroup", { name: "Outline width" }).getByLabel("4").check();
  await expect.poll(async () => (await styleOf(page, shape.id)).strokeWidth).toBe(4);
  await panel.getByRole("radiogroup", { name: "Border style" }).getByLabel("Dashed").check();
  await expect.poll(async () => (await styleOf(page, shape.id)).strokeStyle).toBe("dashed");
  await expect(presets.getByRole("button", { name: "Plain" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Text stays in the same window; Auto is the absence of textColor (ADR-038).
  await panel.getByRole("radiogroup", { name: "Text" }).getByLabel("Dark").check();
  await expect.poll(async () => (await styleOf(page, shape.id)).textColor).toBe("#1d1b1a");
  await panel.getByRole("radiogroup", { name: "Text" }).getByLabel("Auto").check();
  await expect.poll(async () => (await styleOf(page, shape.id)).textColor).toBeUndefined();

  // A border offers Black and None in the same named swatches; None hides the border.
  const borderSection = panel.locator(".cw-section").nth(2);
  const borderExtras = borderSection.locator(".cw-extras");
  expect(
    await borderExtras
      .locator(".cw-swatch")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))),
  ).toEqual(["Auto", "Black", "None"]);
  // "None" is crossed out; "Transparent" would be a fill's word, not a border's.
  await expect(borderExtras.getByRole("button", { name: "None" })).toHaveClass(/checkerboard/);
  await expect(borderExtras.getByRole("button", { name: "None" })).toHaveClass(/is-none/);
  await borderExtras.getByRole("button", { name: "Black" }).click();
  await expect.poll(async () => (await styleOf(page, shape.id)).strokeColor).toBe("#000000");
  await borderExtras.getByRole("button", { name: "None" }).click();
  await expect.poll(async () => (await styleOf(page, shape.id)).strokeColor).toBe(
    "transparent",
  );
});

test("a free text object has one role: the 600 row, with Auto beside it", async ({ page }) => {
  await freshBoard(page, "object-panel-text", { template: "empty" });
  const rail = page.getByRole("toolbar", { name: "Tools" });
  await rail.getByRole("button", { name: "Text" }).click();
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Hello");
  await page.keyboard.press("Escape");

  // Escape closes the editor and drops the selection; select the object to get its bar.
  const text = (await widgets(page)).find((widget) => widget.type === "text")!;
  const point = await toClient(page, { x: text.x, y: text.y });
  await page.mouse.click(point.x, point.y);

  const bar = page.getByRole("toolbar", { name: "Object properties" });
  // A new text object stores no colour: it is Auto and takes the ink of its surface
  // (ADR-273), so the window opens on Auto rather than ringing a grid entry.
  const sample = bar.getByRole("button", { name: "Text: Auto" });
  await expect(sample).toBeVisible();
  await sample.click();

  const panel = page.getByRole("dialog", { name: "Text" });
  const grid = panel.getByRole("radiogroup", { name: "Text" });
  await expect(grid.getByRole("radio")).toHaveCount(7);
  await expect(grid.getByRole("radio", { name: "Graphite" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await grid.getByRole("radio", { name: "Deep blue" }).click();
  await expect.poll(async () => (await styleOf(page, text.id)).color).toBe("#1a6ad8");
  await expect(panel).toContainText("Deep blue");

  // Auto, Black and White are named swatches beside the grid, not grid entries (ADR-140).
  const textExtras = panel.locator(".cw-extras");
  expect(
    await textExtras
      .locator(".cw-swatch")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))),
  ).toEqual(["Auto", "Black", "White"]);
  await expect(textExtras.getByRole("button", { name: "Auto" })).toHaveClass(/is-auto/);
  await expect((await textExtras.boundingBox())!.x).toBeLessThan(
    (await grid.boundingBox())!.x,
  );
  await textExtras.getByRole("button", { name: "Black" }).click();
  await expect.poll(async () => (await styleOf(page, text.id)).color).toBe("#000000");
  await textExtras.getByRole("button", { name: "White" }).click();
  await expect.poll(async () => (await styleOf(page, text.id)).color).toBe("#ffffff");
  await textExtras.getByRole("button", { name: "Auto" }).click();
  await expect.poll(async () => (await styleOf(page, text.id)).color).toBeUndefined();
});

test("a window never slides under the rail when its object is at the edge", async ({ page }) => {
  await freshBoard(page, "object-panel-edge", { template: "empty" });
  const id = await addSticky(page);
  const note = (await widgets(page)).find((widget) => widget.id === id)!;
  const point = await toClient(page, { x: note.x, y: note.y });
  const bar = page.getByRole("toolbar", { name: "Object properties" });

  // Drag the note onto the rail's edge: the bar clamps to the canvas at 8 px, which is
  // under the floating rail, so the window itself has to move (ADR-129).
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(40, point.y, { steps: 12 });
  await page.mouse.up();
  await expect(bar).toBeVisible();

  await bar.getByRole("button", { name: /Sheet colour/ }).click();
  const dialog = page.getByRole("dialog", { name: "Sheet colour" });
  await expect(dialog).toBeVisible();
  const window = (await dialog.boundingBox())!;
  const rail = (await page.getByRole("toolbar", { name: "Tools" }).boundingBox())!;
  expect(window.x).toBeGreaterThanOrEqual(rail.x + rail.width);
  expect(window.x + window.width).toBeLessThanOrEqual(1440);
});

test("a multi-selection shows the shared role, mixes with ≠ and narrows to a type", async ({
  page,
}) => {
  await freshBoard(page, "object-panel-multi", { template: "empty" });
  await addSticky(page);
  await addSticky(page);
  await createShape(page, "Rectangle");

  // Creating objects centres the camera on the new one; fit the whole board so every
  // target is on screen and the click points below are stable.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Fit", exact: true }).click();

  const all = await widgets(page);
  const notes = all.filter((widget) => widget.type === "sticky_note");
  const shape = all.find((widget) => widget.type === "shape")!;
  const first = notes[0]!;
  const second = notes[1]!;

  // Later objects are on top, so every click lands on an uncovered strip of its object.
  const shapePoint = await toClient(page, { x: shape.x, y: shape.y + shape.height / 2 - 6 });
  const firstPoint = await toClient(page, {
    x: first.x - first.width / 2 + 6,
    y: first.y,
  });
  const secondPoint = await toClient(page, {
    x: second.x + 40,
    y: second.y - second.height / 2 + 6,
  });

  await page.mouse.click(firstPoint.x, firstPoint.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(secondPoint.x, secondPoint.y);
  await page.mouse.click(shapePoint.x, shapePoint.y);
  await page.keyboard.up("Shift");

  const bar = page.locator(".arrange-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("3 objects");
  await expect(bar.getByRole("button", { name: /Selection by type: 3 objects/ })).toHaveAttribute(
    "aria-label",
    /2 sticky notes, 1 shape/,
  );

  // Notes and a shape share the fill role; their values differ, so the sample says so.
  const colour = bar.getByRole("button", { name: "Fill: Mixed colours" });
  await expect(colour).toBeVisible();
  await colour.click();
  const panel = page.getByRole("dialog", { name: "Fill" });
  const grid = panel.getByRole("radiogroup", { name: "Fill" });
  await expect(grid.getByRole("radio")).toHaveCount(14);
  await expect(panel).toContainText("Mixed colours");
  // The fill role's named swatches are the same in a multi-selection: White, Black, Transparent.
  const multiExtras = panel.locator(".cw-extras");
  expect(
    await multiExtras
      .locator(".cw-swatch")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))),
  ).toEqual(["White", "Black", "Transparent"]);
  expect((await multiExtras.boundingBox())!.x).toBeLessThan((await grid.boundingBox())!.x);
  await grid.getByRole("radio", { name: "Blue", exact: true }).click();
  const blue = "#cddff8";
  await expect.poll(async () => (await styleOf(page, first.id)).fillColor).toBe(blue);
  await expect.poll(async () => (await styleOf(page, second.id)).fillColor).toBe(blue);
  await expect.poll(async () => (await styleOf(page, shape.id)).fillColor).toBe(blue);
  await page.keyboard.press("Escape");
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });

  // One transaction, one undo step: all three go back together.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => {
    const values = await Promise.all(
      [first.id, second.id, shape.id].map(async (id) => (await styleOf(page, id)).fillColor),
    );
    return new Set(values).size;
  }).toBe(2);

  // The type menu narrows the selection and "All" brings the rest back.
  await bar.getByRole("button", { name: /Selection by type/ }).click();
  await page.getByRole("menuitem", { name: "2 sticky notes" }).click();
  await expect(bar).toContainText("2 objects");
  await bar.getByRole("button", { name: /Selection by type/ }).click();
  await page.getByRole("menuitem", { name: "All" }).click();
  await expect(bar).toContainText("3 objects");
  await expect(bar.getByRole("button", { name: /Selection by type: 3 objects/ })).toHaveAttribute(
    "aria-label",
    /2 sticky notes, 1 shape/,
  );
});

test("a shape is lifted off the board from More actions, one level for the selection (ADR-245)", async ({
  page,
}) => {
  await freshBoard(page, "object-panel-elevation", { template: "empty" });
  await createShape(page, "Rectangle");
  const shape = (await widgets(page)).find((widget) => widget.type === "shape")!;
  await ensureProperties(page);
  const level = page.getByRole("combobox", { name: "Lift", exact: true });
  await expect(level).toHaveValue("none");
  await level.selectOption("floating");
  await expect.poll(async () => (await styleOf(page, shape.id)).elevation).toBe("floating");
  await page.getByRole("button", { name: /^Undo/ }).first().click();
  await expect.poll(async () => (await styleOf(page, shape.id)).elevation).toBeUndefined();
  await expect(level).toHaveValue("none");
  await level.selectOption("raised");
  await expect.poll(async () => (await styleOf(page, shape.id)).elevation).toBe("raised");
  await level.selectOption("none");
  await expect.poll(async () => "elevation" in (await styleOf(page, shape.id))).toBe(false);

  await openFold(page, "More settings");
  await page.locator("aside.inspector").getByRole("button", { name: "More actions", exact: true }).click();
  await expect(page.getByRole("menu", { name: "More actions" }).getByRole("menuitemcheckbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await addSticky(page);
  await expect(level).toHaveCount(0);
});

/**
 * Colours painted by the two previous palettes (ADR-267 §1, ADR-127).
 *
 * A room is never repainted behind a person's back: the stored hex stays, and the window
 * names it by the entry it stands for and rings that swatch. Both previous sets are
 * recognised — the muted ADR-182 rows and the bright row before them.
 */
test("a note from a previous palette keeps its colour and rings its swatch", async ({ page }) => {
  const account = await freshBoard(page, "object-panel-previous", { template: "empty" });
  const muted = await seedObject(page, account.boardId, {
    type: "sticky_note",
    x: -220,
    y: 0,
    width: 180,
    height: 180,
    content: "ADR-182 yellow",
    style: { fillColor: "#ece2c8" },
  });
  const bright = await seedObject(page, account.boardId, {
    type: "sticky_note",
    x: 220,
    y: 0,
    width: 180,
    height: 180,
    content: "Bright yellow",
    style: { fillColor: "#ffe07a" },
  });
  await expect
    .poll(async () => (await widgets(page)).length)
    .toBe(2);

  const check = async (id: string, stored: string) => {
    const note = (await widgets(page)).find((widget) => widget.id === id)!;
    const point = await toClient(page, { x: note.x, y: note.y });
    await page.mouse.click(point.x, point.y);
    const bar = page.getByRole("toolbar", { name: "Object properties" });
    await expect(bar.getByRole("button", { name: "Sheet colour: Yellow" })).toBeVisible();
    await bar.getByRole("button", { name: /Sheet colour/ }).click();
    const grid = page.getByRole("radiogroup", { name: "Sheet colour" });
    // The ring is on the current entry's swatch, not on a "custom colour" note.
    await expect(grid.getByRole("radio", { name: "Yellow", exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(grid.getByRole("radio", { name: "Yellow", exact: true })).toHaveAttribute(
      "data-hex",
      "#f4e0a8",
    );
    await page.keyboard.press("Escape");
    // Opening the window did not rewrite what the document holds.
    await expect.poll(async () => (await styleOf(page, id)).fillColor).toBe(stored);
  };

  await check(muted, "#ece2c8");
  await check(bright, "#ffe07a");
});
