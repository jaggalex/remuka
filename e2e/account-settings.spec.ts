import { expect, test } from "@playwright/test";
import { PASSWORD, register } from "./helpers";

test("account appearance and security use live account data on a narrow screen", async ({ page }) => {
  const owner = await register(page, "account-settings");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?account=1&lang=en#look");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(main.getByRole("combobox", { name: "Language" })).toHaveAccessibleDescription("Interface and emails");
  await expect(main.getByRole("switch", { name: "Calm animations" })).toHaveAccessibleDescription(/spring effects/);
  await main.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(async () => (await (await page.request.get("/api/auth/me")).json()).user.preferences.theme).toBe("dark");
  expect(await main.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(390);

  await main.getByRole("link", { name: "Security", exact: true }).click();
  await expect(main.getByRole("heading", { name: "Where you are signed in" })).toBeVisible();
  await expect(main.locator(".session-current")).toBeVisible();
  await main.getByRole("button", { name: "Change password" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Current password").fill("incorrect");
  await dialog.getByLabel("New password").fill(PASSWORD + "changed");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toContainText("That password is not correct");
  await dialog.getByLabel("Current password").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/signin=1/);
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  const login = await page.request.post("/api/auth/login", {
    data: { email: owner.email, password: PASSWORD + "changed" },
  });
  expect(login.ok()).toBe(true);
});

test("account settings never display the profile to a signed-out visitor", async ({ page }) => {
  await page.goto("/?account=1&lang=en#profile");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});
