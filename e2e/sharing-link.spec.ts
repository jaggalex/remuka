import { test, expect } from "@playwright/test";
import { enableLink, freshBoard, openAccount, openBoardMenu } from "./helpers";

test("a public link is read-only, hides people and gives no export", async ({ page, browser }) => {
  const account = await freshBoard(page, "link");
  await enableLink(page, account.boardId);

  const visitor = await browser.newContext({ locale: "en-US" });
  const guest = await visitor.newPage();
  await guest.goto(`/?room=${account.boardId}&lang=en`);

  // Read-only is a word in the save line, not a chip of its own (spec §10, Ш4).
  await expect(guest.locator(".rm-readonly")).toContainText(/View only/);
  await openBoardMenu(guest);
  await expect(guest.getByRole("menuitem", { name: /Export/ })).toHaveCount(0);
  await expect(guest.getByRole("menuitem", { name: /Restore/ })).toHaveCount(0);
  await guest.keyboard.press("Escape");
  // The agent needs an account, so the link visitor never sees the control or the row
  // (spec §10, Ш2); the old "More" menu is gone.
  await expect(guest.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);
  await openAccount(guest);
  await expect(guest.getByRole("button", { name: /Ask the agent/ })).toHaveCount(0);
  // A link is not a people directory: no avatars and no names.
  await expect(guest.locator(".peer")).toHaveCount(0);

  const backup = await guest.request.get(`/api/boards/${account.boardId}/backup`);
  expect(backup.status()).toBe(403);

  await visitor.close();
});
