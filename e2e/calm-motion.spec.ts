import { expect, test, type Browser, type Page } from "@playwright/test";
import { PASSWORD, openAccount, openBoard, register, zoomInTo } from "./helpers";

/**
 * "Calm animations" is an account preference (ADR-266 §8, ADR-289).
 *
 * Turning it on in one browser is a server write; a second browser gets it on sign-in.
 * With calm on, a colleague's cursor has no spring: the drawn point is either the old
 * one or the new one, never a flight between them.
 */

interface CursorReadout {
  x: number;
  y: number;
  alpha: number;
  label: string;
  target: { x: number; y: number };
}

async function readCursor(page: Page): Promise<CursorReadout | null> {
  return page.evaluate(() => {
    const readout = (
      window as unknown as {
        __remo?: { cursors: () => CursorReadout[] };
      }
    ).__remo?.cursors()[0];
    return readout
      ? {
          x: readout.x,
          y: readout.y,
          alpha: readout.alpha,
          label: readout.label,
          target: { ...readout.target },
        }
      : null;
  });
}

interface Sample extends CursorReadout {
  t: number;
}

function sampleCursor(page: Page, ms: number): Promise<Sample[]> {
  return page.evaluate(
    (duration) =>
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const probe = window as unknown as { __cursorSampling?: boolean };
        probe.__cursorSampling = false;
        const started = performance.now();
        const tick = () => {
          const readout = (
            window as unknown as { __remo?: { cursors: () => CursorReadout[] } }
          ).__remo?.cursors()[0];
          if (readout) {
            samples.push({
              t: performance.now() - started,
              x: readout.x,
              y: readout.y,
              alpha: readout.alpha,
              label: readout.label,
              target: { ...readout.target },
            });
          }
          probe.__cursorSampling = samples.length > 0;
          if (performance.now() - started < duration) requestAnimationFrame(tick);
          else resolve(samples);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

async function samplingStarted(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __cursorSampling?: boolean }).__cursorSampling === true,
  );
}

async function secondSession(browser: Browser, boardId: string, email: string) {
  const context = await browser.newContext();
  const other = await context.newPage();
  const login = await other.request.post("/api/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  await openBoard(other, boardId);
  return { context, other };
}

async function canvasFlight(
  other: Page,
): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  return other.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay");
    if (!canvas) throw new Error("canvas not found");
    const rect = canvas.getBoundingClientRect();
    const free = (x: number, y: number) => document.elementFromPoint(x, y) === canvas;
    for (let fy = 0.15; fy <= 0.85; fy += 0.05) {
      for (let fx = 0.1; fx <= 0.6; fx += 0.05) {
        const x = rect.left + rect.width * fx;
        const y = rect.top + rect.height * fy;
        if (
          free(x, y) &&
          free(x + 320, y + 40) &&
          x + 320 < rect.right - 20 &&
          y + 40 < rect.bottom - 20
        ) {
          return { from: { x, y }, to: { x: x + 320, y: y + 40 } };
        }
      }
    }
    throw new Error("no pair of free points on the canvas");
  });
}

test("calm animations follow the account, and cursors arrive without a spring", async ({
  page,
  browser,
}) => {
  const account = await register(page, "calm-motion", { user: "Calm" });
  await openBoard(page, account.boardId);

  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "calm");
  await openAccount(page);
  await page.getByRole("button", { name: "Calm animations", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "calm");
  await page.keyboard.press("Escape");

  // The choice is the account's, not this browser's (ADR-150).
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/auth/me");
      const body = (await response.json()) as {
        user: { preferences: { motion: boolean | null } };
      };
      return body.user.preferences.motion;
    })
    .toBe(true);

  const { context, other } = await secondSession(browser, account.boardId, account.email);
  try {
    await expect(other.locator("html")).toHaveAttribute("data-motion", "calm");
    await expect(page.locator(".presence .peer")).toHaveCount(1);
    await zoomInTo(other, 1);

    const { from, to } = await canvasFlight(other);
    await other.mouse.move(from.x, from.y);
    await expect.poll(async () => (await readCursor(page))?.label).toBe("Calm (2)");
    await expect
      .poll(async () => {
        const cursor = await readCursor(page);
        return cursor != null && Math.abs(cursor.x - cursor.target.x) < 0.5;
      })
      .toBe(true);
    await page.waitForTimeout(200);

    const sampling = sampleCursor(page, 900);
    await samplingStarted(page);
    await other.mouse.move(to.x, to.y);
    const samples = await sampling;

    const start = samples[0]!;
    const end = samples[samples.length - 1]!;
    const target = end.target;
    expect(Math.hypot(target.x - start.target.x, target.y - start.target.y)).toBeGreaterThan(200);
    expect(end.x).toBe(target.x);
    expect(end.y).toBe(target.y);
    expect(end.alpha).toBe(1);

    // No spring and no buffer: only the old point and the new one are ever drawn.
    const afterJump = samples.filter(
      (sample) => sample.target.x !== start.target.x || sample.target.y !== start.target.y,
    );
    expect(afterJump.length).toBeGreaterThan(10);
    const offPath = afterJump.filter((sample) => {
      const nearStart = Math.hypot(sample.x - start.x, sample.y - start.y) <= 1;
      const nearTarget = Math.hypot(sample.x - target.x, sample.y - target.y) <= 1;
      return !nearStart && !nearTarget;
    });
    expect(offPath).toEqual([]);
  } finally {
    await context.close();
  }
});
