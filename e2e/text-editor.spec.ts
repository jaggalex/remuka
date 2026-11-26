import { expect, test, type Page } from "@playwright/test";
import { freshBoard, openBoardMenu } from "./helpers";

/**
 * The editor as a set of lines (ADR-252 §5.1–5.3, stage 4).
 *
 * A line is a `div` with its block format in `data-*`; typing, Enter, Tab, the block
 * shortcuts and the Markdown input rules all end in the same document the painter reads.
 * The assertions look at the document's blocks, not at the editor's markup alone, so a
 * pretty DOM that stores nothing fails here.
 */

interface NoteView {
  text: string;
  lines: Array<{
    block: string | null;
    indent: number;
    checked: boolean;
    ordinal: number | null;
    text: string;
  }>;
}

async function noteView(page: Page): Promise<NoteView> {
  return page.evaluate(() => {
    const probe = window as unknown as {
      __remo: {
        widgets: Array<{
          type: string;
          text: string;
          lines: Array<{
            block?: string;
            indent: number;
            checked: boolean;
            ordinal?: number;
            runs: Array<{ text: string }>;
          }> | null;
        }>;
      };
    };
    const note = probe.__remo.widgets.find((widget) => widget.type === "sticky_note");
    return {
      text: note?.text ?? "",
      lines: (note?.lines ?? []).map((line) => ({
        block: line.block ?? null,
        indent: line.indent,
        checked: line.checked,
        ordinal: line.ordinal ?? null,
        text: line.runs.map((run) => run.text).join(""),
      })),
    };
  });
}

/** The text without the terminating `\n` a formatted last line carries. */
const body = (view: NoteView): string => view.text.replace(/\n+$/, "");

async function openSticky(page: Page, tag: string): Promise<Page["locator"]> {
  await freshBoard(page, tag, { template: "empty" });
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  return editor;
}

test("typing without a format stores no line data", async ({ page }) => {
  const editor = await openSticky(page, "text-editor-plain");
  await page.keyboard.type("просто текст");

  await expect(editor).toContainText("просто текст");
  // The lazy promise of §2.7: a note that never met a block keeps the plain path.
  await expect.poll(() => noteView(page)).toMatchObject({ text: "просто текст", lines: [] });
});

test("Enter and Tab build a nested list, and the document has the same levels", async ({
  page,
}) => {
  const editor = await openSticky(page, "text-editor-list");

  // `- ` at the start of the line is a bullet; Enter continues it; Tab nests it.
  await page.keyboard.type("- пункт");
  await page.keyboard.press("Enter");
  await page.keyboard.type("пункт 2");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.type("вложенный");

  await expect(editor.locator(":scope > div")).toHaveCount(3);
  await expect(editor.locator(':scope > div[data-block="bullet"]')).toHaveCount(3);
  await expect(editor.locator(':scope > div[data-indent="1"]')).toHaveCount(2);

  await expect.poll(() => noteView(page)).toMatchObject({
    lines: [
      { block: "bullet", indent: 0, text: "пункт" },
      { block: "bullet", indent: 1, text: "пункт 2" },
      { block: "bullet", indent: 1, text: "вложенный" },
    ],
  });
  expect(body(await noteView(page))).toBe("пункт\nпункт 2\nвложенный");
});

test("a heading from `# ` ends at Enter, Tab starts a list and ⌘⌥2 toggles a heading", async ({
  page,
}) => {
  const editor = await openSticky(page, "text-editor-heading");

  await page.keyboard.type("# Заголовок");
  await page.keyboard.press("Enter");
  await page.keyboard.type("обычная строка");

  await expect(editor.locator(':scope > div[data-block="h1"]')).toHaveText("Заголовок");
  await expect(editor.locator(":scope > div:not([data-block])")).toHaveText("обычная строка");
  await expect.poll(() => noteView(page)).toMatchObject({
    lines: [
      { block: "h1", text: "Заголовок" },
      { block: null, text: "обычная строка" },
    ],
  });

  // Tab is the way from an ordinary line into a list without typing a marker.
  await page.keyboard.press("Tab");
  await expect(editor.locator(':scope > div[data-block="bullet"]')).toHaveText(
    "обычная строка",
  );
  await expect.poll(() => noteView(page)).toMatchObject({
    lines: [{ block: "h1" }, { block: "bullet" }],
  });

  // The second line gets a heading from the keyboard, and the same keys remove it.
  await page.keyboard.press("Meta+Alt+2");
  await expect(editor.locator(':scope > div[data-block="h2"]')).toHaveText("обычная строка");
  await expect.poll(() => noteView(page)).toMatchObject({
    lines: [{ block: "h1" }, { block: "h2" }],
  });
  await page.keyboard.press("Meta+Alt+2");
  await expect.poll(() => noteView(page)).toMatchObject({
    lines: [{ block: "h1" }, { block: null }],
  });
});

