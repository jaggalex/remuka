import { expect, test } from "@playwright/test";
import { freshBoard, objectCount } from "./helpers";
import { PROXY_PORT } from "./ports";

/**
 * Offline is a socket condition, not an HTTP one (ADR-084, ADR-266 §3).
 *
 * `context.setOffline` stops new requests but leaves the live WebSocket alone, so the
 * app would honestly stay in "saving". Closing the socket at the transport level is
 * what a tunnel or a sleeping laptop actually does. Offline is a word at once; the
 * return is "All saved" for two seconds, then silence.
 */
test("an offline edit is queued and replayed after reconnect", async ({ page }) => {
  await freshBoard(page, "offline");

  // The harness proxy can lose the socket; Chromium's offline mode cannot, because it
  // does not affect localhost. The port follows the run (ADR-130).
  await page.request.post(`http://localhost:${PROXY_PORT}/__control/pause`);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "offline", {
    timeout: 2_000,
  });
  await expect(page.locator(".save-state")).toContainText("No connection — edits will wait");
  await expect(page.locator('.topbar-save [role="status"][aria-live="polite"]')).toContainText("No connection");

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  // The count is local Yjs updates, not objects: one note can be two updates.
  await expect(page.locator(".save-state")).toHaveAttribute("data-pending", /[1-9]/, {
    timeout: 15_000,
  });

  await page.request.post(`http://localhost:${PROXY_PORT}/__control/resume`);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 30_000,
  });
  // The return is announced and drawn for two seconds, then the header is quiet again.
  await expect(page.locator(".save-state")).toContainText("All saved");
  await expect(page.locator('.topbar-save [role="status"][aria-live="polite"]')).toContainText("All saved");
  await expect(page.locator(".save-state")).toBeHidden({ timeout: 2_500 });

  await page.reload();
  await expect.poll(() => objectCount(page, "sticky_note")).toBeGreaterThanOrEqual(1);
});
