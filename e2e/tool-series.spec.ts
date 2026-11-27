import { test, expect } from "@playwright/test";
import { freshBoard, objectCount } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

test("holding N places editable notes, releasing permits one last note, undo removes one placement", async ({ page }) => {
  await freshBoard(page, "held-notes", { template: "empty" });
  const select = page.getByRole("button", { name: "Select", exact: true });
  const canvas = page.locator(".layer.overlay");
  const editor = page.locator(".inline-editor");
  await page.keyboard.down("n");
  for (const [index, x] of [160, 440, 720].entries()) {
    await canvas.click({ position: { x, y: 660 } });
    await expect(editor).toBeFocused();
    if (index === 1) {
      // A pause longer than normal text undo grouping still belongs to this placement.
      await page.waitForTimeout(550);
      await editor.fill("An idea");
    }
    await expect.poll(() => objectCount(page, "sticky_note")).toBe(index + 1);
  }
  await page.keyboard.up("n");
  await canvas.click({ position: { x: 1000, y: 660 } });
  await expect(editor).toBeFocused();
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect.poll(() => objectCount(page, "sticky_note")).toBe(4);
  for (const count of [3, 2, 1, 0]) {
    await page.keyboard.press("Control+z");
    await expect.poll(() => objectCount(page, "sticky_note")).toBe(count);
  }
});

test("double clicking locks the note tool and selecting an object ends its series", async ({ page }) => {
  await freshBoard(page, "locked-notes", { template: "empty" });
  const rail = page.getByRole("toolbar", { name: "Tools" });
  const select = rail.getByRole("button", { name: "Select", exact: true });
  const note = rail.getByRole("button", { name: "Sticky note", exact: true });
  await note.dblclick();
  const lock = rail.locator(".tool-series-lock");
  const disclosure = rail.getByRole("button", { name: "Sticky note colours" });
  await expect(lock).toBeVisible();
  const badge = (await lock.boundingBox())!;
  const button = (await note.boundingBox())!;
  expect(badge).toMatchObject({ width: 16, height: 16 });
  expect(badge.x + badge.width - button.x - button.width).toBe(3);
  expect(badge.y + badge.height - button.y - button.height).toBe(3);
  await page.mouse.click(badge.x + badge.width / 2, badge.y + badge.height / 2);
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(disclosure).toBeFocused();
  await expect.poll(() => objectCount(page, "sticky_note")).toBe(0);
  const canvas = page.locator(".layer.overlay");
  await canvas.click({ position: { x: 150, y: 650 } });
  await expect(page.locator(".inline-editor")).toBeFocused();
  await page.keyboard.type("One");
  await canvas.click({ position: { x: 520, y: 650 } });
  await expect(page.locator(".inline-editor")).toBeFocused();
  await page.keyboard.type("Two");
  await canvas.click({ position: { x: 165, y: 665 } });
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => objectCount(page, "sticky_note")).toBe(2);
  await note.dblclick();
  await page.keyboard.press("Escape");
  await expect(select).toHaveAttribute("aria-pressed", "true");
});

test("single notes teach the held shortcut and two distinct series retire the hint", async ({ page }) => {
  await freshBoard(page, "series-hint", { template: "empty" });
  const note = page.getByRole("button", { name: "Sticky note", exact: true });
  for (const value of ["One", "Two", "Three"]) {
    await note.click();
    await page.locator(".inline-editor").fill(value);
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".canvas-hint")).toContainText("Hold N");
  const canvas = page.locator(".layer.overlay");
  for (const y of [95, 675]) {
    await note.dblclick();
    for (const x of [155, 515]) {
      await canvas.click({ position: { x, y } });
      await expect(page.locator(".inline-editor")).toBeFocused();
    }
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".canvas-hint")).not.toContainText("Hold N");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("remuka.hints.sticky.series")!).done)).toBe(2);
});

test("R and T share held placement, V and choosing another tool release a lock", async ({ page }) => {
  await freshBoard(page, "series-tools", { template: "empty" });
  const rail = page.getByRole("toolbar", { name: "Tools" });
  const canvas = page.locator(".layer.overlay");
  for (const [code, type, y] of [["r", "shape", 625], ["t", "text", 245]] as const) {
    await page.keyboard.down(code);
    for (const x of [155, 685]) await canvas.click({ position: { x, y } });
    await page.keyboard.up(code);
    await expect.poll(() => objectCount(page, type)).toBe(2);
    await page.keyboard.press("Escape");
  }
  const text = rail.getByRole("button", { name: "Text", exact: true });
  await text.dblclick();
  await page.keyboard.press("v");
  await expect(rail.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
  await text.dblclick();
  await rail.getByRole("button", { name: "Shape", exact: true }).click();
  await expect(rail.locator(".tool-series-lock")).toHaveCount(0);
});
