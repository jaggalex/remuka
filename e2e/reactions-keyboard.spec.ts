import { expect, test } from "@playwright/test";
import { freshBoard, objectCount, openBoard, openFacilitation, selectKanbanCard } from "./helpers";

test("a reaction picked in Run appears on both boards, then fades", async ({ page, browser }) => {
  const account = await freshBoard(page, "reactions", { user: "Sender" });
  const other = await browser.newContext({ storageState: await page.context().storageState(), reducedMotion: "no-preference" });
  try {
    const peer = await other.newPage();
    await openBoard(peer, account.boardId, { user: "Peer" });
    await expect(page.locator(".peer")).toHaveCount(2);
    await openFacilitation(page);
    await page.locator(".menu-reaction").first().click();
    for (const client of [page, peer]) {
      const burst = client.locator(".reaction-burst");
      await expect(burst).toHaveText("👍");
      const position = await burst.evaluate((el) => Number.parseFloat(getComputedStyle(el).top) / el.parentElement!.getBoundingClientRect().height);
      expect(position).toBeGreaterThanOrEqual(0.85);
    }
    await expect(peer.locator(".reaction-burst")).toHaveCount(0);
    await expect(page.locator(".reaction-burst")).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test("Tab on a selected kanban card keeps canvas focus and creates nothing", async ({ page }) => {
  await freshBoard(page, "card-tab");
  await selectKanbanCard(page);
  const before = await objectCount(page);
  const focus = await page.evaluateHandle(() => document.activeElement);
  for (const key of ["Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await focus.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await objectCount(page)).toBe(before);
  }
  await focus.dispose();
});
