import { expect, test } from "@playwright/test";
import { register } from "./helpers";
import { surfaceViolations, type Violation } from "./invariants";

/**
 * The pages around the rooms keep their layout with long, unbroken names, in both
 * languages and on a desktop and a phone: home, all rooms, account settings and the
 * organisation page.
 */
const LONG_WORD = "Ретроспектива_квартального_планирования_команды";
const LONG_PERSON = "Анастасия_Константинопольская_Владиславовна";

for (const lang of ["en", "ru"] as const) {
  for (const width of [1440, 390]) {
    test(`pages keep their layout with long names · ${lang} · ${width}`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const account = await register(page, `pages-${lang}-${width}`, { user: LONG_PERSON, title: `${LONG_WORD}_2026` });
      await page.setViewportSize({ width, height: 900 });
      page.setDefaultTimeout(10_000);
      const found: Violation[] = [];
      const unreachable: string[] = [];
      const pages: Array<[string, string]> = [
        ["home", `/?lang=${lang}`],
        ["account · profile", `/?account=1&lang=${lang}#profile`],
        ["account · look", `/?account=1&lang=${lang}#look`],
        ["account · security", `/?account=1&lang=${lang}#security`],
        ["organisation", `/?org=${encodeURIComponent(account.orgId)}&lang=${lang}`],
      ];
      for (const [name, url] of pages) {
        try {
          await page.goto(url);
          await page.waitForLoadState("networkidle");
          await page.waitForTimeout(400);
          found.push(...(await surfaceViolations(page, name, "html")));
        } catch (error) {
          unreachable.push(`${name}: ${String(error).split("\n")[0]}`);
        }
      }
      await testInfo.attach("violations.json", { body: JSON.stringify({ found, unreachable }, null, 2), contentType: "application/json" });
      expect(unreachable).toEqual([]);
      expect(found).toEqual([]);
    });
  }
}
