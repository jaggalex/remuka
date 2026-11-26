import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { PASSWORD, register } from "./helpers";

for (const width of [390, 1440]) {
  test("sign-in keeps keyboard focus on the page and errors readable at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const account = await register(page, "auth-a11y-" + width);
    expect((await page.request.post("/api/auth/logout")).ok()).toBeTruthy();
    await page.goto("/?room=" + account.boardId + "&lang=ru");
    await page.locator(".access-gate").getByRole("button", { name: "Войти", exact: true }).click();
    const form = page.locator('.auth-page[data-step="login"]');
    await expect(form).toBeVisible();
    await expect(form.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const field = await form.locator('.rm-input').filter({ has: page.locator('input[type="email"]') }).boundingBox();
    const action = await form.locator('button[type="submit"]').boundingBox();
    expect(Math.abs(field!.width - action!.width), "the primary action fills the field width").toBeLessThanOrEqual(1);
    const blocker = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(blocker.violations.map(v => [v.id, v.nodes.map(node => node.target)])).toEqual([]);
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press("Tab");
      expect(await form.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body),
        "keyboard focus escaped to an element behind the sign-in page").toBe(true);
    }
    await form.getByLabel("Почта", { exact: true }).fill(account.email);
    await form.locator('input[type=password]').fill("an incorrect password");
    await page.keyboard.press("Enter");
    await expect(form.getByRole("alert")).toContainText("Пароль не подошёл");
    expect(await form.evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true);
    await form.locator('input[type=password]').fill(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp("room=" + account.boardId));
  });
}
