import { expect, test } from "@playwright/test";
import { addSticky, freshBoard, objectCount, openFacilitation } from "./helpers";

/**
 * A side panel is not a modal: while it stays open, the room keeps its keys whenever the
 * focus is on the canvas, and the panel keeps them while the focus is inside it.
 */
test("room shortcuts work on the canvas while the Run panel stays open", async ({ page }) => {
  await freshBoard(page, "keys-panel", { template: "empty" });
  await addSticky(page);
  await expect.poll(() => objectCount(page, "sticky_note")).toBe(1);

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  const panel = page.locator(".facilitation-panel");
  await expect(panel).toBeVisible();

  // Focus inside the panel: the panel owns the keys, nothing happens on the board.
  await expect.poll(() => panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Control+d");
  await expect.poll(() => objectCount(page, "sticky_note")).toBe(1);

  // Focus back on the canvas with the panel still open: the room's shortcut runs.
  await page.locator("canvas.layer.overlay").focus();
  await page.keyboard.press("Control+d");
  await expect.poll(() => objectCount(page, "sticky_note")).toBe(2);
  await expect(panel).toBeVisible();
});
