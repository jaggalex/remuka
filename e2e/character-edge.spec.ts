import { expect, test } from "@playwright/test";
import { addSticky, freshBoard, objectCount, openAccount, openRun, PASSWORD, register, selectKanbanCard } from "./helpers";

test("Tab after clicking a blank canvas stays there; Tab from a toolbar button navigates", async ({ page }) => {
  await freshBoard(page, "tab-empty", { template: "empty" });
  await page.locator(".layer.overlay").click({ position: { x: 180, y: 110 } });
  const before = await objectCount(page);
  await expect(page.locator(".layer.overlay")).toBeFocused();
  const canvasFocus = await page.evaluateHandle(() => document.activeElement);
  for (const key of ["Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await canvasFocus.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await objectCount(page)).toBe(before);
  }
  await canvasFocus.dispose();
  const toolbarButton = page.getByRole("button", { name: "Sticky note", exact: true });
  await toolbarButton.focus();
  await page.keyboard.press("Tab");
  await expect(toolbarButton).not.toBeFocused();
});

test("Tab from a selected sticky on the canvas adds exactly one connected sticky", async ({ page }) => {
  await freshBoard(page, "tab-sticky", { template: "empty" });
  const id = await addSticky(page);
  const point = await page.evaluate((id) => {
    const note = window.__remo.widgets.find(widget => widget.id === id)!;
    const canvas = document.querySelector(".layer.overlay")!.getBoundingClientRect();
    const { x, y, zoom } = window.__remo.camera;
    return { x: canvas.left + canvas.width / 2 + (note.x - x) * zoom, y: canvas.top + canvas.height / 2 + (note.y - y) * zoom };
  }, id);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".layer.overlay")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect.poll(() => objectCount(page, "sticky_note")).toBe(2);
  await expect.poll(() => objectCount(page, "connector")).toBe(1);
});

test("all six reactions display locally and reduced motion flashes on the selected object", async ({ page }) => {
  await freshBoard(page, "reaction-options");
  for (const emoji of ["👍", "❤️", "🔥", "😮", "🎉", "👏"]) {
    await openRun(page);
    const button = page.locator(".menu-reaction").filter({ hasText: emoji });
    await button.click();
    const burst = page.locator(".reaction-burst", { hasText: emoji });
    await expect(burst).toHaveCount(1);
    const style = await burst.evaluate(el => ({
      name: getComputedStyle(el).animationName,
      duration: getComputedStyle(el).animationDuration,
      x: Number.parseFloat((el as HTMLElement).style.left),
      y: Number.parseFloat((el as HTMLElement).style.top),
    }));
    expect(style.name).toBe("reaction-rise");
    expect(style.duration).toBe("2.4s");
    expect(style.x).toBeGreaterThanOrEqual(10);
    expect(style.x).toBeLessThanOrEqual(90);
    expect(style.y).toBeGreaterThanOrEqual(85);
    expect(style.y).toBeLessThanOrEqual(100);
  }
  await expect(page.locator(".reaction-burst")).toHaveCount(0);
  const cardId = await selectKanbanCard(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const observed = page.evaluate((cardId) => new Promise<{name: string; transforms: unknown[]; dx: number; dy: number}>(resolve => {
    const layer = document.querySelector(".reactions-layer")!;
    const observer = new MutationObserver(() => {
      const burst = layer.querySelector(".reaction-burst.anchored");
      if (!burst) return;
      observer.disconnect();
      const frames = (burst.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? [];
      const canvas = document.querySelector("canvas.layer.overlay")!.getBoundingClientRect();
      const placement = window.__remo.layouts.flatMap(layout => layout.placements).find(card => card.cardId === cardId)!;
      const { x, y, zoom } = window.__remo.camera;
      const origin = layer.getBoundingClientRect();
      const dx = origin.left + parseFloat(getComputedStyle(burst).left) - (canvas.left + canvas.width / 2 + (placement.x - x) * zoom);
      const dy = origin.top + parseFloat(getComputedStyle(burst).top) - (canvas.top + canvas.height / 2 + (placement.y - y) * zoom);
      resolve({name: getComputedStyle(burst).animationName, transforms: frames.map(frame => frame.transform), dx, dy});
    });
    observer.observe(layer, {childList: true});
  }), cardId);
  await openRun(page);
  await page.locator(".menu-reaction").last().click();
  const flash = await observed;
  expect(Math.abs(flash.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(flash.dy)).toBeLessThanOrEqual(2);
  expect(flash.name).toBe("reaction-flash");
  expect(flash.transforms).toEqual([undefined, undefined]);
  await expect(page.locator(".reaction-burst")).toHaveCount(0);
});

test("signing out on other devices preserves another member’s current session", async ({ page, browser, playwright }) => {
  const owner = await freshBoard(page, "qa-sessions-owner");
  const baseURL = new URL(page.url()).origin;
  const peerContext = await browser.newContext({ baseURL });
  const secondDevice = await playwright.request.newContext({ baseURL });
  try {
    const peer = await peerContext.newPage();
    await register(peer, "qa-sessions-peer");
    expect((await secondDevice.post("/api/auth/login", { data: { email: owner.email, password: PASSWORD } })).ok()).toBe(true);
    await openAccount(page);
    await page.getByRole("button", { name: "Account settings" }).click();
    await page.getByRole("navigation").getByRole("link", { name: "Security", exact: true }).click();
    const dialog = page.locator(".account-devices");
    const others = dialog.getByRole("button", { name: "Sign out on other devices" });
    await others.click();
    await expect(dialog.locator(".session-list li")).toHaveCount(1);
    expect((await secondDevice.get("/api/auth/me")).status()).toBe(401);
    expect((await peer.request.get("/api/auth/me")).status()).toBe(200);
    expect((await page.request.get("/api/auth/me")).status()).toBe(200);
  } finally {
    await secondDevice.dispose();
    await peerContext.close();
  }
});