test("⌘⇧7 numbers the line and is exactly one undo step", async ({ page }) => {
  const editor = await openSticky(page, "text-editor-ordered");
  await page.keyboard.type("строка");
  // Let the typing undo step close, so undo can only take the format step.
  await page.waitForTimeout(500);

  await page.keyboard.press("Meta+Shift+7");
  await expect(editor.locator(':scope > div[data-block="ordered"]')).toHaveCount(1);
  await expect.poll(() => noteView(page)).toMatchObject({
    lines: [{ block: "ordered", ordinal: 1, text: "строка" }],
  });

  // The repeat takes the format away.
  await page.keyboard.press("Meta+Shift+7");
  await expect.poll(() => noteView(page)).toMatchObject({ text: "строка", lines: [] });

  // Set it again, leave the editor, and undo once: the text stays, the format goes.
  await page.keyboard.press("Meta+Shift+7");
  await expect.poll(() => noteView(page)).toMatchObject({ lines: [{ block: "ordered" }] });
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => noteView(page)).toMatchObject({ text: "строка", lines: [] });
});

test("⌘⇧9 and `[ ] ` make a checklist", async ({ page }) => {
  const editor = await openSticky(page, "text-editor-check");

  await page.keyboard.type("[ ] молоко");
  await expect(editor.locator(':scope > div[data-block="check"]')).toHaveText("молоко");
  await page.keyboard.press("Enter");
  await page.keyboard.type("хлеб");
  // Enter in an empty check item leaves the list; the shortcut makes the next one.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+Shift+9");
  await page.keyboard.type("сок");

  await expect.poll(() => noteView(page)).toMatchObject({
    lines: [
      { block: "check", indent: 0, checked: false, text: "молоко" },
      { block: "check", indent: 0, checked: false, text: "хлеб" },
      { block: "check", indent: 0, checked: false, text: "сок" },
    ],
  });
});

test("Backspace at the start unwraps a list: level first, then the format", async ({ page }) => {
  const editor = await openSticky(page, "text-editor-unwrap");
  await page.keyboard.type("- пункт");
  await page.keyboard.press("Tab");
  await expect.poll(() => noteView(page)).toMatchObject({ lines: [{ indent: 1 }] });

  await page.keyboard.press("Meta+ArrowLeft");
  await page.keyboard.press("Backspace");
  await expect.poll(() => noteView(page)).toMatchObject({
    lines: [{ block: "bullet", indent: 0, text: "пункт" }],
  });

  await page.keyboard.press("Backspace");
  await expect.poll(() => noteView(page)).toMatchObject({ text: "пункт", lines: [] });
  // The text never left: only the format did.
  await expect(editor).toContainText("пункт");
});

test("Backspace right after a rule gives the marker back as text", async ({ page }) => {
  const editor = await openSticky(page, "text-editor-rule-undo");
  await page.keyboard.type("- ");
  await expect(editor.locator(':scope > div[data-block="bullet"]')).toHaveCount(1);

  await page.keyboard.press("Backspace");
  await expect.poll(() => noteView(page)).toMatchObject({ text: "- ", lines: [] });
  await expect(editor).toContainText("- ");
});

test("the settings switch turns the Markdown rules off", async ({ page }) => {
  await freshBoard(page, "text-editor-markdown-off", { template: "empty" });

  await openBoardMenu(page, "more");
  await page.getByRole("menuitem", { name: "Room settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Room settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Markdown rules while typing" }).uncheck();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await page.keyboard.type("- текст");

  // With the rule off the dash is a dash: no list, no marker column.
  await expect.poll(() => noteView(page)).toMatchObject({ text: "- текст", lines: [] });
  await expect(editor.locator(":scope > div[data-block]")).toHaveCount(0);
});
