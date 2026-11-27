import { expect, test, type Locator, type Page } from "@playwright/test";
import { agentBoard, freshBoard, objectCount, openBoardMenu } from "./helpers";

/**
 * The command search (ADR-266 §1.2, T7).
 *
 * The acceptance path is a person's: ⌘K, a word, Enter. Beyond it the scenario pins the
 * three things that make a search safe — it does not steal ⌘K from a field or the text
 * editor, Escape returns focus where it was, and a refused command says why and does
 * nothing. The agent line opens a task and runs nothing (ADR-265: the agent proposes).
 */

function dialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Command search" });
}

function field(page: Page): Locator {
  return dialog(page).getByRole("combobox");
}

test("⌘K, a word and Enter open the export", async ({ page }) => {
  await freshBoard(page, "command-search-export");

  await page.keyboard.press("Meta+k");
  await expect(dialog(page)).toBeVisible();
  await expect(field(page)).toBeFocused();

  await field(page).fill("export");
  await expect(dialog(page).getByRole("option").first()).toContainText("Export…");

  await page.keyboard.press("Enter");
  await expect(page.locator(".export-dialog")).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test("⌘K from a field or the text editor does not open the search", async ({ page }) => {
  await freshBoard(page, "command-search-field");

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const title = page.locator("input.board-title");
  await expect(title).toBeFocused();
  await page.keyboard.press("Meta+k");
  await expect(dialog(page)).toHaveCount(0);
  await expect(title).toBeFocused();
  await page.keyboard.press("Escape");

  // The canvas editor owns ⌘K itself: there it is the link window (text-format-bar).
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await expect(page.locator(".inline-editor")).toBeFocused();
  await page.keyboard.press("Meta+k");
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("Escape closes the search and gives focus back to the bottom panel", async ({ page }) => {
  await freshBoard(page, "command-search-focus");

  const trigger = page.locator(".canvas-search");
  await trigger.click();
  await expect(dialog(page)).toBeVisible();
  await expect(field(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // From the account menu the row is gone when the menu closes: focus must go to the
  // account button that is still there, not to the removed row or the page body.
  await page.getByRole("button", { name: /^Account and interface/ }).click();
  await page.locator('[data-command="search.open"]').click();
  await expect(dialog(page)).toBeVisible();
  await expect(field(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Account and interface/ })).toBeFocused();
});

test("a returning browser shows a scrollable palette and Enter on Esc never runs a command", async ({page}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await freshBoard(page, "command-search-recent");
  await page.evaluate(() => localStorage.setItem("remo.commands.recent",
    JSON.stringify(["run.timer", "run.vote", "run.presentation", "run.follow", "room.export"])));
  for (const width of [390, 1440]) {
    await page.setViewportSize({width, height: 900});
    await page.keyboard.press("Control+k");
    const search = dialog(page);
    const rows = search.getByRole("option");
    await expect(rows).toHaveCount(8);
    await expect(rows.locator("strong")).toHaveText([
      "Timer", "Voting", "Start presentation", "Follow along", "Export…", "Like", "Love", "Fire",
    ]);
    const box = (await search.boundingBox())!;
    expect(Math.abs(box.width - (width === 390 ? 316 : 562))).toBeLessThanOrEqual(2);
    expect(Math.abs(box.height - 411)).toBeLessThanOrEqual(2);
    expect((await rows.first().boundingBox())!.height).toBe(54);
    const close = search.getByRole("button", {name: "Close the search"});
    await expect(page.locator(".rm-command-scrim")).toHaveCSS("background-color", "rgba(30, 33, 54, 0.28)");
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveCSS("outline-style", "solid");
    await expect(field(page)).toHaveCSS("outline-width", "2px");
    await expect(search.locator(".command-search-field")).toHaveCSS("border-bottom-color", "rgb(230, 220, 196)");
    await expect(close).toHaveCSS("height", "21px");
    expect(await close.evaluate(button => {
      const { left, top, width } = button.getBoundingClientRect();
      return document.elementFromPoint(left + width / 2, top - 2) === button;
    })).toBe(true);
    await field(page).press("End");
    await expect(rows.last()).toHaveAttribute("aria-selected", "true");
    await expect(rows.last()).toBeInViewport();
    await field(page).fill("export");
    await field(page).press("Tab");
    await expect(close).toBeFocused();
    await close.press("Enter");
    await expect(search).toHaveCount(0);
    await expect(page.locator(".export-dialog")).toHaveCount(0);
  }
});

test("an unavailable command is shown with its reason and does not run", async ({ page }) => {
  await freshBoard(page, "command-search-unavailable");
  const before = await objectCount(page);

  await page.keyboard.press("Meta+k");
  await field(page).fill("delete");

  // The selection command comes first; with nothing selected it is greyed and says why.
  const refused = dialog(page).locator('.command-search-row[aria-disabled="true"]').first();
  await expect(refused).toContainText("Delete");
  await expect(refused).toContainText("Select an object first");

  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
  expect(await objectCount(page)).toBe(before);
});

test("the agent line opens a task with the words and runs nothing", async ({ page }) => {
  await agentBoard(page, "command-search-agent");
  const before = await objectCount(page);

  await page.keyboard.press("Meta+k");
  await field(page).fill("plan a sprint");
  const agentLine = dialog(page).getByRole("option").last();
  await expect(agentLine).toContainText("Ask the agent: plan a sprint");

  await agentLine.click();
  const agent = page.getByRole("dialog", { name: "New task" });
  await expect(agent).toBeVisible();
  await expect(agent.getByLabel("What should it create?")).toHaveValue("plan a sprint");
  expect(await objectCount(page)).toBe(before);
});
