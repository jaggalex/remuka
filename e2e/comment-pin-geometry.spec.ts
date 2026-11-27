import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { openBoardMenu, openComments, register, seedObject } from "./helpers";

async function pinError(page: Page, id: string, x: number, y: number) {
  return page.evaluate(({ id, x, y }) => {
    const overlay = document.querySelector(".layer.overlay")!.getBoundingClientRect();
    const pin = document.querySelector('[data-thread-id="' + id + '"]')?.getBoundingClientRect();
    const { camera } = (window as unknown as { __remo: { camera: { x: number; y: number; zoom: number } } }).__remo;
    if (!pin) return Infinity;
    return Math.hypot(pin.left + pin.width / 2 - (overlay.left + overlay.width / 2 + (x - camera.x) * camera.zoom),
      pin.bottom - (overlay.top + overlay.height / 2 + (y - camera.y) * camera.zoom));
  }, { id, x, y });
}

test("old and new anchors follow resized and rotated objects into a real PNG and a restored backup", async ({ page }) => {
  const account = await register(page, "pin-export");
  const boardPath = "/api/boards/" + account.boardId;
  const collection = boardPath + "/comments";
  const widgetId = await seedObject(page, account.boardId, { type: "shape", shape: "rect", x: 0, y: 0, width: 200, height: 100 });
  const legacy = { kind: "widget", widgetId };
  const legacyThread = await (await page.request.post(collection, { data: { anchor: legacy, body: "From an earlier release" } })).json();
  await page.goto("/?room=" + account.boardId + "&select=" + widgetId + "&lang=en");
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved");
  await openComments(page);
  await page.getByRole("button", { name: "New comment" }).click();
  await page.locator(".comment-composer textarea").fill("On the selection");
  await page.locator(".comment-composer").getByRole("button", { name: "Create" }).click();
  const list = async () => (await (await page.request.get(collection)).json()).threads as { id: string; anchor: Record<string, unknown> }[];
  await expect.poll(async () => (await list()).length).toBe(2);
  const current = (await list()).find(t => t.id !== legacyThread.thread.id)!;
  const expectedAnchor = { ...legacy, fx: .9, fy: .1 };
  expect(current.anchor).toEqual(expectedAnchor);
  await page.locator(".comments-panel").getByRole("button", { name: "Close" }).click();
  await expect.poll(() => pinError(page, legacyThread.thread.id, 0, -50)).toBeLessThan(2);
  await expect.poll(() => pinError(page, current.id, 80, -40)).toBeLessThan(2);
  const changed = await page.request.post(boardPath + "/commands", { headers: { "Idempotency-Key": "pin-rotate-" + Date.now() },
    data: { command: "board.item.update", input: { id: widgetId, patch: { width: 240, height: 140, rotation: 90 } } } });
  expect(changed.ok(), await changed.text()).toBe(true);
  const points = [{ x: 70, y: 0, id: legacyThread.thread.id as string }, { x: 56, y: 96, id: current.id }];
  for (const p of points) await expect.poll(() => pinError(page, p.id, p.x, p.y)).toBeLessThan(2);
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: /^(?:Export|Экспорт)/ }).click();
  const dialog = page.locator(".export-dialog");
  await dialog.getByRole("radio", { name: /^Whole room/ }).click();
  async function download(format: "PNG" | "backup" = "PNG") {
    const [result] = await Promise.all([page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Download " + format, exact: true }).click()]);
    return readFile(await result.path());
  }
  await dialog.locator(".export-comments input").check();
  const marked = await download();
  await dialog.locator(".export-comments input").uncheck();
  const plain = await download();
  const differences = await page.evaluate(async ({ images, points }) => {
    const pixels = await Promise.all(images.map(async data => {
      const bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + data)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return ctx;
    }));
    return points.map(p => {
      // The rotated rectangle has bounds [-70,-120,140,240], 24 world units of padding and a 2x PNG.
      const xy = [(p.x + 94) * 2 + 7, (p.y + 144) * 2];
      return pixels.map(ctx => [...ctx.getImageData(xy[0]!, xy[1]!, 1, 1).data].join(","));
    });
  }, { images: [marked.toString("base64"), plain.toString("base64")], points });
  for (const [withPin, withoutPin] of differences) expect(withPin).not.toBe(withoutPin);
  await dialog.getByRole("radio", { name: /Room backup/ }).click();
  const backup = await download("backup");
  expect(JSON.parse(backup.toString()).comments.map((t: {anchor: object}) => t.anchor)).toEqual(expect.arrayContaining([legacy, expectedAnchor]));
  await dialog.locator(".export-import summary").click();
  await dialog.locator("input[type=file]").setInputFiles({ name: "pins.json", mimeType: "application/json", buffer: backup });
  await dialog.getByRole("button", { name: "Replace the room" }).click();
  await expect(page.locator(".canvas-notice")).toContainText("restored from the backup");
  expect((await list()).map(t => t.anchor)).toEqual(expect.arrayContaining([legacy, expectedAnchor]));
});
