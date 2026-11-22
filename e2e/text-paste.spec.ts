import { expect, test, type Page } from "@playwright/test";
import { freshBoard } from "./helpers";

/**
 * Paste and copy (ADR-252 §3, §4, §5.4–5.5, stage 6).
 *
 * The clipboard is driven from the page: a `ClipboardEvent` carries the same
 * `text/html` and `text/plain` a real copy would, so the scenario checks the product's
 * white list rather than the browser's own paste.
 */

interface LineView {
  block: string | null;
  indent: number;
  checked: boolean;
  text: string;
  runs: Array<{ text: string; bold?: boolean; code?: boolean; href?: string }>;
}

interface NoteView {
  id: string;
  text: string;
  runs: Array<{ text: string; bold?: boolean; code?: boolean; href?: string }> | null;
  lines: LineView[];
}

async function openNote(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await expect(page.locator(".inline-editor")).toBeVisible();
}

async function paste(page: Page, payload: { html?: string; text?: string }): Promise<void> {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    if (data.html) transfer.setData("text/html", data.html);
    if (data.text) transfer.setData("text/plain", data.text);
    const editor = document.querySelector(".inline-editor");
    editor?.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, payload);
}

/** The payload our `onCopy` writes, captured the same way the browser would get it. */
async function copySelection(page: Page): Promise<{ html: string; text: string }> {
  return page.evaluate(() => {
    const transfer = new DataTransfer();
    document.querySelector(".inline-editor")?.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      html: transfer.getData("text/html"),
      text: transfer.getData("text/plain"),
    };
  });
}

/** ⌘⇧V without the browser's own paste: the keydown is all the editor needs to see. */
async function plainPasteKey(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector(".inline-editor")?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "V",
        code: "KeyV",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

const notes = (page: Page): Promise<NoteView[]> =>
  page.evaluate(() => {
    const probe = window as unknown as {
      __remo: {
        widgets: Array<{
          id: string;
          type: string;
          text: string;
          runs: Array<{ text: string; bold?: boolean; code?: boolean; href?: string }> | null;
          lines: Array<{
            block?: string;
            indent: number;
            checked: boolean;
            runs: Array<{ text: string; bold?: boolean; code?: boolean; href?: string }>;
          }> | null;
        }>;
      };
    };
    return probe.__remo.widgets
      .filter((widget) => widget.type === "sticky_note")
      .map((widget) => ({
        id: widget.id,
        text: widget.text,
        runs: widget.runs ?? null,
        lines: (widget.lines ?? []).map((line) => ({
          block: line.block ?? null,
          indent: line.indent,
          checked: line.checked,
          text: line.runs.map((run) => run.text).join(""),
          runs: line.runs,
        })),
      }));
  });

/** Client point at the centre of a widget, through the camera like the painter. */
async function pointOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((widgetId) => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        widgets: Array<{ id: string; x: number; y: number }>;
      };
    }).__remo;
    const widget = probe.widgets.find((entry) => entry.id === widgetId)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (widget.x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (widget.y - probe.camera.y) * probe.camera.zoom,
    };
  }, id);
}

const selectedIds = (page: Page): Promise<string[]> =>
  page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );

const noteText = async (page: Page): Promise<string> =>
  (await notes(page)).map((note) => note.text).join("\n---\n");

test("a pasted list keeps its lines, its block format and a real bold span", async ({ page }) => {
  await freshBoard(page, "text-paste-html", { template: "empty" });
  await openNote(page);

  await paste(page, {
    html: '<ul><li><span style="font-weight:700">one</span></li><li>two</li><li>three</li></ul>',
    text: "one\ntwo\nthree",
  });

  await expect.poll(async () => (await notes(page))[0]?.lines.map((line) => line.text)).toEqual([
    "one",
    "two",
    "three",
  ]);
  const [note] = await notes(page);
  expect(note!.lines.map((line) => line.block)).toEqual(["bullet", "bullet", "bullet"]);
  // A CSS weight of 600 or more is a real mark now (§3); the `<li>` is the line.
  expect(note!.lines[0]!.runs).toEqual([{ text: "one", bold: true }]);
  await expect(page.locator(".inline-editor b")).toHaveText("one");
});

test("Google Docs' wrapper is not bold, the 700 span inside it is", async ({ page }) => {
  await freshBoard(page, "text-paste-docs", { template: "empty" });
  await openNote(page);

  await paste(page, {
    html: `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-size:11pt;font-weight:400">Hello</span> <span style="font-weight:700">world</span></p></b>`,
    text: "Hello world",
  });

  await expect.poll(() => noteText(page)).toBe("Hello world");
  const [note] = await notes(page);
  // No block format, so the note keeps its plain painter and only `runs` is materialized.
  expect(note!.lines).toHaveLength(0);
  expect(note!.runs).toEqual([{ text: "Hello " }, { text: "world", bold: true }]);
  await expect(page.locator(".inline-editor b")).toHaveText("world");
});

