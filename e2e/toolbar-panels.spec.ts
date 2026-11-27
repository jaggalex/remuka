import { expect, test, type Page } from "@playwright/test";
import {
  addSticky,
  createShape,
  ensureProperties,
  freshBoard,
  openComments,
  selectKanbanCard,
  seedConnector,
  seedObject,
  setAccountTheme,
} from "./helpers";

/**
 * T8: one rail, one bar per selection, one side panel (ADR-266 §5, §10a; ADR-286).
 *
 * The counts are the acceptance: seven tools and «More», note and shape bars of seven, and one properties panel at a time.
 */
function worldToClient(page: Page, point: { x: number; y: number }) {
  return page.evaluate((world) => {
    const probe = window as unknown as {
      __remo: { camera: { x: number; y: number; zoom: number } };
    };
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (world.x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (world.y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  }, point);
}

async function widgets(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __remo: {
            widgets: Array<{
              id: string;
              type: string;
              x: number;
              y: number;
              width: number;
              height: number;
            }>;
          };
        }
      ).__remo.widgets,
  );
}

test("the rail is seven tools and More, and More is the same list as the search", async ({
  page,
}) => {
  await freshBoard(page, "t8-rail", { template: "kanban-framework" });
  const rail = page.getByRole("toolbar", { name: "Tools" });

  for (const name of [
    "Select",
    "Sticky note",
    "Shape",
    "Text",
    "Connector",
    "Frame",
    "Image",
    "More",
  ]) {
    await expect(rail.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // Card and comment moved into «More»; they are not second rail buttons.
  await expect(rail.getByRole("button", { name: "Card", exact: true })).toHaveCount(0);
  await expect(rail.getByRole("button", { name: "Comment", exact: true })).toHaveCount(0);

  // Card needs a kanban cell: select the template's first card, then add one.
  await selectKanbanCard(page);
  const cards = () => page.evaluate(
    () => (window as unknown as { __remo: { widgets: Array<{ type: string }> } }).__remo.widgets
      .filter((widget) => widget.type === "card").length,
  );
  const beforeCard = await cards();
  await rail.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Card", exact: true }).click();
  await expect.poll(cards).toBe(beforeCard + 1);
  await page.keyboard.press("Escape");

  // Table and kanban are created through «More», with the same ids the search finds.
  const frames = () => page.evaluate(
    () => (window as unknown as { __remo: { widgets: Array<{ type: string }> } }).__remo.widgets
      .filter((widget) => widget.type === "frame").length,
  );
  const beforeTable = await frames();
  await rail.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menu", { name: "More" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Table", exact: true }).click();
  await expect.poll(frames).toBe(beforeTable + 1);

  const kanbans = () => page.evaluate(
    () => (window as unknown as { __remo: { widgets: Array<{ type: string }> } }).__remo.widgets
      .filter((widget) => widget.type === "kanban").length,
  );
  const beforeKanban = await kanbans();
  await rail.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Kanban", exact: true }).click();
  await expect.poll(kanbans).toBe(beforeKanban + 1);


  // Comment starts placement; templates open the picker.
  await rail.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Comment", exact: true }).click();
  await expect(page.locator(".comment-placement")).toBeVisible();
  await page.keyboard.press("Escape");

  await rail.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Templates/ }).click();
  await expect(page.locator(".topbar-templates-anchor .rm-popover")).toBeVisible();
  await page.keyboard.press("Escape");

  // The search knows the same five rows, and runs the same action.
  for (const query of ["card", "table", "kanban", "comment", "templates"]) {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox").fill(query);
    await expect(
      page.getByRole("listbox").getByRole("option").filter({ hasText: new RegExp(query, "i") }).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
  const beforeSearchTable = await frames();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("table");
  await page.keyboard.press("Enter");
  await expect.poll(frames).toBe(beforeSearchTable + 1);
});

test("every selection bar has seven buttons and More opens properties", async ({
  page,
}) => {
  await freshBoard(page, "t8-bars", { template: "empty" });

  const bar = page.getByRole("toolbar", { name: "Object properties" });
  await addSticky(page);
  await expect(bar).toBeVisible();
  expect(await bar.getByRole("button").count()).toBe(7);
  await bar.getByRole("button", { name: "More actions" }).click();
  await expect(page.locator("aside.inspector")).toBeVisible();
  await page.keyboard.press("Escape");

  await createShape(page, "Rectangle");
  await expect(bar).toBeVisible();
  expect(await bar.getByRole("button").count()).toBe(7);

  // A text being edited carries six formats and «⋯».
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.type("Текст");
  await expect(bar).toBeVisible();
  expect(await bar.getByRole("button").count()).toBe(7);
  await page.keyboard.press("Escape");

  // Two notes: the multi-selection bar is six elements, still under the seven rule.
  const multi = await freshBoard(page, "t8-bars-multi", { template: "empty" });
  await seedObject(page, multi.boardId, {
    type: "sticky_note",
    x: -260,
    y: 0,
    width: 160,
    height: 180,
    content: "Left",
  });
  await seedObject(page, multi.boardId, {
    type: "sticky_note",
    x: 260,
    y: 0,
    width: 160,
    height: 180,
    content: "Right",
  });
  await page.reload();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(500);
  const first = await worldToClient(page, { x: -260, y: 0 });
  const second = await worldToClient(page, { x: 260, y: 0 });
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  const arrange = page.locator(".arrange-bar");
  await expect(arrange).toBeVisible();
  expect(await arrange.getByRole("button").count()).toBeLessThanOrEqual(7);
});

