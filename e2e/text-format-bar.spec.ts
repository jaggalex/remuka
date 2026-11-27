import { expect, test, type Page } from "@playwright/test";
import { freshBoard } from "./helpers";

/**
 * The format bar and the canvas half of text v2 (ADR-252 §6, §8, §9).
 *
 * Outside the editor a format is a property of the whole object; inside it is a property
 * of the lines under the selection. Both end in the same document, so the assertions read
 * `widget.lines`, not the bar's or the editor's markup.
 */

interface LineView {
  block: string | null;
  indent: number;
  checked: boolean;
  ordinal: number | null;
  text: string;
  runs: Array<{ text: string; code?: boolean; href?: string }>;
}

interface NoteView {
  id: string;
  text: string;
  runs: Array<{ text: string; code?: boolean; href?: string }> | null;
  lines: LineView[];
}

async function notes(page: Page): Promise<NoteView[]> {
  return page.evaluate(() => {
    const probe = window as unknown as {
      __remo: {
        widgets: Array<{
          id: string;
          type: string;
          text: string;
          runs: Array<{ text: string; code?: boolean; href?: string }> | null;
          lines: Array<{
            block?: string;
            indent: number;
            checked: boolean;
            ordinal?: number;
            runs: Array<{ text: string; code?: boolean; href?: string }>;
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
          ordinal: line.ordinal ?? null,
          text: line.runs.map((run) => run.text).join(""),
          runs: line.runs,
        })),
      }));
  });
}

async function selected(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
}

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

/** A note with two lines, created by hand so the content is what the test says. */
async function twoLineNote(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeFocused();
  await page.keyboard.type("первая");
  await page.keyboard.press("Enter");
  await page.keyboard.type("вторая");
  return page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
  );
}

test("the bar formats the caret's line while editing and shows what is pressed", async ({
  page,
}) => {
  await freshBoard(page, "text-format-bar-editor", { template: "empty" });
  await twoLineNote(page);

  const bar = page.getByRole("toolbar", { name: "Object properties" });
  const bullet = bar.getByRole("button", { name: /^Bulleted list/ });

  // The caret is on the second line: only that line becomes a list.
  await bullet.click();
  await expect(bullet).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => notes(page)).toMatchObject([
    {
      lines: [
        { block: null, text: "первая" },
        { block: "bullet", text: "вторая" },
      ],
    },
  ]);

  // T8: the bar keeps six controls; the heading lives behind «⋯», in the panel.
  await bar.getByRole("button", { name: "More actions" }).click();
  await page.locator("aside.inspector details.properties-more > summary").click();
  const heading = page
    .locator("aside.inspector")
    .getByRole("button", { name: /^Heading 2/ });
  await heading.click();
  await expect(heading).toHaveAttribute("aria-pressed", "true");
  await expect(bullet).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => notes(page)).toMatchObject([
    { lines: [{ block: null }, { block: "h2", text: "вторая" }] },
  ]);

  // The editor announces the block: a heading is a heading, and the caret's line is
  // the current one (ADR-252 §9).
  const line = page.locator('.inline-editor > div[data-block="h2"]');
  await expect(line).toHaveAttribute("role", "heading");
  await expect(line).toHaveAttribute("aria-level", "2");
  await expect(line).toHaveAttribute("aria-current", "true");
});

