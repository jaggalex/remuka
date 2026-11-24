import { expect, type Page, test } from "@playwright/test";
import { freshBoard, openBoard, register, setAccountTheme } from "./helpers";

/**
 * Ink knows its paper (ADR-273, `spec/ink-on-ground.md`).
 *
 * The browser scenario behind the acceptance list: the owner's dark-theme room — a free
 * text saved with the old grey and a kanban with lanes — a person's black text with its
 * halo and the window's warning, and the document staying free of defaults. The visual
 * pair of the same scene lives in `visual.spec.ts`; this file reads pixels, so it fails
 * on a screen that only "looks fine" in one theme.
 */

type Readout = {
  camera: { x: number; y: number; zoom: number };
  widgets: Array<{ id: string; type: string; x: number; y: number; width: number; height: number }>;
  layouts: Array<{
    kanbanId: string;
    columns: Array<{ id: string; left: number; width: number }>;
    lanes: Array<{ id: string; centerY: number }>;
  }>;
};

const readout = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __remo: Readout }).__remo as unknown as Readout,
  );

function toClient(
  probe: Readout,
  frame: { left: number; top: number; width: number; height: number },
  world: { x: number; y: number },
) {
  return {
    x: frame.left + frame.width / 2 + (world.x - probe.camera.x) * probe.camera.zoom,
    y: frame.top + frame.height / 2 + (world.y - probe.camera.y) * probe.camera.zoom,
  };
}

async function boardFrame(page: Page) {
  const rect = await page.locator(".layer.board").boundingBox();
  if (!rect) throw new Error("no board canvas");
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

/** The darkest and the lightest pixel of a client-space region, as 0…255 luminance. */
async function inkRange(page: Page, region: { x: number; y: number; width: number; height: number }) {
  return page.evaluate(({ x, y, width, height }) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.board")!;
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const data = canvas
      .getContext("2d")!
      .getImageData(
        Math.max(0, Math.round((x - rect.left) * dpr)),
        Math.max(0, Math.round((y - rect.top) * dpr)),
        Math.max(1, Math.round(width * dpr)),
        Math.max(1, Math.round(height * dpr)),
      ).data;
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      const lum = 0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
    return { min, max };
  }, region);
}

/** WCAG contrast of two pixels, read through the same formula the model uses. */
function contrast(a: number, b: number): number {
  const lum = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const [high, low] = [lum(a), lum(b)].sort((one, two) => two - one);
  return (high! + 0.05) / (low! + 0.05);
}

/** Select one object by clicking its centre, the way a person would. */
async function select(page: Page, id: string) {
  const probe = await readout(page);
  const widget = probe.widgets.find((entry) => entry.id === id);
  if (!widget) throw new Error(`no widget ${id}`);
  const point = toClient(probe, await boardFrame(page), widget);
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toEqual([id]);
}

test("the owner's room reads in both themes: old text and a kanban with lanes", async ({ page }) => {
  const account = await register(page, "ink-room");
  await openBoard(page, account.boardId, {
    lang: "ru",
    template: "product-roadmap-basic-prefilled",
  });
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved");
  // A template seeds an empty room after sync has said it is empty.
  await page.waitForFunction(
    () =>
      (window as unknown as { __remo?: { widgets?: Array<{ type: string }> } }).__remo?.widgets?.some(
        (widget) => widget.type === "text",
      ) ?? false,
  );

  const probe = await readout(page);
  // The template is a document written before ADR-273: its caption stores the old
  // near-black, which now reads as Auto (§2.3).
  const caption = probe.widgets.find((widget) => widget.type === "text");
  expect(caption, "the template has a caption").toBeTruthy();
  const stored = await page.evaluate(
    () =>
      (window as unknown as { __remo: { widgets: Array<{ type: string; style?: { color?: string } }> } })
        .__remo.widgets.find((widget) => widget.type === "text")?.style?.color,
  );
  expect(["#58534e", "#1a1a1a"]).toContain(stored);

  // A reload refits the camera, so the box is measured again after each theme switch.
  const regionOf = async () => {
    const fresh = await readout(page);
    const widget = fresh.widgets.find((entry) => entry.id === caption!.id)!;
    const frame = await boardFrame(page);
    const centre = toClient(fresh, frame, widget);
    return {
      x: centre.x - (widget.width * fresh.camera.zoom) / 2,
      y: centre.y - (widget.height * fresh.camera.zoom) / 2,
      width: widget.width * fresh.camera.zoom,
      height: widget.height * fresh.camera.zoom,
    };
  };

  // Light theme: ink on paper — the letters are dark.
  const light = await inkRange(page, await regionOf());
  expect(light.min, "dark ink on light paper").toBeLessThan(70);

  await setAccountTheme(page, "dark", "ru");
  const dark = await inkRange(page, await regionOf());
  // Dark theme: paper on ink — the same stored colour now paints light, not the old grey
  // (#58534e is about 88/255 and would never reach this).
  expect(dark.max, "paper ink on the dark canvas").toBeGreaterThan(200);

  // The grid is a hairline in both themes: a separator differs from the board's ground
  // by well under a border's 3:1 (ADR-273 §2.2).
  const withLayout = await readout(page);
  const frameDark = await boardFrame(page);
  const layout = withLayout.layouts[0];
  expect(layout, "the roadmap has a kanban").toBeTruthy();
  const column = layout!.columns[1]!;
  const lane = layout!.lanes[0]!;
  const linePoint = toClient(withLayout, frameDark, { x: column.left, y: lane.centerY });
  const line = await inkRange(page, {
    x: linePoint.x - 2,
    y: linePoint.y - 40,
    width: 4,
    height: 80,
  });
  const groundInk = await inkRange(page, {
    x: linePoint.x + 20,
    y: linePoint.y - 40,
    width: 8,
    height: 80,
  });
  expect(contrast(line.min, groundInk.max), "dark grid is a hairline, not a border").toBeLessThan(
    2.2,
  );

  // And the header text on the light-green board is ink, not the theme's light text.
  const header = layout!.columns[0]!;
  const headerPoint = toClient(withLayout, frameDark, {
    x: header.left + header.width / 2,
    y: lane.centerY - 260,
  });
  const headerInk = await inkRange(page, {
    x: headerPoint.x - 80,
    y: headerPoint.y - 12,
    width: 160,
    height: 24,
  });
  expect(headerInk.min, "column header ink on the board's ground").toBeLessThan(90);
});

