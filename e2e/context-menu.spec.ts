import { expect, test, type Page } from "@playwright/test";
import { openBoard, register, seedStableNote } from "./helpers";

/**
 * The canvas context menu (ADR-267 §3, task T6).
 *
 * The menu is DOM even though the board is canvas: it can be read by role and name,
 * which is exactly what a person with a screen reader gets. The scenario checks the
 * three promises of the task — the title says what was right-clicked, the colour grid
 * writes the colour, and Escape puts focus back on the canvas.
 */

interface View {
  camera: { x: number; y: number; zoom: number };
  rect: { left: number; top: number; width: number; height: number };
}

interface ProbeWidget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: { fillColor?: string } | null;
}

async function clientPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  await expect
    .poll(() =>
      page.evaluate(
        (wanted) =>
          (
            window as unknown as { __remo?: { widgets?: ProbeWidget[] } }
          ).__remo?.widgets?.some((widget) => widget.id === wanted) ?? false,
        id,
      ),
    )
    .toBe(true);
  return page.evaluate((wanted) => {
    const probe = (window as unknown as { __remo: { camera: View["camera"]; widgets: ProbeWidget[] } })
      .__remo;
    const widget = probe.widgets.find((entry) => entry.id === wanted)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x:
        rect.left +
        rect.width / 2 +
        (widget.x + widget.width / 2 - probe.camera.x) * probe.camera.zoom,
      y:
        rect.top +
        rect.height / 2 +
        (widget.y + widget.height / 2 - probe.camera.y) * probe.camera.zoom,
    };
  }, id);
}

async function openMenuOn(page: Page, id: string): Promise<void> {
  const point = await clientPoint(page, id);
  await page.mouse.click(point.x, point.y, { button: "right" });
}

async function fillOf(page: Page, id: string): Promise<string | undefined> {
  return page.evaluate(
    (wanted) =>
      (
        window as unknown as { __remo: { widgets: ProbeWidget[] } }
      ).__remo.widgets.find((widget) => widget.id === wanted)?.style?.fillColor,
    id,
  );
}

test("the sticker menu has a title, a colour grid and gives focus back on Escape", async ({
  page,
}) => {
  const account = await register(page, "context-menu");
  // The task names the title in Russian; the language lives in the account, so the
  // scenario sets it before the room opens (same as every other RU scenario).
  await openBoard(page, account.boardId, { lang: "ru" });
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await seedStableNote(page, { id: "context-menu-note", x: 0, y: 0, text: "Повестка" });
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });

  await openMenuOn(page, "context-menu-note");

  // The title names the object, not the action.
  const menu = page.getByRole("menu", { name: "Стикер" });
  await expect(menu).toBeVisible();
  // Groups in the mockup's order: the object's own action, clipboard, arrange, danger.
  await expect(menu.getByRole("menuitem", { name: "Цвет", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Копировать", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "На передний план", exact: true })).toBeVisible();
  // Delete is last and reads as danger.
  const rows = menu.getByRole("menuitem");
  await expect(rows.last()).toHaveText(/Удалить/);
  await expect(rows.last()).toHaveClass(/danger/);
  // The menu takes focus when it opens.
  await expect(page.locator(":focus")).toHaveRole("menuitem");

  // The colour row opens the palette grid; a swatch writes the colour and closes both.
  await menu.getByRole("menuitem", { name: "Цвет", exact: true }).click();
  const grid = page.getByRole("menu", { name: "Цвет", exact: true });
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("menuitemradio")).toHaveCount(14);
  await expect(grid.getByRole("menuitemradio", { name: "Жёлтый", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await grid.getByRole("menuitemradio", { name: "Розовый", exact: true }).click();
  await expect(grid).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  await expect.poll(() => fillOf(page, "context-menu-note")).toBe("#f9d3cd");

  // Escape closes the menu and puts focus back on the canvas that opened it.
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay");
    canvas?.focus();
  });
  await openMenuOn(page, "context-menu-note");
  await expect(page.getByRole("menu", { name: "Стикер" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Стикер" })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (document.activeElement as HTMLElement | null)?.className ?? ""),
    )
    .toContain("overlay");
});

test("the arrow keys and Enter pick a colour from the grid", async ({ page }) => {
  const account = await register(page, "context-menu-keys");
  await openBoard(page, account.boardId, { lang: "ru" });
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await seedStableNote(page, { id: "context-menu-keys-note", x: 0, y: 0, text: "Повестка" });
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });

  await openMenuOn(page, "context-menu-keys-note");
  const menu = page.getByRole("menu", { name: "Стикер" });
  await expect(menu).toBeVisible();
  // The first row is the object's own action; → opens its grid and focuses a swatch.
  await expect(page.locator(":focus")).toHaveAccessibleName("Цвет");
  await page.keyboard.press("ArrowRight");
  const grid = page.getByRole("menu", { name: "Цвет", exact: true });
  await expect(grid).toBeVisible();
  await expect(page.locator(":focus")).toHaveRole("menuitemradio");
  // A grid is two rows of seven: ↓ moves a row down, to the 300 tone.
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveAccessibleName("Тёплый серый");
  await page.keyboard.press("Enter");
  await expect(grid).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  await expect.poll(() => fillOf(page, "context-menu-keys-note")).toBe("#cdc8c0");

  // Escape closes the grid first and leaves focus on the row that opened it.
  await openMenuOn(page, "context-menu-keys-note");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(grid).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(grid).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveAccessibleName("Цвет");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveAccessibleName("Очистить содержимое");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});
