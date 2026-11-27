import { expect, test } from "@playwright/test";
import { enableLink, freshBoard } from "./helpers";

test("read-only empty room never offers or consumes an editor hint", async ({ page, browser }) => {
  const owner = await freshBoard(page, "qa-t13-reader", { template: "empty" });
  await enableLink(page, owner.boardId);
  const context = await browser.newContext({ locale: "en-US" });
  try {
    await context.addInitScript(() => {
      if (!localStorage.getItem("remuka.hints.room.empty"))
        localStorage.setItem("remuka.hints.room.empty", '{"done":0,"visits":2}');
    });
    const viewer = await context.newPage();
    await viewer.goto('/?room=' + owner.boardId + '&lang=en');
    await viewer.getByRole("button", { name: "Enter room", exact: true }).click();
    for (let visit = 0; visit < 2; visit++) {
      if (visit) await viewer.reload();
      await expect(viewer.locator(".rm-readonly")).toContainText("View only");
      const empty = viewer.locator(".empty-board");
      await expect(empty).toBeVisible();
      await expect(empty.locator("h1")).toHaveText("It's quiet in here");
      await expect(empty.getByRole("button")).toHaveCount(0);
      await expect(empty).not.toContainText("Make room for your team");
      expect(await viewer.evaluate(() => JSON.parse(localStorage.getItem("remuka.hints.room.empty")!).visits)).toBe(2);
    }
  } finally { await context.close(); }
});
