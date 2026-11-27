import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { register } from "./helpers";

for (const width of [390, 1440]) {
  test("creates a room from four template cards and a collapsed location at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await register(page, "new-room-" + width);
    await page.goto("/?lang=en");
    await page.getByRole("button", { name: "New room", exact: true }).first().click();
    const form = page.locator(".new-room-sheet");
    await expect(form.getByRole("radiogroup").first().getByRole("radio")).toHaveCount(4);
    const title = form.getByLabel("Name", { exact: true });
    await title.fill("A");
    await title.fill("");
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByRole("button", { name: "Create room" })).toBeDisabled();
    await title.fill("Roadmap cards " + width);
    await form.getByRole("radio", { name: /roadmap/i }).check();
    await form.getByRole("radio", { name: "With an example" }).check();
    await expect(form.getByLabel("Organisation")).toBeHidden();
    await form.locator("summary").click();
    await expect(form.getByLabel("Organisation")).toBeVisible();
    const audit = await new AxeBuilder({ page }).include(".new-room-sheet").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations.map(v => v.id)).toEqual([]);
    expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await form.getByRole("button", { name: "Create room" }).click();
    await expect(page).toHaveURL(/template=product-roadmap-basic-prefilled/);
    await expect(page.locator(".save-state")).toHaveAttribute("data-state","saved");
  });
}