test("a connector's bar is seven, and its More opens the same panel", async ({ page }) => {
  const account = await freshBoard(page, "t8-connector", { template: "empty" });
  const from = await seedObject(page, account.boardId, {
    type: "sticky_note",
    x: -220,
    y: 0,
    width: 160,
    height: 180,
    content: "From",
  });
  const to = await seedObject(page, account.boardId, {
    type: "sticky_note",
    x: 220,
    y: 0,
    width: 160,
    height: 180,
    content: "To",
  });
  await seedConnector(page, account.boardId, from, to);
  await page.reload();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await expect.poll(async () => (await widgets(page)).some((widget) => widget.type === "connector")).toBe(true);

  const connector = (await widgets(page)).find((widget) => widget.type === "connector")!;
  const point = await worldToClient(page, { x: connector.x, y: connector.y });
  // Lines are thin: try the derived midpoint, then a small vertical sweep.
  for (let offset = 0; offset <= 24; offset += 6) {
    await page.mouse.click(point.x, point.y + offset);
    if (await page.locator(".connector-bar").isVisible()) break;
  }
  const bar = page.locator(".connector-bar");
  await expect(bar).toBeVisible();
  expect(await bar.getByRole("button").count()).toBe(7);
  const colour = bar.locator(".sb-line-colour");
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 900});
    const sample = await colour.locator(".sb-paint-sample").boundingBox();
    const button = await colour.boundingBox();
    const toolbar = await bar.boundingBox();
    expect(sample!.width).toBe(24);
    expect(sample!.x).toBeGreaterThanOrEqual(button!.x);
    expect(sample!.x + sample!.width).toBeLessThanOrEqual(button!.x + button!.width);
    if (width === 1440) expect(Math.round(sample!.x - toolbar!.x)).toBe(177);
    else expect(Math.abs((sample!.x + sample!.width / 2) - (button!.x + button!.width / 2))).toBeLessThan(1);
    await colour.focus();
    await page.keyboard.press("Enter");
    await expect(colour).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(colour).toHaveAttribute("aria-expanded", "false");
  }
  await bar.getByRole("button", { name: "More" }).click();
  await expect(page.locator("aside.inspector")).toBeVisible();
});

test("one panel at a time: comments close properties, and a pin opens its thread", async ({
  page,
}) => {
  const account = await freshBoard(page, "t8-panels", { template: "empty" });
  await ensureProperties(page);
  await expect(page.locator("aside.inspector")).toBeVisible();

  // A thread through the panel's own composer, then close the panel.
  await openComments(page);
  await expect(page.locator("aside.inspector")).toBeHidden();
  await expect(page.locator(".comments-panel")).toBeVisible();
  await page.getByRole("button", { name: "New comment" }).click();
  const canvas = page.locator(".layer.overlay");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 120, box.y + box.height - 120);
  await page.locator(".comment-composer textarea").fill("Где ревью?");
  await page.locator(".comment-composer").getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".comments-thread")).toContainText("Где ревью?");

  // The pin is the way back to its thread, while no object covers it.
  await page
    .locator(".comments-panel")
    .getByRole("button", { name: "Close" })
    .click();
  await expect(page.locator(".comments-panel")).toBeHidden();
  await page.locator(".comment-pin").click();
  await expect(page.locator(".comments-panel")).toBeVisible();
  await expect(page.locator(".comments-thread")).toContainText("Где ревью?");
  await expect(page.locator("aside.inspector")).toBeHidden();

  // «⋯» on the bar opens properties, which closes the comments panel.
  await page
    .locator(".comments-panel")
    .getByRole("button", { name: "Close" })
    .click();
  await seedObject(page, account.boardId, {
    type: "sticky_note",
    x: 0,
    y: 0,
    width: 160,
    height: 180,
    content: "Note",
  });
  await page.reload();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  const view = await worldToClient(page, { x: 0, y: 0 });
  await page.mouse.click(view.x, view.y);
  const bar = page.getByRole("toolbar", { name: "Object properties" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "More actions" }).click();
  await expect(page.locator("aside.inspector")).toBeVisible();
  await expect(page.locator(".comments-panel")).toBeHidden();
});

