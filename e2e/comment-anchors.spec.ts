import { expect, test, type Page } from "@playwright/test";
import { freshBoard, openComments, register, seedNote } from "./helpers";

function client(page: Page, x: number, y: number) {
  return page.evaluate(({ x, y }) => {
    const { camera } = (window as unknown as { __remo: { camera: { x: number; y: number; zoom: number } } }).__remo;
    const rect = document.querySelector(".layer.overlay")!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 + (x - camera.x) * camera.zoom, y: rect.top + rect.height / 2 + (y - camera.y) * camera.zoom };
  }, { x, y });
}

test("a comment pin follows the click, moves between objects and the board, and undo restores its previous anchor", async ({ page }) => {
  const account = await freshBoard(page, "pin-drag", { template: "empty" });
  const left = await seedNote(page, account.boardId, { x: -180, y: 0 }, { width: 160, height: 120 }, "A");
  const right = await seedNote(page, account.boardId, { x: 120, y: 0 }, { width: 180, height: 120 }, "B");
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.filter(w => w.type === "sticky_note").length)).toBe(2);
  await openComments(page);
  await page.getByRole("button", { name: "New comment" }).click();
  const place = await client(page, -220, 30);
  await page.mouse.click(place.x, place.y);
  await page.locator(".comment-composer textarea").fill("Pin");
  await page.locator(".comment-composer").getByRole("button", { name: "Create" }).click();
  const pin = page.locator(".comment-pin");
  await expect(pin).toBeVisible();
  const endpoint = `/api/boards/${account.boardId}/comments`;
  const anchor = async () => (await (await page.request.get(endpoint)).json()).threads[0].anchor;
  const old = await anchor();
  expect(old).toMatchObject({ kind: "widget", widgetId: left });
  expect(old.fx).toBeCloseTo(.25, 1);
  expect(old.fy).toBeCloseTo(.75, 1);
  const box = await pin.boundingBox();
  expect(box!.y + box!.height).toBeCloseTo(place.y, 0);
  async function drag(worldX: number, worldY: number) {
    await expect(pin).toHaveAttribute("data-movable", "true");
    await pin.hover();
    const visibleTarget = await pin.evaluate(element => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest("button")?.className;
    });
    expect(visibleTarget, "the pin must own its visible hit target before the drag").toContain("comment-pin");
    const pos = await client(page, worldX, worldY);
    const saved = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith("/anchor"));
    await page.mouse.down(); await page.mouse.move(pos.x, pos.y, { steps: 8 }); await page.mouse.up();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    await expect(pin).toHaveAttribute("data-movable", "true");
  }
  await drag(-150, 0);
  await expect.poll(async () => (await anchor()).fx).toBeCloseTo(.6875, 1);
  await drag(140, 0);
  await expect.poll(async () => (await anchor()).widgetId).toBe(right);
  const second = await anchor();
  await drag(-80, 180);
  await expect.poll(async () => (await anchor()).kind).toBe("point");
  await page.keyboard.press("Control+z");
  await expect.poll(anchor).toEqual(second);
});

test("only the thread author and a board manager can move it; stale changes preserve the newer anchor", async ({ page, browser }) => {
  const owner = await freshBoard(page, "pin-manager");
  const peer = await browser.newPage();
  const outsider = await browser.newPage();
  try {
    for (const [tab, name] of [[peer,"author"],[outsider,"another"]] as const) {
      const member = await register(tab, "pin-" + name);
      const invited = await page.request.post(`/api/orgs/${owner.orgId}/invitations`, { data: { email: member.email } });
      const token = new URL((await invited.json()).url).searchParams.get("invite");
      expect((await tab.request.post("/api/invitations/accept", { data: { token } })).ok()).toBe(true);
      const { user } = await (await tab.request.get("/api/auth/me")).json();
      expect((await page.request.post(`/api/boards/${owner.boardId}/grants`, { data: { subjectType: "user", subjectId: user.id, role: "commenter" } })).ok()).toBe(true);
    }
    const collection = `/api/boards/${owner.boardId}/comments`;
    const first = { kind: "point", x: 0, y: 4 }, second = { kind: "point", x: 9, y: 9 };
    const response = await peer.request.post(collection, { data: { anchor: first, body: "Only my pin" } });
    expect(response.ok(), await response.text()).toBe(true);
    const { thread } = await response.json();
    const move = (tab: Page, expected: object, anchor: object) => tab.request.patch(collection + "/" + thread.id + "/anchor", { data: { expected, anchor } });
    expect((await move(outsider, first, second)).status()).toBe(403);
    expect((await move(peer, first, second)).status()).toBe(200);
    expect((await move(page, first, second)).status()).toBe(409);
    expect((await move(page, second, { kind: "widget", widgetId: "x", fx: 9, fy: 0 })).status()).toBe(422);
    expect((await move(page, second, first)).status()).toBe(200);
  } finally { await peer.close(); await outsider.close(); }
});
