import { expect, test } from "@playwright/test";
import { freshBoard, seedNote } from "./helpers";

test("a shape drawn on an older sticky is picked above it, and one undo removes just the new shape", async ({ page }) => {
  const account = await freshBoard(page, "creation-order", { template: "empty" });
  const note = await seedNote(page, account.boardId, { x: 0, y: 0 }, { width: 220, height: 210 }, "Original note");
  await expect.poll(() => page.evaluate(id => window.__remo.widgets.some(widget => widget.id === id), note)).toBe(true);
  const position = await page.evaluate(() => {
    const canvas = document.querySelector(".layer.overlay")!.getBoundingClientRect();
    const view = window.__remo.camera;
    return { x: canvas.left + canvas.width / 2 - view.x * view.zoom, y: canvas.top + canvas.height / 2 - view.y * view.zoom };
  });
  const toolbar = page.getByRole("toolbar", { name: "Tools" });
  await toolbar.getByRole("button", { name: "Shape variants" }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.mouse.move(position.x - 30, position.y - 20);
  await page.mouse.down();
  await page.mouse.move(position.x + 30, position.y + 20, { steps: 5 });
  await page.mouse.up();
  const shapes = () => page.evaluate(() => window.__remo.widgets.filter(widget => widget.type === "shape").map(widget => widget.id));
  await expect.poll(shapes).toHaveLength(1);
  const [shape] = await shapes();
  await page.keyboard.press("Escape");
  await page.mouse.click(position.x, position.y);
  await expect.poll(() => page.evaluate(() => window.__remo.selectedIds)).toEqual([shape]);
  await page.getByRole("button", { name: /^Undo(?: |$)/ }).first().click();
  await expect.poll(shapes).toHaveLength(0);
  expect(await page.evaluate(id => window.__remo.widgets.some(widget => widget.id === id), note)).toBe(true);
});
