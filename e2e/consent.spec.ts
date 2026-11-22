/**
 * Cookie notice, banner, settings and policy page (ADR-255, `spec/cookies.md` §6).
 *
 * The zone is an installation setting, so every scenario reads `GET /config` and skips
 * when the run is configured for another zone:
 *
 *   pnpm e2e                                        # none: nothing anywhere
 *   E2E_COMPLIANCE_ZONE=ru pnpm e2e e2e/consent.spec.ts   # the short notice, one button
 *   E2E_COMPLIANCE_ZONE=eu pnpm e2e e2e/consent.spec.ts   # no plate, footer entry only
 *
 * The banner needs an analytics or marketing record in `@remo/consent`; there is none in
 * this release, so its zone matrix is proved in `apps/web/src/consentClient.test.ts` and
 * the first screen of the real banner is covered by `consentUi.test.ts`. A tracking
 * provider would add one line to the registry and this file's banner case would be live.
 *
 * The personal-data consent link is optional (`REMO_PERSONAL_DATA_CONSENT_URL`), so the
 * scenarios read `/api/config` and assert both honest states: the link with the configured
 * address, and no link at all when the operator set none.
 */
import { expect, test, type Page } from "@playwright/test";
import { register } from "./helpers";

type Zone = "eu" | "ru" | "none";

interface Config {
  zone: Zone;
  personalDataConsentUrl: string | null;
}

async function config(page: Page): Promise<Config> {
  const response = await page.request.get("/api/config");
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as {
    compliance?: { zone?: Zone; personalDataConsentUrl?: unknown };
  };
  return {
    zone: body.compliance?.zone ?? "none",
    personalDataConsentUrl:
      typeof body.compliance?.personalDataConsentUrl === "string"
        ? body.compliance.personalDataConsentUrl
        : null,
  };
}

async function zone(page: Page): Promise<Zone> {
  return (await config(page)).zone;
}

async function gotoHome(page: Page, lang: "ru" | "en" = "en"): Promise<void> {
  await page.goto(`/?lang=${lang}`);
}

/** The footer entry of §6.3, the same on the home, help and sign-in screens. */
async function openCookieSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Cookies?$/ }).first().click();
  await expect(page.getByRole("dialog", { name: /Cookie settings|Настройки cookie/ })).toBeVisible();
}

test("the sign-in screen offers cookie settings and documents once, not twice", async ({ page }) => {
  // A second copy inside the signed-out panel used to sit beside the footer entry, so a
  // guest saw two identical pairs. The footer is the one entry (§6.3), and it is present
  // before sign-in; `.first()` in the other tests hid the duplicate.
  await gotoHome(page);
  await expect(page.locator(".home-empty")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cookies?$/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^Documents$/ })).toHaveCount(1);
});

test("ru: the notice appears once, focused, and the server remembers the answer", async ({ page }) => {
  test.skip((await zone(page)) !== "ru", "configure E2E_COMPLIANCE_ZONE=ru");
  await gotoHome(page, "ru");

  const notice = page.locator(".consent-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("использует cookie");
  await expect(notice.getByRole("link", { name: "Подробнее" })).toHaveAttribute(
    "href",
    /legal=cookies$/,
  );

  // §3, §6.1: the separate personal-data consent document is linked exactly when the
  // operator configured it, and never otherwise.
  const { personalDataConsentUrl } = await config(page);
  const personalData = notice.getByRole("link", {
    name: "Согласие на обработку персональных данных",
  });
  if (personalDataConsentUrl) {
    await expect(personalData).toHaveAttribute("href", personalDataConsentUrl);
  } else {
    await expect(personalData).toHaveCount(0);
  }

  // §6.1 and §10: the first button holds focus; Enter answers, Escape answers too.
  await expect(notice.getByRole("button", { name: "Понятно" })).toBeFocused();
  const answered = page.waitForResponse(
    (response) => response.url().endsWith("/api/consent") && response.request().method() === "POST",
  );
  await page.keyboard.press("Enter");
  expect((await answered).ok()).toBeTruthy();
  await expect(notice).toHaveCount(0);

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "remo_consent")?.value).toMatch(/^v1\.ru\./);

  // §10: after a reload the plate is gone, because the cookie is the state (§4).
  await page.reload();
  await expect(page.locator(".consent-notice")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Cookies?$/ }).first()).toBeVisible();
});

