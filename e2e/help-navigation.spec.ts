import { expect, test } from "@playwright/test";
import { HELP_TOPIC_IDS } from "../apps/web/src/help/topics.generated";

for (const [lang, width] of [["ru", 390], ["en", 1440]] as const) {
  test(`public help opens all topics by category and searches their content (${lang}, ${width})`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    await page.goto(`/help/${lang}`);
    const cards = page.locator(".help-category");
    await expect(cards).toHaveCount(4);
    const urls = new Set<string>();
    for (const type of ["tutorial", "how-to", "reference", "explanation"]) {
      const card = page.locator(`.help-category[data-type="${type}"]`);
      await card.focus();
      await page.keyboard.press("Enter");
      await expect(card).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".help-list a").first()).toBeVisible();
      for (const path of await page.locator(".help-list a").evaluateAll(links =>
        links.map(link => link.getAttribute("href")!))) urls.add(path);
    }
    expect([...urls].sort()).toEqual(HELP_TOPIC_IDS.map(id => `/help/${lang}/${id}`).sort());
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await page.goto(`/help/${lang}`);
    const search = page.getByRole("searchbox");
    await search.fill(lang === "ru" ? "голосование" : "voting");
    const vote = page.locator(`.help-list a[href="/help/${lang}/facilitation.vote"]`);
    await expect(vote).toBeVisible();
    await vote.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".help-article h1")).toBeVisible();
    const other = lang === "ru" ? "en" : "ru";
    await page.getByRole("button", {name: other.toUpperCase(), exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/help/${other}/facilitation\\.vote$`));
    await page.goBack();
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await page.locator(".help-crumbs a").click();
    await search.fill("zzz");
    await expect(page.locator(".help-notice")).toBeVisible();
    await expect(page.locator(".help-list a")).toHaveCount(0);
    await search.fill("");
    await expect(cards).toHaveCount(4);
    const excerpt = page.locator(".help-featured ol li");
    await expect(excerpt).toHaveCount(3);
    await expect(excerpt.last()).toContainText(lang === "ru" ? "Начать голосование" : "Start voting");
    await page.locator(".help-featured").getByRole("link", {name: lang === "ru" ? "Читать статью" : "Read the article"}).click();
    await expect(page.locator(".help-body ol")).not.toHaveCount(0);
  });
}
