import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { freshBoard, openFacilitation } from "./helpers";

for (const width of [390, 1440]) {
  test("all four facilitation tabs share one panel at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await freshBoard(page, "run-tabs-" + width, { template: "empty" });
    await openFacilitation(page);
    await page.getByRole("menuitem", { name: /Timer/ }).click();
    const panel = page.locator(".facilitation-panel");
    const tabs = panel.getByRole("tablist", { name: "Run", exact: true });
    await expect(tabs.getByRole("tab")).toHaveCount(4);
    const initial = await panel.elementHandle();
    for (const [name, body] of [["Vote", "Voting session"], ["Follow", "Followers"], ["Show", "Presentation"], ["Timer", "Shared timer"]]) {
      await tabs.getByRole("tab", { name, exact: true }).click();
      await expect(panel.getByRole("tabpanel")).toHaveAccessibleName(body);
      await expect(panel.getByRole("heading", { name: body, exact: true })).toBeVisible();
      expect(await initial!.evaluate(el => el === document.querySelector(".facilitation-panel"))).toBe(true);
    }
    const audit = await new AxeBuilder({ page }).include(".facilitation-panel").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations.map(v => [v.id, v.nodes.map(n => n.target)])).toEqual([]);
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
}
