import { expect, test, type Locator } from "@playwright/test";
import { freshBoard, openAccount, openBoard, setAccountLanguage, setAccountTheme } from "./helpers";

/** A text node can be present and its element visible while the button clips away every glyph. */
async function expectReadableText(line: Locator) {
  await expect.poll(() => line.evaluate(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width && rect.height);
    return rects.length > 0 && rects.every(rect => {
      const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      if (!hit || !node.contains(hit)) return false;
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const clip = ancestor.getBoundingClientRect();
        const style = getComputedStyle(ancestor);
        if (style.overflowX !== "visible" && (rect.left < clip.left - 1 || rect.right > clip.right + 1)) return false;
        if (style.overflowY !== "visible" && (rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1)) return false;
      }
      return true;
    });
  })).toBe(true);
}

test("room account settings lead to sessions, documents, cookies and account deletion", async ({ page }) => {
  const account = await freshBoard(page, "account-routes", { user: "Alex Bone" });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const lang of ["ru", "en"] as const) {
    await setAccountLanguage(page, lang);
    await openBoard(page, account.boardId, { lang });
    for (const theme of ["dark", "light"] as const) {
      await setAccountTheme(page, theme, lang);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await page.getByRole("button", { name: /^(?:Аккаунт и интерфейс|Account and interface)/ }).click();
      const profile = page.getByRole("button", { name: lang === "ru" ? "Настройки аккаунта" : "Account settings", exact: true });
      const unusedWidth = await profile.evaluate(button => {
        const parent = button.parentElement!;
        const style = getComputedStyle(parent);
        const rowWidth = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return rowWidth - button.getBoundingClientRect().width;
      });
      expect(Math.abs(unusedWidth)).toBeLessThanOrEqual(1);
      const name = profile.locator("strong");
      const role = profile.locator(".account-role");
      const link = profile.locator(".account-settings-label");
      await expect(name).toHaveText("Alex Bone");
      await expect(role).toHaveText(/^@.+ · .+/);
      await expect(link).toHaveText(lang === "ru" ? "Настройки ›" : "Settings ›");
      for (const line of [name, role, link]) await expectReadableText(line);
      await page.keyboard.press("Escape");
    }
  }
  await openAccount(page);
  await page.getByRole("button", { name: "Account settings" }).click();
  const sections = page.getByRole("navigation", { name: "Account sections" });
  await sections.locator('a[href="#security"]').click();
  await expect(page.locator(".session-current")).toBeVisible();
  await sections.locator('a[href="#docs"]').click();
  await expect(page.locator("#account-section")).toBeVisible();
  await page.getByRole("button", { name: "Cookies", exact: true }).click();
  const cookies = page.getByRole("dialog", { name: "Cookie settings" });
  await expect(cookies).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cookies).toBeHidden();
  await sections.locator('a[href="#delete"]').click();
  await expect(page.getByLabel("Current password")).toBeVisible();
});