test("a new text writes no colour and opens as Auto", async ({ page }) => {
  await freshBoard(page, "ink-new");
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const stored = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: {
        selectedIds: string[];
        widgets: Array<{ id: string; style?: Record<string, unknown> }>;
      };
    }).__remo;
    return probe.widgets.find((widget) => widget.id === probe.selectedIds[0])?.style ?? {};
  });
  expect(stored.color, "a new text stores no colour").toBeUndefined();
  expect(stored.textColor, "a new text stores no text colour").toBeUndefined();
});

test("black on the dark canvas gets a halo, a warning and the way back to Auto", async ({
  page,
}) => {
  await freshBoard(page, "ink-black");
  // A person's own colour: white paper, then the Black swatch in the Text window.
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.keyboard.type("Black on ink");
  await page.keyboard.press("Escape");
  const bar = page.getByRole("toolbar", { name: "Object properties", exact: true });
  await bar.locator(".sb-colour").click();
  await page.getByRole("button", { name: "Black", exact: true }).click();

  const textId = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo: {
        selectedIds: string[];
        widgets: Array<{ id: string; type: string; style?: { color?: string } }>;
      };
    }).__remo;
    // The board's template already has captions; the new one is the selection.
    const text = probe.widgets.find((widget) => widget.id === probe.selectedIds[0])!;
    return { id: text.id, colour: text.style?.color, type: text.type };
  });
  expect(textId.type).toBe("text");
  expect(textId.colour, "the choice is stored, not derived").toBe("#000000");

  await setAccountTheme(page, "dark");
  const probe = await readout(page);
  const widget = probe.widgets.find((entry) => entry.id === textId.id)!;
  const frame = await boardFrame(page);
  const centre = toClient(probe, frame, widget);
  const region = {
    x: centre.x - (widget.width * probe.camera.zoom) / 2,
    y: centre.y - (widget.height * probe.camera.zoom) / 2,
    width: widget.width * probe.camera.zoom,
    height: widget.height * probe.camera.zoom,
  };
  // The colour is the person's: black stays black (the letters are dark)...
  const painted = await inkRange(page, region);
  expect(painted.min).toBeLessThan(40);
  // ...and the halo is paper, so the block still reads against the canvas.
  expect(painted.max).toBeGreaterThan(200);

  await select(page, textId.id);
  await page.getByRole("toolbar", { name: "Object properties", exact: true }).locator(".sb-colour").click();
  const warning = page.locator(".cw-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("Hard to read on this background");
  await warning.getByRole("button", { name: "Auto", exact: true }).click();

  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as unknown as { __remo: { widgets: Array<{ id: string; style?: { color?: string } }> } })
            .__remo.widgets.find((widget) => widget.id === id)?.style?.color ?? null,
        textId.id,
      ),
    )
    .toBeNull();
  await expect(page.locator(".cw-warning")).toHaveCount(0);
});
