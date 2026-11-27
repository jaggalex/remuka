import { expect, test, type Page } from "@playwright/test";
import { register, seedConnector, seedNote, seedObject } from "./helpers";
import { surfaceViolations, type Violation } from "./invariants";

/**
 * The room's surfaces in Russian, whose words run longer than the English ones the
 * other suite reads. Surfaces are opened by their controls' classes and roles, not by
 * their English names.
 */
const LONG_WORD = "Ретроспектива_квартального_планирования_команды";
const LONG_PERSON = "Анастасия_Константинопольская_Владиславовна";
const OPEN = '[role="menu"], [role="dialog"], .rm-popover, aside.inspector, .comments-panel, .facilitation-panel';

async function closeAll(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('[role="menu"], [aria-modal="true"], .rm-popover').count())) break;
    await page.keyboard.press("Escape");
  }
}

for (const width of [1440, 390]) {
  test(`room surfaces keep their layout in Russian at ${width}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const account = await register(page, `room-ru-${width}`, { user: LONG_PERSON, title: `${LONG_WORD}_2026` });
    const id = account.boardId;
    await seedObject(page, id, { type: "frame", x: -900, y: -600, width: 700, height: 500 });
    const a = await seedNote(page, id, { x: 0, y: 0 }, undefined, `${LONG_WORD}_заметка`);
    const b = await seedObject(page, id, { type: "sticky_note", x: 300, y: 0, width: 160, height: 160, name: `${LONG_WORD}_имя` });
    await seedConnector(page, id, a, b);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?room=${id}&lang=ru`);
    await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    page.setDefaultTimeout(8_000);

    const found: Violation[] = [];
    const unreachable: string[] = [];
    const check = async (surface: string, open: () => Promise<void>, selector = OPEN) => {
      try {
        await open();
        await page.waitForTimeout(350);
        found.push(...(await surfaceViolations(page, surface, selector)));
      } catch (error) {
        unreachable.push(`${surface}: ${String(error).split("\n")[0]}`);
      }
      await closeAll(page);
    };

    await check("меню комнаты", () => page.locator(".board-title-button").click());
    await check("люди", () => page.locator(".people-trigger").click());
    await check("аккаунт", () => page.locator(".account-button").click());
    await check("провести · меню", () => page.locator(".run-trigger").click());
    const tabs = ["Таймер", "Голосование", "Следовать", "Показ"];
    for (const tab of tabs) {
      await check(`провести · ${tab}`, async () => {
        if (!(await page.locator(".facilitation-panel").isVisible())) {
          await page.locator(".run-trigger").click();
          await page.getByRole("menuitem", { name: /Таймер/ }).click();
        }
        await page.locator(".facilitation-panel").getByRole("tab", { name: tab, exact: true }).click();
      }, ".facilitation-panel");
    }
    await page.keyboard.press("Escape");
    await check("поиск команд", async () => {
      await page.keyboard.press("Control+k");
      await page.locator('[role="dialog"] [role="combobox"]').fill("э");
    });
    await check("позвать", () => page.locator(".topbar-invite").click());

    await testInfo.attach("violations.json", { body: JSON.stringify({ found, unreachable }, null, 2), contentType: "application/json" });
    expect(unreachable).toEqual([]);
    expect(found).toEqual([]);
  });
}
