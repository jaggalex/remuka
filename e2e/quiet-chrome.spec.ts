import { expect, test, type Page } from "@playwright/test";
import { freshBoard, seedStableNote } from "./helpers";

/**
 * Quiet chrome during a canvas gesture (ADR-266 §7, task T9).
 *
 * While an object is dragged, the header, the rail and the bottom HUD fade to 35 % and
 * stop taking the pointer; a keyboard move never does that. The fade is CSS, so the
 * scenario reads the class, the computed opacity and what is under a header button.
 */

interface ProbeWidget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function clientPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((wanted) => {
    const probe = (
      window as unknown as {
        __remo: {
          camera: { x: number; y: number; zoom: number };
          widgets: ProbeWidget[];
        };
      }
    ).__remo;
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

async function chromeState(page: Page): Promise<{
  quiet: boolean;
  opacity: number;
  pointerEvents: string;
  headerHit: boolean;
}> {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".topbar")!;
    const button = document.querySelector<HTMLElement>(".topbar-invite")!;
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(header);
    return {
      quiet: header.classList.contains("is-quiet"),
      opacity: Number(style.opacity),
      pointerEvents: style.pointerEvents,
      headerHit: Boolean(
        document
          .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          ?.closest(".topbar"),
      ),
    };
  });
}

test("a canvas drag quiets the chrome, a keyboard move does not", async ({ page }) => {
  await freshBoard(page, "quiet-chrome");
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await seedStableNote(page, { id: "quiet-note", x: 0, y: 0, text: "Note" });
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });

  const point = await clientPoint(page, "quiet-note");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 40, point.y + 20, { steps: 6 });

  // A gesture shorter than 150 ms leaves the chrome alone; this one is not.
  await page.waitForTimeout(300);
  await expect.poll(async () => (await chromeState(page)).quiet).toBe(true);
  const quiet = await chromeState(page);
  expect(quiet.opacity).toBeCloseTo(0.35, 2);
  expect(quiet.pointerEvents).toBe("none");
  // The click does not land on the header while it is quiet.
  expect(quiet.headerHit).toBe(false);
  // The rail is quiet too: the same class, the same promise (ADR-289).
  const rail = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>(".tool-rail")!;
    return {
      quiet: element.classList.contains("is-quiet"),
      pointerEvents: getComputedStyle(element).pointerEvents,
    };
  });
  expect(rail.quiet).toBe(true);
  expect(rail.pointerEvents).toBe("none");

  await page.mouse.up();
  await expect.poll(async () => (await chromeState(page)).quiet, { timeout: 3_000 }).toBe(false);
  await expect
    .poll(async () => (await chromeState(page)).opacity, { timeout: 3_000 })
    .toBeCloseTo(1, 2);
  const back = await chromeState(page);
  expect(back.pointerEvents).not.toBe("none");

  // Keyboard work is not a canvas gesture: the header stays still.
  await page.mouse.click(point.x, point.y);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(350);
  expect((await chromeState(page)).quiet).toBe(false);
  await page.keyboard.up("ArrowRight");
});
