import { expect, test } from "@playwright/test";
import { freshBoard, openFacilitation, seedConnector, seedNote, seedObject } from "./helpers";

const INTERNAL_ID = /\b[a-z]+_[a-z0-9]{8,}\b/;
const LONG_NAME = "Очень_длинное_имя_без_пробелов_которое_не_помещается_в_строку_панели_показа";

/**
 * The Show tab lists people's words, never internal ids, and a long unbreakable name
 * does not widen the panel: real rooms have unnamed frames, arrows and long names.
 */
for (const width of [1440, 390]) {
  test(`the Show tab names objects for people and fits long names at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const account = await freshBoard(page, `present-names-${width}`, { template: "empty" });
    await seedObject(page, account.boardId, { type: "frame", x: 0, y: 0, width: 600, height: 400 });
    const a = await seedNote(page, account.boardId, { x: 700, y: 0 }, undefined, "Цель");
    const b = await seedObject(page, account.boardId, { type: "sticky_note", x: 900, y: 0, width: 160, height: 160, name: LONG_NAME });
    await seedConnector(page, account.boardId, a, b);

    await openFacilitation(page);
    await page.getByRole("menuitem", { name: /Timer/ }).click();
    const panel = page.locator(".facilitation-panel");
    await panel.getByRole("tab", { name: "Show", exact: true }).click();
    // The frame is a slide from the start, named for people.
    await expect(panel.locator(".presentation-list li")).toHaveCount(1);
    await expect(panel.locator(".presentation-list li")).toContainText("Frame without a name");
    // Two notes can be added; the arrow between them is not a slide candidate.
    const available = panel.locator(".presentation-available li");
    await expect(available).toHaveCount(2);
    await available.filter({ hasText: LONG_NAME.slice(0, 20) }).getByRole("button", { name: "Add" }).click();
    await expect(panel.locator(".presentation-list li")).toHaveCount(2);

    const text = await panel.innerText();
    expect(text).not.toMatch(INTERNAL_ID);
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // Every row keeps its buttons inside the panel.
    const outside = await panel.evaluate((el) => {
      const edge = el.getBoundingClientRect().right;
      return [...el.querySelectorAll(".presentation-list li, .presentation-available li")]
        .filter((row) => row.getBoundingClientRect().right > edge + 1).length;
    });
    expect(outside).toBe(0);
    await testInfo.attach(`show-${width}`, { body: await panel.screenshot(), contentType: "image/png" });
  });
}
