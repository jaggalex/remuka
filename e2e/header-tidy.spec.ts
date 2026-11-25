import { expect, test, type Locator } from "@playwright/test";
import {
  agentBoard,
  freshBoard,
  openAccount,
  openBoardMenu,
  openPeople,
  openRun,
} from "./helpers";

/**
 * The tidy header (ADR-266 §2, §4).
 *
 * Eight elements at 1440 px, five at 390 px, and every row of every menu is a command
 * from the registry: the `data-command` attributes are the proof, not a screenshot.
 */
async function interactiveCount(page: import("@playwright/test").Page): Promise<number> {
  return page.locator(".topbar button:visible, .topbar a:visible, .topbar [role=button]:visible").count();
}

async function expectRegistryRows(menu: Locator): Promise<void> {
  const rows = menu.locator('[role="menuitem"], button[data-command]');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const id = await rows.nth(index).getAttribute("data-command");
    expect(id, `row ${index}`).toBeTruthy();
  }
}

test("the room header has at most eight controls and every menu row is a command", async ({
  page,
}) => {
  await freshBoard(page, "header-tidy");
  await page.setViewportSize({ width: 1440, height: 900 });

  // Logo, room menu, people, Run, comments, Invite, account. The agent is absent in a
  // room that has no agents, so a calm room is seven here and eight with the agent.
  expect(await interactiveCount(page)).toBeLessThanOrEqual(8);
  for (const name of [
    "Remuka: account and rooms",
    /^Room menu:/,
    /^People in the room:/,
    "Run",
    /^Comments/,
    "Invite",
    /^Account and interface/,
  ]) {
    await expect(page.locator(".topbar").getByRole("button", { name })).toBeVisible();
  }

  await openBoardMenu(page);
  await expectRegistryRows(page.locator(".rm-menu").last());
  await page.keyboard.press("Escape");

  await openRun(page);
  await expectRegistryRows(page.locator(".rm-menu").last());
  await page.keyboard.press("Escape");

  await openPeople(page);
  await expect(page.locator(".rm-popover").last()).toBeVisible();
  await page.keyboard.press("Escape");

  await openAccount(page);
  const account = page.locator(".rm-popover").last();
  await expectRegistryRows(account);
  // Theme and language are rows here now; the header has no toggles of its own.
  await expect(account.getByRole("button", { name: "Light", exact: true })).toBeVisible();
  await expect(account.getByRole("button", { name: "Russian", exact: true })).toBeVisible();
});

test("at 390 px five controls stay and the rest move into the account menu", async ({ page }) => {
  await freshBoard(page, "header-narrow");
  await page.setViewportSize({ width: 390, height: 844 });

  // Room menu, people, Run as an icon, Invite as an icon, the account face.
  expect(await interactiveCount(page)).toBeLessThanOrEqual(5);
  await expect(page.locator(".topbar-mark")).toBeHidden();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Comments/ })).toBeHidden();
  await expect(page.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);

  await openAccount(page);
  // Comments has no room in the header below 900 px; the same registry row is here.
  await expect(page.locator('[data-command="header.comments"]')).toBeVisible();
});

test("a room with an agent gets the eighth control, and its menu is registry rows", async ({
  page,
}) => {
  await agentBoard(page, "header-agent");
  await page.setViewportSize({ width: 1440, height: 900 });

  expect(await interactiveCount(page)).toBeLessThanOrEqual(8);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expectRegistryRows(page.locator(".rm-menu").last());
  await page.keyboard.press("Escape");

  // Below 900 px the agent control moves into the account menu, still the same command.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);
  await openAccount(page);
  await expect(page.locator('[data-command="header.agent"]')).toBeVisible();
});