test("the working screen has at most twelve chrome controls outside the canvas", async ({
  page,
}) => {
  await freshBoard(page, "t8-chrome", { template: "empty" });
  await page.setViewportSize({ width: 1440, height: 900 });
  const controls = ":is(button, a, [role=button]):visible";
  const names = await page.locator(".topbar, .canvas-hud, .canvas-hint").locator(controls)
    .evaluateAll(nodes => nodes.map(node =>
      node.getAttribute("aria-label") || node.textContent?.trim() || node.className));
  const header = await page.locator(".topbar").locator(controls).count();
  expect.soft(header, "Controls in the header").toBeLessThanOrEqual(8);
  expect(names.length, names.join(" · ")).toBeLessThanOrEqual(12);
});

for (const lang of ["ru", "en"] as const) {
  test(`the sticky palette has seven choices and dismisses accessibly at both widths in ${lang}`, async ({ page }) => {
    await freshBoard(page, "sticky-palette", { template: "empty" });
    await setAccountTheme(page, "light", lang);
    const trigger = page.getByRole("button", { name: lang === "ru" ? "Цвета стикера" : "Sticky note colours", exact: true });
    const palette = page.getByRole("dialog", { name: lang === "ru" ? "Стикер · цвет нового" : "Colour for new sticky notes" });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await trigger.focus();
      await trigger.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      const colours = palette.getByRole("button");
      await expect(colours).toHaveCount(7);
      await expect(palette.getByRole("link")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const box = (await palette.boundingBox())!;
      expect(box.width).toBe(width === 390 ? 270 : 262);
      expect(Math.abs(box.height - 199)).toBeLessThanOrEqual(1);
      const hint = palette.locator(".tool-flyout-note");
      await expect(hint).toHaveCSS("color", "rgb(63, 66, 86)");
      await expect(hint).toHaveCSS("line-height", "17.4px");
      const shadows = await palette.locator(".tool-swatch-paper").evaluateAll(samples =>
        samples.map(sample => getComputedStyle(sample).boxShadow));
      expect(new Set(shadows).size).toBe(1);
      expect(shadows[0]).toContain("0px 6px 6px -5px");
      await trigger.press("Tab");
      await expect(colours.first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();
      await expect(trigger).toBeFocused();

      await trigger.click();
      await trigger.click();
      await expect(palette).toBeHidden();
      await trigger.click();
      const outside = page.getByRole("button", { name: lang === "ru" ? "Приблизить" : "Zoom in", exact: true });
      const oldZoom = await page.locator(".rm-zoom-value").innerText();
      await outside.click();
      await expect(palette).toBeHidden();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".rm-zoom-value")).not.toHaveText(oldZoom);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`the rail palette and all shape actions stay accessible after panning at 390 px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await freshBoard(page, "narrow-sticky-palette", { template: "empty" });
    await setAccountTheme(page, theme);
    await createShape(page);
    const shapeBar = page.locator(".shape-selection-bar");
    const rail = page.getByRole("toolbar", { name: "Tools" });
    const caret = rail.getByRole("button", { name: "Sticky note colours" });
    const palette = rail.getByRole("group", { name: "Sticky note colours" });
    const first = palette.getByRole("button").first();

    await caret.click();
    await expect(rail.getByRole("dialog", { name: "Colour for new sticky notes" })).toBeVisible();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await expect(palette.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(first.locator(".rm-btn-label")).toHaveCSS("overflow", "visible");
    await expect(first.locator(".tool-swatch-paper")).toHaveCSS("outline-style", "solid");
    const bar = (await shapeBar.boundingBox())!;
    await caret.click();

    const beforePan = await worldToClient(page, { x: 0, y: 0 });
    await page.mouse.move(360, 660);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(360, 500, { steps: 6 });
    await page.mouse.up({ button: "middle" });
    await expect.poll(async () => (await worldToClient(page, { x: 0, y: 0 })).y)
      .toBeLessThan(beforePan.y - 100);
    await expect(rail).not.toHaveClass(/is-quiet/);
    await caret.click();
    const dialog = rail.getByRole("dialog", { name: "Colour for new sticky notes" });
    await expect(dialog).toBeVisible();
    const afterPan = (await shapeBar.boundingBox())!;
    expect(afterPan).toEqual(bar);
    expect(afterPan.y + afterPan.height).toBeLessThanOrEqual((await dialog.boundingBox())!.y);
    const actions = shapeBar.getByRole("button");
    await expect(actions).toHaveCount(7);
    await expect(shapeBar.getByRole("button", { name: "Connect", exact: true })).toBeDisabled();
    await expect(shapeBar.locator("button:enabled")).toHaveCount(6);
    for (const action of await actions.all()) {
      await expect(action).toBeInViewport({ ratio: 1 });
      if (await action.isEnabled()) await action.click({ trial: true, timeout: 3000 });
    }
    await first.click();
    await expect(palette).toBeHidden();

    await caret.click();
    const second = palette.getByRole("button").nth(1);
    await second.focus();
    await second.press("Enter");
    await expect(palette).toBeHidden();
    await caret.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await expect(palette.locator('[aria-pressed="true"]')).toHaveCount(1);
  });
}
