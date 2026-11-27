import { test, expect } from "@playwright/test";
import { freshBoard, openBoardMenu, goAllRooms } from "./helpers";

test("home shows board tiles with metadata, then the directory at a second page", async ({
  page,
}) => {
  const account = await freshBoard(page, "home-meta", { title: "Meta board" });
  await goAllRooms(page);

  const home = page.locator(".home");
  await expect(home.locator(".org-badge.personal").first()).toBeVisible();
  const tile = home.locator(".home-tile").filter({ hasText: "Meta board" });
  await expect(tile).toContainText("home-meta");
  await expect(tile).toContainText("changed");

  // A small home still exposes the tile's appearance without the paging toolbar.
  await expect(home.locator(".home-toolbar")).toHaveCount(0);
  await tile.locator(".home-tile-menu > button").click();
  await tile.getByRole("menuitem", { name: "Cover and icon" }).click();
  await page.getByRole("searchbox", { name: "Search emoji" }).fill("otter");
  await page.getByRole("button", { name: "otter", exact: true }).click();
  await expect(tile.locator(".home-tile-icon")).toHaveText("🦦");

  await tile.locator(".home-tile-main").click();
  await expect(page.locator(".board-title-button")).toContainText("🦦");
  await openBoardMenu(page, "more");
  await page.getByRole("menuitem", { name: "Cover and icon" }).click();
  await page.getByRole("button", { name: "No emoji" }).click();
  await expect(page.locator(".board-title-button")).not.toContainText("🦦");
  await goAllRooms(page);
  await expect(tile.locator(".home-tile-icon")).toHaveCount(0);

  for (let index = 1; index <= 24; index += 1) {
    const created = await page.request.post(`/api/orgs/${account.orgId}/boards`, {
      data: { title: `Meta page ${String(index).padStart(2, "0")}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  await page.reload();
  await expect(home.locator(".home-toolbar")).toBeVisible();

  const first = home.locator(".home-tile").first();
  await first.locator(".home-tile-menu > button").click();
  await first.getByRole("menuitem", { name: "Cover and icon" }).click();
  await page.getByRole("searchbox", { name: "Search emoji" }).fill("🚀");
  await page.getByRole("button", { name: "rocket", exact: true }).click();
  await expect(first.locator(".home-tile-icon")).toHaveText("🚀");

  await page.reload();
  await expect(home.locator(".home-tile").first().locator(".home-tile-icon")).toHaveText("🚀");
});

test("trashes a board and restores it from the home", async ({ page }) => {
  await freshBoard(page, "home-trash", { title: "Trash board" });

  // Moving it from the room and restoring from the home exercise both entry points.
  await openBoardMenu(page);
  await page.getByRole("menu").locator('[data-command="room.trash"]').click();
  await page.getByRole("button", { name: "Move to trash" }).click();

  const home = page.locator(".home");
  await expect(home.locator(".home-tile").filter({ hasText: "Trash board" })).toHaveCount(0);
  await home.getByRole("button", { name: "Trash", exact: true }).click();
  const trashed = home.locator(".home-tile").filter({ hasText: "Trash board" });
  await expect(trashed).toBeVisible();
  await trashed.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(trashed).toHaveCount(0);

  await home.getByRole("button", { name: "Rooms", exact: true }).click();
  await expect(home.locator(".home-tile").filter({ hasText: "Trash board" })).toBeVisible();
});

test("the home header toggles theme and language in place", async ({ page }) => {
  await freshBoard(page, "home-prefs");
  await goAllRooms(page);

  const home = page.locator(".home");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await home.getByRole("button", { name: /Theme: light/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await home.getByRole("button", { name: /Language: English/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});

test("sorts board tiles and pages them twenty-four at a time", async ({ page }) => {
  const account = await freshBoard(page, "home-pages", { title: "Base board" });
  for (let index = 1; index <= 25; index += 1) {
    const created = await page.request.post(`/api/orgs/${account.orgId}/boards`, {
      data: { title: `Page board ${String(index).padStart(2, "0")}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
  }

  await goAllRooms(page);
  const home = page.locator(".home");
  await expect(home.locator(".home-tile")).toHaveCount(24);
  await expect(home.getByRole("button", { name: "Page 2" })).toBeVisible();

  await home.getByRole("button", { name: "Page 2" }).click();
  await expect(home.locator(".home-tile")).toHaveCount(2);

  await home.getByLabel("Sort by").selectOption("name");
  // Newest-first is the default direction; name descending starts with the last page.
  await expect(home.locator(".home-tile").first()).toContainText("Page board 25");
  await home.getByRole("button", { name: "Descending" }).click();
  await expect(home.locator(".home-tile").first()).toContainText("Base board");
});