test("⌘K validates and applies a link, ⌘E toggles inline code", async ({ page }) => {
  await freshBoard(page, "text-format-bar-link", { template: "empty" });
  const editor = page.locator(".inline-editor");

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await page.locator(".inline-editor").fill("ссылка");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+k");

  const dialog = page.getByRole("dialog", { name: "Link" });
  await expect(dialog).toBeVisible();

  // Escape closes the field and gives the caret back, so typing continues (§9).
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog).toBeVisible();

  const address = dialog.getByLabel("Address");
  await address.fill("javascript:alert(1)");
  await expect(dialog).toContainText("Only http, https and mailto addresses");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();

  // A bare domain is the common case: https is added, Enter applies.
  await address.fill("example.com");
  await address.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(editor.locator('a[href="https://example.com/"]')).toHaveText("ссылка");
  await expect.poll(() => notes(page)).toMatchObject([
    { runs: [{ text: "ссылка", href: "https://example.com/" }] },
  ]);

  // On the link the same keys offer removal, and the text stays.
  await editor.locator("a").click();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Remove link" }).click();
  await expect(editor.locator("a")).toHaveCount(0);
  await expect(editor).toHaveText("ссылка");

  // ⌘E is inline code, and it toggles back.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+e");
  await expect(editor.locator("code")).toHaveText("ссылка");
  await expect.poll(() => notes(page)).toMatchObject([
    { runs: [{ text: "ссылка", code: true }] },
  ]);
  await page.keyboard.press("ControlOrMeta+e");
  await expect(editor.locator("code")).toHaveCount(0);
});

test("a link opens on Enter only with ⌘, so typing is not interrupted", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    const open = window.open.bind(window);
    window.open = (...args: Parameters<typeof window.open>) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(args[0] ?? ""));
      return open(...args);
    };
  });
  await freshBoard(page, "text-format-bar-enter", { template: "empty" });
  const editor = page.locator(".inline-editor");

  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  await editor.fill("ссылка");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Link" });
  await dialog.getByLabel("Address").fill("https://example.com/");
  await dialog.getByLabel("Address").press("Enter");
  await expect(dialog).toHaveCount(0);

  // A plain Enter is a new line, not a navigation. The caret is put at the end of the
  // line, so the split is not in the middle of the word.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened),
  ).toEqual([]);
  await expect.poll(() => notes(page)).toMatchObject([{ text: "ссылка\n" }]);

  // ⌘Enter on the link is the one way to open it from the editor.
  await editor.locator("a").click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
    .toEqual(["https://example.com/"]);

});

test("⌘Ctrl+click opens a painted link, a plain click selects the object", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    const open = window.open.bind(window);
    window.open = (...args: Parameters<typeof window.open>) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(args[0] ?? ""));
      return open(...args);
    };
  });
  await freshBoard(page, "text-format-bar-canvas-link", { template: "empty" });
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  const editor = page.locator(".inline-editor");
  await editor.fill("ссылка");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Link" });
  await dialog.getByLabel("Address").fill("https://example.com/");
  await dialog.getByLabel("Address").press("Enter");
  await expect(dialog).toHaveCount(0);

  // Hit-testing a link is part of the block layout; a bullet gives the line that layout.
  await page
    .getByRole("toolbar", { name: "Object properties" })
    .getByRole("button", { name: /^Bulleted list/ })
    .click();
  await expect.poll(() => notes(page)).toMatchObject([{ lines: [{ block: "bullet" }] }]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);
  const id = (await notes(page))[0]!.id;

  const link = await page.evaluate((widgetId) => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        widgets: Array<{ id: string; x: number; y: number; width: number; height: number }>;
        probe(x: number, y: number): { text: { kind?: string; href?: string } | null };
      };
    }).__remo;
    const widget = probe.widgets.find((entry) => entry.id === widgetId)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    const zoom = probe.camera.zoom;
    const left = rect.left + rect.width / 2 + (widget.x - probe.camera.x) * zoom - (widget.width * zoom) / 2;
    const top = rect.top + rect.height / 2 + (widget.y - probe.camera.y) * zoom - (widget.height * zoom) / 2;
    for (let y = top + 4; y < top + widget.height * zoom - 4; y += 5) {
      for (let x = left + 4; x < left + widget.width * zoom - 4; x += 5) {
        const hit = probe.probe(x, y);
        if (hit.text?.kind === "link") return { x, y, href: hit.text.href };
      }
    }
    return null;
  }, id);
  expect(link, "the painted link is hit-testable").not.toBeNull();

  await page.keyboard.down("Control");
  await page.mouse.click(link!.x, link!.y);
  await page.keyboard.up("Control");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened))
    .toEqual([link!.href]);
});

