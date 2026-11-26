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
 * Eight groups at 1440 px including the breadcrumb and room title, five controls at 390 px, and every row of every menu is a command
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

test("the room header includes the directory shortcut and every menu row is a command", async ({
  page,
}) => {
  await freshBoard(page, "header-tidy");
  await page.setViewportSize({ width: 1440, height: 900 });

  // This room has no agent. The logo and the team breadcrumb are separate destinations.
  await expect(page.locator(".topbar-path a")).toBeVisible();
  expect(await interactiveCount(page)).toBeLessThanOrEqual(8);
  await expect(page.locator(".topbar-mark")).toHaveAccessibleName("All rooms");
  for (const name of [
    /^Room menu:/,
    /^People in the room:/,
    "Run",
    "Invite",
    /^Account and interface/,
  ]) {
    await expect(page.locator(".topbar").getByRole("button", { name })).toBeVisible();
  }

  const inviteUses: unknown[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/chrome/used") {
      const payload = request.postDataJSON();
      if (payload.control === "invite.open") inviteUses.push(payload);
    }
  });
  await page.locator(".topbar").getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Invite to the room" })).toBeVisible();
  await expect.poll(() => inviteUses).toEqual([{ control: "invite.open" }]);
  await page.keyboard.press("Escape");

  await openBoardMenu(page);
  const roomMenu = page.getByRole("menu", { name: "Room menu", exact: true });
  const copyLink = roomMenu.locator('[data-command="room.copyLink"]');
  await expect(roomMenu).toHaveCSS("width", "318px");
  await expect(copyLink).toHaveCSS("min-height", "40px");
  await expect(copyLink).toHaveCSS("font-size", "15px");
  const more = roomMenu.locator('[data-command="room.more"]');
  await expect(roomMenu.getByRole("menuitemcheckbox", { name: "Comments" })).toHaveCount(0);
  await more.focus();
  await more.press("Enter");
  await expect(page.getByRole("menuitemcheckbox", { name: "Comments" })).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
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
  await expect(account.getByRole("radio", { name: "Light", exact: true })).toBeVisible();
  await expect(account.getByRole("radio", { name: "Russian", exact: true })).toBeVisible();
  expect(inviteUses).toHaveLength(1);
});

test("at 390 px five controls stay and discussion stays in the room menu", async ({ page }) => {
  await freshBoard(page, "header-narrow");
  await page.setViewportSize({ width: 390, height: 844 });

  // Room menu, people, Run as an icon, Invite as an icon, the account face.
  expect(await interactiveCount(page)).toBeLessThanOrEqual(5);
  await expect(page.locator(".topbar-mark")).toBeHidden();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Comments/ })).toBeHidden();
  await expect(page.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);

  await openBoardMenu(page, "more");
  const comments = page.getByRole("menuitemcheckbox", { name: "Comments" });
  await comments.focus();
  await comments.press("Enter");
  await expect(page.locator(".comments-panel")).toBeVisible();
  await openBoardMenu(page, "more");
  await expect(comments).toHaveAttribute("aria-checked", "true");
  await expect(comments.locator(".rm-menu-icon")).toBeVisible();
  // In a short viewport the last command stays reachable within the menu.
  await page.setViewportSize({ width: 390, height: 350 });
  const roomMenu = page.getByRole("menu").filter({ has: comments });
  await expect(roomMenu).toBeInViewport({ ratio: 1 });
  const last = roomMenu.locator("button[data-command]").last();
  await last.focus();
  await expect(last).toBeInViewport({ ratio: 1 });
});

test("a room with an agent gets the eighth control, and its menu is registry rows", async ({
  page,
}) => {
  await agentBoard(page, "header-agent");
  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(page.locator(".topbar-path a")).toBeVisible();
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

test("logo, team breadcrumb and G R return to the right room directory", async ({ page }) => {
  const { orgId, boardId } = await freshBoard(page, "home-shortcut");
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.request.get("/api/boards/" + boardId + "/access");
  const { board } = await response.json();
  expect(board.team?.id).toBeTruthy();
  const teamLink = page.locator(".topbar-path a");
  await expect(teamLink).toHaveText(board.team.name);

  const another = await page.request.post("/api/orgs/" + orgId + "/teams", { data: { name: "Another team" } });
  expect(another.ok(), await another.text()).toBeTruthy();
  const secondTeam = (await another.json()).team.id;
  const second = await page.request.post("/api/orgs/" + orgId + "/boards", {
    data: { title: "Another team room", teamId: secondTeam },
  });
  expect(second.ok(), await second.text()).toBeTruthy();
  await teamLink.click();
  const filtered = new URL(page.url());
  expect(filtered.searchParams.get("team")).toBe(board.team.id);
  const data = await (await page.request.get("/api/boards" + filtered.search)).json();
  expect(data.boards.map((room: { id: string }) => room.id)).toEqual([boardId]);
  await expect(page.getByText("Another team room", { exact: true })).toHaveCount(0);

  for (const action of ["logo", "keyboard"]) {
    await page.goto("/?room=" + boardId + "&lang=en");
    const mark = page.locator(".topbar-mark");
    await expect(mark).toHaveAttribute("href", /[?]org=/);
    if (action === "logo") await mark.click();
    else {
      await page.keyboard.press("g");
      await page.keyboard.press("r");
    }
    await expect(page).toHaveURL(url => url.searchParams.has("org") && !url.searchParams.has("team") && !url.searchParams.has("room"));
    await expect(page.getByText("Another team room", { exact: true }).first()).toBeVisible();
  }
});
