import { test, expect } from "@playwright/test";
import { freshBoard, openAccount } from "./helpers";

test("theme switches in the account menu and survives in Help", async ({ page }) => {
  await freshBoard(page, "theme");

  // Theme and language moved from the header's right edge into the account menu
  // (ADR-266 §2); a new account starts light.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await openAccount(page);
  await page.getByRole("radio", { name: "Dark", exact: true }).press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/help/en/comments.thread");
  await expect(page.locator(".theme-toggle-button")).toHaveAttribute("title", /dark/i);
  await page.locator(".theme-toggle-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
