import { expect, test } from "@playwright/test";
import { freshBoard, objectCount } from "./helpers";
import { PROXY_PORT } from "./ports";

/**
 * Offline is a socket condition, not an HTTP one (ADR-084, ADR-266 §3).
 *
 * `context.setOffline` stops new requests but leaves the live WebSocket alone, so the
 * app would honestly stay in "saving". Closing the socket at the transport level is
 * what a tunnel or a sleeping laptop actually does. Offline is a word at once; the
 * return is "Saved" for two seconds, then silence.
 */
test("an offline edit is queued and replayed after reconnect", async ({ page }) => {
  const { boardId } = await freshBoard(page, "offline");

  // The harness proxy can lose the socket; Chromium's offline mode cannot, because it
  // does not affect localhost. The port follows the run (ADR-130).
  const offlineNotice = page.locator(".offline-notice[role=status]");
  try {
    expect((await page.request.post(`http://localhost:${PROXY_PORT}/__control/pause`)).ok()).toBe(true);
    await expect(page.locator(".save-state")).toHaveAttribute("data-state", "offline", {
      timeout: 2_000,
    });
    const chip = page.locator(".save-state");
    await expect(chip).toHaveText(/^No connection · \d+$/);
    const pendingAtDisconnect = Number(await chip.getAttribute("data-pending"));
    await expect(offlineNotice).toContainText("Keep this tab open.");
    await expect(offlineNotice.locator("strong")).toHaveText("No connection.");

    await page.getByRole("button", { name: "Sticky note", exact: true }).click();
    // The count is local Yjs updates, not objects: one note can be two updates.
    await expect.poll(async () => Number(await chip.getAttribute("data-pending")), {
      timeout: 15_000,
    }).toBeGreaterThan(pendingAtDisconnect);

    const queued = await chip.getAttribute("data-pending");
    await expect(chip).toHaveText("No connection · " + queued);

    // Retry against the still-paused proxy. A newly mounted banner would hide a brief flicker.
    const banner = await offlineNotice.elementHandle();
    const roomRetry = {
      predicate: (socket: { url(): string }) => decodeURIComponent(new URL(socket.url()).pathname).endsWith(`/${boardId}`),
      timeout: 10_000,
    };
    await page.waitForEvent("websocket", roomRetry);
    // The next attempt proves the previous one failed while the proxy was paused.
    await page.waitForEvent("websocket", roomRetry);
    expect(await banner.evaluate((element) => element.isConnected)).toBe(true);
    await expect(chip).toHaveText("No connection · " + queued);
  } finally {
    expect((await page.request.post(`http://localhost:${PROXY_PORT}/__control/resume`)).ok()).toBe(true);
  }
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 30_000,
  });
  await expect(offlineNotice).toHaveCount(0);
  // The return is announced and drawn for two seconds, then the header is quiet again.
  await expect(page.locator(".save-state")).toContainText("Saved");
  await expect(page.locator('.topbar-save [role="status"][aria-live="polite"]')).toContainText("Saved");
  await expect(page.locator(".save-state")).toBeHidden({ timeout: 2_500 });

  await page.reload();
  await expect.poll(() => objectCount(page, "sticky_note")).toBeGreaterThanOrEqual(1);
});

test("an offline reader on a phone sees when shared changes will return", async ({ page, browser }) => {
  const account = await freshBoard(page, "offline-reader");
  const link = await page.request.put(`/api/boards/${account.boardId}/link`, { data: { enabled: true, role: "viewer" } });
  expect(link.ok()).toBe(true);
  const guest = await browser.newContext({ viewport: { width: 390, height: 900 } });
  try {
    const reader = await guest.newPage();
    await reader.goto(`/?room=${account.boardId}&lang=ru`);
    const name = reader.getByRole("dialog", { name: "Как вас подписать?" });
    await name.getByRole("textbox").fill("Илья");
    await name.getByRole("textbox").press("Enter");
    await expect(reader.locator(".save-state")).toHaveAttribute("data-state", "saved");
    await expect(reader.locator(".rm-readonly")).toBeVisible();
    expect((await page.request.post(`http://localhost:${PROXY_PORT}/__control/pause`)).ok()).toBe(true);
    await expect(reader.locator(".save-state")).toHaveText("Нет связи");
    await expect(reader.locator(".offline-notice[role=status]")).toHaveText(
      "Нет связи. Новые изменения появятся, когда соединение восстановится.",
    );
    await expect(reader.locator(".offline-notice[role=status] strong")).toHaveText("Нет связи.");
    await expect(reader.locator(".offline-notice[role=status]")).toBeInViewport({ ratio: 1 });
    await expect(reader.locator(".offline-blocked")).toHaveCount(0);
    const box = await reader.locator(".offline-notice").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  } finally {
    await page.request.post(`http://localhost:${PROXY_PORT}/__control/resume`);
    await guest.close();
  }
});