test("eu: no plate while the registry has no optional category, but the settings and policy exist", async ({
  page,
}) => {
  test.skip((await zone(page)) !== "eu", "configure E2E_COMPLIANCE_ZONE=eu");
  await gotoHome(page);
  await expect(page.locator(".consent-notice")).toHaveCount(0);
  await expect(page.locator(".consent-banner")).toHaveCount(0);

  await openCookieSettings(page);
  const dialog = page.getByRole("dialog", { name: /Cookie settings/ });
  // §6, §7: there is nothing optional in this release, so the screen states the categories
  // that are always on and offers no switch and no save button.
  await expect(dialog).toContainText("Always on");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("none: no notice, no banner, no consent cookie, and settings explain the one rule", async ({
  page,
}) => {
  test.skip((await zone(page)) !== "none", "configure E2E_COMPLIANCE_ZONE=none");
  await gotoHome(page);
  await expect(page.locator(".consent-notice")).toHaveCount(0);
  await expect(page.locator(".consent-banner")).toHaveCount(0);
  expect((await page.context().cookies()).some((cookie) => cookie.name === "remo_consent")).toBe(
    false,
  );
  // §7: the link and the policy page stay; the screen has no switch at all.
  await expect(page.getByRole("button", { name: /^Cookies?$/ }).first()).toBeVisible();
  await openCookieSettings(page);
  const dialog = page.getByRole("dialog", { name: /Cookie settings/ });
  await expect(dialog).toContainText("uses only necessary cookies");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  // ADR-264: the register is folded; the row states the category, the list opens on click.
  await expect(dialog.locator(".consent-records").first()).toBeHidden();
  await dialog.locator("summary").first().click();
  await expect(dialog.locator(".consent-records").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("the notice never covers the tool rail in a room", async ({ page }) => {
  test.skip((await zone(page)) !== "ru", "configure E2E_COMPLIANCE_ZONE=ru");
  const account = await register(page, "consent-room");
  // `openBoard` waits for the English "saved"; the room here is Russian, so the state
  // attribute is the language-neutral fact.
  await page.goto(`/?room=${account.boardId}&lang=ru`);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });

  const notice = page.locator(".consent-notice");
  await expect(notice).toBeVisible();
  const overlaps = await page.evaluate(() => {
    const rail = document.querySelector(".tool-rail")?.getBoundingClientRect();
    const plate = document.querySelector(".consent-notice")?.getBoundingClientRect();
    if (!rail || !plate) return true;
    return !(
      plate.right <= rail.left ||
      plate.left >= rail.right ||
      plate.bottom <= rail.top ||
      plate.top >= rail.bottom
    );
  });
  expect(overlaps).toBe(false);

  await notice.getByRole("button", { name: "Понятно" }).click();
  await expect(notice).toHaveCount(0);
});

test("the policy page lists the registry and opens the settings", async ({ page }) => {
  await page.goto("/?legal=cookies&lang=en");
  await expect(page.getByRole("heading", { name: "Cookie policy" })).toBeVisible();
  const table = page.locator(".consent-legal-table");
  await expect(table).toBeVisible();
  // Every registry record, including the two that carry the module itself.
  await expect(table).toContainText("remo_session");
  await expect(table).toContainText("remo_consent");
  await expect(table).toContainText("Necessary");

  await page.getByRole("button", { name: "Manage cookies" }).click();
  await expect(page.getByRole("dialog", { name: "Cookie settings" })).toBeVisible();
  // The settings screen is reachable from the policy page in every zone (§6.3, §6.4).
  await expect(
    page.getByRole("dialog", { name: "Cookie settings" }).getByText("Always on").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Both interface languages render the same registry; only the words change.
  await page.goto("/?legal=cookies&lang=ru");
  await expect(page.getByRole("heading", { name: "Политика cookie" })).toBeVisible();
  await expect(page.locator(".consent-legal-table")).toContainText("Необходимые");
  await expect(page.locator(".consent-legal-table")).toContainText("Вход в аккаунт");
});

test("the account menu opens the same cookie settings", async ({ page }) => {
  const account = await register(page, "consent-menu");
  await page.goto(`/?org=${account.orgId}&lang=en`);
  await page.locator(".account-button").click();
  // The footer carries the same name; the menu entry is the one inside the popover.
  const item = page.locator(".rm-popover").getByRole("button", { name: /^Cookies?$/ });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByRole("dialog", { name: "Cookie settings" })).toBeVisible();
});

test("the footer entry works with the keyboard and returns focus on Escape", async ({ page }) => {
  const current = await zone(page);
  await gotoHome(page);
  // The notice takes focus when it mounts (§6.1); wait for it before taking focus away.
  await expect(page.locator(".consent-notice")).toHaveCount(current === "ru" ? 1 : 0);
  const entry = page.getByRole("button", { name: /^Cookies?$/ }).first();
  await entry.focus();
  await expect(entry).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Cookie settings|Настройки cookie/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
});
