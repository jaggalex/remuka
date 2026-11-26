import { expect, test } from "@playwright/test";
import { freshBoard, goAllRooms, seedNote } from "./helpers";

test("a closed room gets a private WebP cover from its saved content", async ({ page, browser }) => {
  test.setTimeout(65_000);
  const account = await freshBoard(page, "cover", { template: "empty", title: "Cover preview" });
  await seedNote(page, account.boardId, { x: 0, y: 0 }, undefined, "Room preview");
  await goAllRooms(page);
  const route = `/api/boards/${account.boardId}/cover`;
  await expect.poll(async () => (await page.request.get(route)).status(),
    { timeout: 47_000, intervals: [500, 1000, 2000] }).toBe(200);
  const response = await page.request.get(route);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await response.body()).length).toBeLessThanOrEqual(150 * 1024);
  await page.reload();
  const preview = page.locator(".home-tile", { hasText: "Cover preview" }).locator("img");
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) =>
    [image.naturalWidth, image.naturalHeight])).toEqual([640, 360]);
  const stranger = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    expect((await stranger.request.get(route)).status()).toBe(404);
  } finally { await stranger.close(); }
});