test("formats apply to every line of the selection and undoing takes one step", async ({
  page,
}) => {
  await freshBoard(page, "text-format-bar-canvas", { template: "empty" });
  const id = await twoLineNote(page);
  await page.keyboard.press("Escape");
  const point = await pointOf(page, id);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selected(page)).toEqual([id]);

  // ⌘⇧8 is the bulleted list for the whole object, not the line the caret last was on.
  await page.keyboard.press("ControlOrMeta+Shift+8");
  await expect.poll(() => notes(page)).toMatchObject([
    { lines: [{ block: "bullet" }, { block: "bullet" }] },
  ]);

  // The same keys again remove it; a note with no formats stores no `lines` at all.
  await page.keyboard.press("ControlOrMeta+Shift+8");
  await expect.poll(() => notes(page)).toMatchObject([
    { text: "первая\nвторая", lines: [] },
  ]);
  await page.keyboard.press("ControlOrMeta+Alt+1");
  await expect.poll(() => notes(page)).toMatchObject([
    { lines: [{ block: "h1" }, { block: "h1" }] },
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => notes(page)).toMatchObject([{ text: "первая\nвторая", lines: [] }]);
});

test("the checklist marker is a control, and the selection survives the click", async ({
  page,
}) => {
  await freshBoard(page, "text-format-bar-check", { template: "empty" });
  const id = await twoLineNote(page);
  await page.keyboard.press("Escape");
  const point = await pointOf(page, id);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("ControlOrMeta+Shift+9");
  await expect.poll(() => notes(page)).toMatchObject([
    { lines: [{ block: "check", checked: false }, { block: "check" }] },
  ]);

  // Find the painted square of the first line through the probe, then click it.
  const box = await page.evaluate((widgetId) => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        widgets: Array<{ id: string; x: number; y: number; width: number; height: number }>;
        probe(x: number, y: number): { text: { kind?: string; line?: number } | null };
      };
    }).__remo;
    const widget = probe.widgets.find((entry) => entry.id === widgetId)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    const left =
      rect.left + rect.width / 2 + (widget.x - probe.camera.x) * probe.camera.zoom - (widget.width * probe.camera.zoom) / 2;
    const top =
      rect.top + rect.height / 2 + (widget.y - probe.camera.y) * probe.camera.zoom - (widget.height * probe.camera.zoom) / 2;
    const size = { width: widget.width * probe.camera.zoom, height: widget.height * probe.camera.zoom };
    for (let y = top + 4; y < top + size.height - 4; y += 5) {
      for (let x = left + 4; x < left + size.width - 4; x += 5) {
        const hit = probe.probe(x, y);
        if (hit.text?.kind === "checkbox" && hit.text.line === 0) return { x, y };
      }
    }
    return null;
  }, id);
  expect(box, "the first checklist square is hit-testable").not.toBeNull();

  await page.mouse.click(box!.x, box!.y);
  await expect.poll(() => notes(page)).toMatchObject([
    { lines: [{ block: "check", checked: true }, { block: "check", checked: false }] },
  ]);
  // The click toggles the item and does not drop the object's selection (ADR-252 §8).
  await expect.poll(() => selected(page)).toEqual([id]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => notes(page)).toMatchObject([
    { lines: [{ block: "check", checked: false }, { block: "check" }] },
  ]);
});

test("copying an object and pasting it keeps the line formats", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await freshBoard(page, "text-format-bar-copy", { template: "empty" });
  const id = await twoLineNote(page);
  await page.keyboard.press("Escape");
  const point = await pointOf(page, id);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("ControlOrMeta+Shift+8");
  await expect.poll(() => notes(page)).toMatchObject([
    { lines: [{ block: "bullet" }, { block: "bullet" }] },
  ]);

  await page.keyboard.press("ControlOrMeta+c");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("remo/fragment");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await notes(page)).length).toBe(2);
  const [original, copy] = await notes(page);
  expect(copy!.id).not.toBe(original!.id);
  expect(copy!.lines.map((line) => [line.block, line.text])).toEqual([
    ["bullet", "первая"],
    ["bullet", "вторая"],
  ]);
});