test("plain Markdown from a chat becomes marks", async ({ page }) => {
  await freshBoard(page, "text-paste-markdown", { template: "empty" });
  await openNote(page);

  await paste(page, { text: "**bold** and ~~gone~~ and `code`" });

  await expect.poll(() => noteText(page)).toBe("bold and gone and code");
  await expect(page.locator(".inline-editor b")).toHaveText("bold");
  await expect(page.locator(".inline-editor s")).toHaveText("gone");
  await expect(page.locator(".inline-editor code")).toHaveText("code");
});

test("a Markdown list from a chat becomes a real checklist", async ({ page }) => {
  await freshBoard(page, "text-paste-markdown-list", { template: "empty" });
  await openNote(page);

  await paste(page, { text: "# Release\n\n- [x] tag\n- [ ] notes" });

  await expect.poll(async () => (await notes(page))[0]?.lines.length).toBe(4);
  const [note] = await notes(page);
  // The blank line in the Markdown is a line: the model keeps what the person pasted.
  expect(note!.lines.map((line) => [line.block, line.checked, line.text])).toEqual([
    ["h1", false, "Release"],
    [null, false, ""],
    ["check", true, "tag"],
    ["check", false, "notes"],
  ]);
});

test("⌘⇧V pastes the text as it is, Markdown included", async ({ page }) => {
  await freshBoard(page, "text-paste-plain", { template: "empty" });
  await openNote(page);

  await plainPasteKey(page);
  await paste(page, { html: "<b>bold</b>", text: "**bold**" });

  await expect.poll(() => noteText(page)).toBe("**bold**");
  await expect(page.locator(".inline-editor b")).toHaveCount(0);
});

test("copying formatted text and pasting it into another note keeps the lines", async ({ page }) => {
  await freshBoard(page, "text-copy-format", { template: "empty" });
  await openNote(page);
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+Shift+8");
  await expect(page.locator(".inline-editor [data-block=bullet]")).toHaveCount(2);

  const payload = await copySelection(page);
  // HTML for another application, Markdown for a chat (§5.5).
  expect(payload.html).toBe("<ul><li>one</li><li>two</li></ul>");
  expect(payload.text).toBe("- one\n- two");

  await page.keyboard.press("Escape");
  await openNote(page);
  await paste(page, payload);

  await expect.poll(async () => (await notes(page)).length).toBe(2);
  await expect
    .poll(async () => (await notes(page))[1]?.lines.map((line) => [line.block, line.text]))
    .toEqual([
      ["bullet", "one"],
      ["bullet", "two"],
    ]);
});

test("a remo fragment pasted into an open note becomes objects, not text", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await freshBoard(page, "text-paste-fragment", { template: "empty" });

  await openNote(page);
  await page.locator(".inline-editor").fill("alpha");
  await page.keyboard.press("Escape");
  const [alpha] = await selectedIds(page);
  const point = await pointOf(page, alpha!);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Meta+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("remo/fragment");

  // A second note with its own text stays as it is; the objects land beside it.
  await openNote(page);
  await page.locator(".inline-editor").fill("beta");
  await page.keyboard.press("Meta+v");

  await expect.poll(async () => (await notes(page)).length).toBe(3);
  const all = await notes(page);
  expect(all.some((note) => note.text.includes("remo/fragment"))).toBe(false);
  expect(all.filter((note) => note.text === "beta")).toHaveLength(1);
  expect(all.filter((note) => note.text === "alpha")).toHaveLength(2);
});

test("⌘⇧X strikes the selection and keeps the text", async ({ page }) => {
  await freshBoard(page, "text-strike", { template: "empty" });
  await openNote(page);
  await page.locator(".inline-editor").fill("note");
  await page.keyboard.press("Meta+a");

  await page.keyboard.press("Meta+Shift+X");

  await expect(page.locator(".inline-editor s, .inline-editor strike")).toHaveText("note");
  await expect.poll(() => noteText(page)).toBe("note");
});

test("⌘\\ clears the marks of the selection and keeps the text", async ({ page }) => {
  await freshBoard(page, "text-clear-format", { template: "empty" });
  await openNote(page);
  await page.locator(".inline-editor").fill("note");
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+b");
  await expect(page.locator(".inline-editor b")).toHaveCount(1);

  await page.keyboard.press("Meta+Backslash");

  await expect(page.locator(".inline-editor b")).toHaveCount(0);
  await expect.poll(() => noteText(page)).toBe("note");
});
