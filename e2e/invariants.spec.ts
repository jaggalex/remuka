import { expect, test, type Page } from "@playwright/test";
import {
  addComment,
  ensureProperties,
  openAccount,
  openAgentMenu,
  openBoard,
  openBoardMenu,
  openComments,
  openFacilitation,
  openPeople,
  register,
  seedConnector,
  seedNote,
  seedObject,
  waitForBoardEditor,
} from "./helpers";
import { surfaceViolations, type Violation } from "./invariants";

/**
 * A "dirty" room: what real rooms hold and mockups do not. Unbroken long names, objects
 * with no name at all, arrows, a long title, a long person name, long comments.
 */
const LONG_WORD = "Ретроспектива_квартального_планирования_команды";
const LONG_PERSON = "Анастасия_Константинопольская_Владиславовна";
const OPEN = '[role="menu"], [role="dialog"], [role="listbox"], .rm-popover, aside.inspector, .comments-panel, .facilitation-panel';

async function dirtyRoom(page: Page, tag: string): Promise<string> {
  const account = await register(page, tag, { user: LONG_PERSON, title: `${LONG_WORD}_2026` });
  const id = account.boardId;
  await seedObject(page, id, { type: "frame", x: -900, y: -600, width: 700, height: 500 });
  await seedObject(page, id, { type: "frame", x: -100, y: -600, width: 700, height: 500, name: `${LONG_WORD}_фрейм` });
  const notes: string[] = [];
  for (let i = 0; i < 12; i++) {
    const content = i % 3 === 0 ? `${LONG_WORD}_${i}` : i % 3 === 1 ? "" : `Заметка ${i}: короткий текст`;
    notes.push(await seedNote(page, id, { x: -900 + (i % 6) * 190, y: 0 + Math.floor(i / 6) * 220 }, undefined, content));
  }
  await seedObject(page, id, { type: "sticky_note", x: 400, y: 0, width: 160, height: 160, name: `${LONG_WORD}_имя` });
  for (let i = 0; i < 4; i++) await seedConnector(page, id, notes[i]!, notes[i + 1]!);
  await openBoard(page, id, { user: LONG_PERSON, template: "empty" });
  await waitForBoardEditor(page);
  return id;
}

async function closeAll(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('[role="menu"], [aria-modal="true"], .rm-popover').count())) break;
    await page.keyboard.press("Escape");
  }
}

for (const width of [1440, 390]) {
  test(`open surfaces keep their layout on a dirty room at ${width}`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    await dirtyRoom(page, `invariants-${width}`);
    await openComments(page);
    await addComment(page, `${LONG_WORD.repeat(2)} — ${"длинный комментарий без конца ".repeat(6)}`);
    await page.setViewportSize({ width, height: 900 });
    // A surface that does not open is reported, not waited for.
    page.setDefaultTimeout(8_000);

    const found: Violation[] = [];
    const unreachable: string[] = [];
    const check = async (surface: string, open: () => Promise<void>, selector = OPEN) => {
      try {
        await open();
        await page.waitForTimeout(350);
        found.push(...(await surfaceViolations(page, surface, selector)));
      } catch (error) {
        unreachable.push(`${surface}: ${String(error).split("\n")[0]}`);
      }
      await closeAll(page);
    };

    await check("comments panel", async () => {}, ".comments-panel");
    await page.keyboard.press("Escape");
    await check("room menu", () => openBoardMenu(page));
    await check("room menu · more", () => openBoardMenu(page, "more"));
    await check("run menu", () => openFacilitation(page));
    for (const tab of ["Timer", "Vote", "Follow", "Show"]) {
      await check(`run panel · ${tab}`, async () => {
        if (!(await page.locator(".facilitation-panel").isVisible())) {
          await openFacilitation(page);
          await page.getByRole("menuitem", { name: /Timer/ }).click();
        }
        await page.locator(".facilitation-panel").getByRole("tab", { name: tab, exact: true }).click();
      }, ".facilitation-panel");
    }
    await page.locator(".facilitation-panel").getByRole("button", { name: /Close/ }).first().click().catch(() => {});
    await check("people menu", () => openPeople(page));
    await check("account menu", () => openAccount(page));
    if (await page.getByRole("button", { name: "Agent", exact: true }).isVisible()) await check("agent menu", () => openAgentMenu(page));
    await check("properties", () => ensureProperties(page), "aside.inspector");
    if (await page.locator("aside.inspector").isVisible()) await page.locator("aside.inspector").getByRole("button", { name: /Close/ }).first().click().catch(() => {});
    await check("command search", async () => {
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Command search" }).getByRole("combobox").fill("e");
    });
    await check("export dialog", async () => {
      // Through the command search: the room menu is laid out differently on a phone.
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Command search" }).getByRole("combobox").fill("export");
      await page.keyboard.press("Enter");
      await page.locator(".export-dialog").waitFor();
    });
    await check("invite dialog", () => page.getByRole("button", { name: "Invite", exact: true }).click());

    await testInfo.attach("violations.json", { body: JSON.stringify({ found, unreachable }, null, 2), contentType: "application/json" });
    expect(unreachable).toEqual([]);
    expect(found).toEqual([]);
  });
}
