import { expect, test, type Page } from "@playwright/test";
import { addSticky, ensureProperties, freshBoard, objectCount, openComments, openFacilitation } from "./helpers";

/**
 * Room shortcuts in every context a person works in (spec: delivery-guard, keyboard
 * matrix). A side panel, a focused header control or the properties panel must not
 * take the room's keys away while the person is on the canvas.
 */
const contexts: Array<{ name: string; setup: (page: Page) => Promise<void> }> = [
  { name: "nothing open", setup: async () => {} },
  {
    name: "the Run panel open",
    setup: async (page) => {
      await openFacilitation(page);
      await page.getByRole("menuitem", { name: /Timer/ }).click();
      await expect(page.locator(".facilitation-panel")).toBeVisible();
    },
  },
  {
    name: "the comments panel open",
    setup: async (page) => {
      await openComments(page);
      await expect(page.locator(".comments-panel")).toBeVisible();
    },
  },
  {
    name: "the properties panel open",
    setup: async (page) => {
      await ensureProperties(page);
    },
  },
  {
    name: "a zoom button just pressed",
    setup: async (page) => {
      await page.getByRole("button", { name: /Zoom in/ }).click();
    },
  },
];

for (const context of contexts) {
  test(`⌘D and ⌘Z reach the room with ${context.name}`, async ({ page }) => {
    await freshBoard(page, `keys-${context.name.replace(/\W+/g, "-")}`, { template: "empty" });
    await addSticky(page);
    await expect.poll(() => objectCount(page, "sticky_note")).toBe(1);
    await context.setup(page);
    // The person goes back to the canvas; a pressed header button keeps the focus.
    if (!context.name.startsWith("a zoom")) await page.locator("canvas.layer.overlay").focus();

    await page.keyboard.press("Control+d");
    await expect.poll(() => objectCount(page, "sticky_note")).toBe(2);
    await page.keyboard.press("Control+z");
    await expect.poll(() => objectCount(page, "sticky_note")).toBe(1);
  });
}
