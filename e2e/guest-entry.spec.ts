import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { register, seedObject } from "./helpers";

for (const lang of ["ru", "en"] as const) {
  for (const width of [390, 1440]) {
    test(`a public visitor unlocks, chooses a name and reopens the room (${lang}, ${width})`, async ({ page, browser }, info) => {
      const title = lang === "ru" ? "Ретро · спринт 14" : "Retro · sprint 14";
      const account = await register(page, "guest-entry", { title });
      const notes = lang === "ru"
        ? ["Демо без багов", "Ревью в последний день", "Повестка заранее", "Стенд за день до демо"]
        : ["A smooth demo", "Last-day review", "An early agenda", "A test run before the demo"];
      for (const [index, content] of notes.entries()) {
        await seedObject(page, account.boardId, {
          type: "sticky_note", x: (index - 1.5) * 185, y: index % 2 ? 30 : -30, width: 160, height: 150, content,
        });
      }
      const password = "Example-Password-24";
      const link = await page.request.put(`/api/boards/${account.boardId}/link`, { data: { enabled: true, password } });
      expect(link.ok(), await link.text()).toBe(true);
      const reduced = width === 390;
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: reduced ? "reduce" : "no-preference" });
      try {
        const guest = await context.newPage();
        await guest.goto(`/?room=${account.boardId}&lang=${lang}`);
        const gate = guest.locator(".guest-password");
        await expect(gate).toBeVisible();
        await expect(guest.getByText(title, { exact: true })).toHaveCount(0);
        await expect(gate.getByRole("button")).toBeDisabled();
        await info.attach("gate", { body: await guest.screenshot(), contentType: "image/png" });
        const field = gate.getByLabel(lang === "ru" ? "Пароль комнаты" : "Room password");
        await field.fill("incorrect");
        await field.press("Enter");
        await expect(gate.getByRole("alert")).toHaveText(lang === "ru" ? /Не тот пароль/ : /That password didn’t work/);
        await expect(field).toHaveAttribute("aria-invalid", "true");
        const shake = gate.locator(".rm-shake");
        await expect(shake).toHaveAttribute("data-shake", "1");
        if (reduced) await expect(shake).toHaveCSS("animation-name", "none");
        const invalidForm = await new AxeBuilder({ page: guest }).include(".guest-password").withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(invalidForm.violations.map(item => item.id)).toEqual([]);
        await info.attach("gate-error", { body: await guest.screenshot(), contentType: "image/png" });
        await field.fill(password);
        await field.press("Enter");
        const sheet = guest.getByRole("dialog", { name: lang === "ru" ? "Как вас подписать?" : "What should we call you?" });
        await expect(sheet).toBeVisible();
        const input = sheet.getByRole("textbox");
        const suggested = await input.getAttribute("placeholder");
        expect(suggested).toBeTruthy();
        const name = width === 1440 ? (lang === "ru" ? "Алёна" : "Alex") : suggested!;
        if (width === 1440) await input.fill(`  ${name}  `);
        await expect(sheet.locator(".guest-preview strong")).toHaveText(name);
        const nameForm = await new AxeBuilder({ page: guest }).include(".guest-name-sheet").withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(nameForm.violations.map(item => item.id)).toEqual([]);
        await info.attach("name", { body: await guest.screenshot(), contentType: "image/png" });
        await input.press("Enter");
        await expect(sheet).toHaveCount(0);
        await expect(guest.locator(".rm-readonly")).toBeVisible();
        await expect(guest.locator(".guest-signup")).toHaveAttribute("href", `/?signup=1&lang=${lang}`);
        await expect(guest.locator(".guest-room-note")).toBeVisible();
        await expect(guest.locator(".guest-you")).toBeVisible();
        await expect(guest.locator(".topbar-left")).toContainText(title);
        if (width === 390) {
          const first = (await guest.locator(".topbar-left").boundingBox())!;
          const second = (await guest.locator(".topbar-right").boundingBox())!;
          expect(first.y + first.height).toBeLessThanOrEqual(second.y);
        }
        await expect(guest.locator(".peer, .canvas-hint")).toHaveCount(0);
        expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await info.attach("room", { body: await guest.screenshot(), contentType: "image/png" });
        await guest.reload();
        await expect(guest.locator(".guest-room-note")).toBeVisible();
        await expect(guest.locator(".guest-you")).toContainText(name);
        await expect(sheet).toHaveCount(0);
        await guest.locator(".guest-signup").click();
        await expect(guest.locator(".signup-screen")).toBeVisible();
        await expect(guest.locator("html")).toHaveAttribute("lang", lang);
      } finally {
        await context.close();
      }
    });
  }
}
