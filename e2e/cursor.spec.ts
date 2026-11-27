import { expect, test, type Browser, type Page } from "@playwright/test";
import { PASSWORD, openBoard, register, zoomInTo } from "./helpers";

/**
 * A colleague's cursor (ADR-265 §3.4, §4.1, `spec/character.md`).
 *
 * The cursor is a canvas shape, so the scenario reads where the overlay draws it through
 * the dev probe (`__remo.cursors()`): the spring's position, the name on the plate, the
 * opacity and the point the peer reported. The same probe drives `cursorMotion.test.ts`;
 * here two real sessions prove the wire between them.
 */

interface CursorReadout {
  /** Milliseconds since the sample loop started. */
  t: number;
  x: number;
  y: number;
  alpha: number;
  label: string;
  target: { x: number; y: number };
}

/** Where the first peer's cursor is drawn, or null while the room has no cursor. */
async function readCursor(page: Page): Promise<Omit<CursorReadout, "t"> | null> {
  return page.evaluate(() => {
    const readout = (
      window as unknown as {
        __remo?: {
          cursors: () => Array<{
            x: number;
            y: number;
            alpha: number;
            label: string;
            target: { x: number; y: number };
          }>;
        };
      }
    ).__remo?.cursors()[0];
    return readout ? { x: readout.x, y: readout.y, alpha: readout.alpha, label: readout.label, target: readout.target } : null;
  });
}

/**
 * Sample every drawn frame for `ms`. The probe object is re-created when presence
 * changes, so it is looked up on each frame rather than captured once. The first sample
 * raises `__cursorSampling`, so the scenario moves the peer's mouse only after the old
 * point is on record — otherwise the jump could land before the loop's first frame.
 */
function sampleCursor(page: Page, ms: number): Promise<CursorReadout[]> {
  return page.evaluate(
    (duration) =>
      new Promise<CursorReadout[]>((resolve) => {
        const samples: CursorReadout[] = [];
        const probe = window as unknown as { __cursorSampling?: boolean };
        probe.__cursorSampling = false;
        const started = performance.now();
        const tick = () => {
          const readout = (
            window as unknown as {
              __remo?: {
                cursors: () => Array<{
                  x: number;
                  y: number;
                  alpha: number;
                  label: string;
                  target: { x: number; y: number };
                }>;
              };
            }
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

/** Wait until the sample loop has its first frame on record. */
async function samplingStarted(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __cursorSampling?: boolean }).__cursorSampling === true,
  );
}

/** A second session of the same account: the first page sees it as a peer. */
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

/** Put the second session's pointer on the canvas: its cursor is published from there. */
async function placePointer(other: Page, point: { x: number; y: number }) {
  await other.mouse.move(point.x, point.y);
}

/**
 * Two free points on the canvas with a quarter-screen gap. The empty room centres its
 * "what next" buttons over the board, so a blind click at the centre never reaches the
 * canvas; the scenario asks the page where the canvas is actually on top.
 */
async function canvasFlight(other: Page): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  return other.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay");
    if (!canvas) throw new Error("canvas not found");
    const rect = canvas.getBoundingClientRect();
    const free = (x: number, y: number) => document.elementFromPoint(x, y) === canvas;
    for (let fy = 0.15; fy <= 0.85; fy += 0.05) {
      for (let fx = 0.1; fx <= 0.6; fx += 0.05) {
        const x = rect.left + rect.width * fx;
        const y = rect.top + rect.height * fy;
        if (free(x, y) && free(x + 320, y + 40) && x + 320 < rect.right - 20 && y + 40 < rect.bottom - 20) {
          return { from: { x, y }, to: { x: x + 320, y: y + 40 } };
        }
      }
    }
    throw new Error("no pair of free points on the canvas");
  });
}

test("a colleague's cursor carries the name and arrives without overshooting", async ({ page, browser }) => {
  const account = await register(page, "cursor", { user: "Sess" });
  await openBoard(page, account.boardId);
  const { context, other } = await secondSession(browser, account.boardId, account.email);
  try {
    await expect(page.locator(".presence .peer")).toHaveCount(1);
    // A hand moves a few hundred screen pixels; at 100 % that is a few hundred board
    // units, which is the distance the spring is judged on.
    await zoomInTo(other, 1);

    const { from, to } = await canvasFlight(other);
    await placePointer(other, from);

    // The name the painter receives is the peer's label, not initials ("S" or "S(").
    await expect.poll(async () => (await readCursor(page))?.label).toBe("Sess (2)");
    // The spring settles on the first point before the jump is measured. The pause is
    // longer than the 40 ms cursor throttle, so the measured move is never dropped.
    await expect
      .poll(async () => {
        const cursor = await readCursor(page);
        return cursor != null && Math.abs(cursor.x - cursor.target.x) < 0.5;
      })
      .toBe(true);
    await page.waitForTimeout(200);

    const sampling = sampleCursor(page, 1_800);
    await samplingStarted(page);
    await other.mouse.move(to.x, to.y);
    const samples = await sampling;

    expect(samples.length).toBeGreaterThan(30);
    const start = samples[0]!;
    const end = samples[samples.length - 1]!;
    const target = end.target;
    // The peer really moved: the new point is hundreds of board units away.
    expect(Math.hypot(target.x - start.target.x, target.y - start.target.y)).toBeGreaterThan(200);
    expect(samples.every((sample) => sample.label === "Sess (2)")).toBe(true);

    // It flies instead of jumping: there are drawn frames between the two points.
    expect(samples.some((sample) => target.x - sample.x > 50)).toBe(true);
    // Arrival within a second of the new point arriving, and no overshoot > 1 px.
    const moved = samples.find(
      (sample) => sample.target.x !== start.target.x || sample.target.y !== start.target.y,
    );
    expect(moved, "the peer's new point reached the first page").toBeTruthy();
    const arrived = samples.find(
      (sample) => Math.abs(sample.x - target.x) <= 1 && Math.abs(sample.y - target.y) <= 1,
    );
    expect(arrived, "the cursor reached the target").toBeTruthy();
    expect(arrived!.t - moved!.t).toBeLessThanOrEqual(1_000);
    expect(Math.max(...samples.map((sample) => sample.x))).toBeLessThanOrEqual(target.x + 1);
    expect(Math.max(...samples.map((sample) => sample.y))).toBeLessThanOrEqual(target.y + 1);
    // Drawn, not faded out: a live cursor is fully opaque.
    expect(end.alpha).toBe(1);
  } finally {
    await context.close();
  }
});

test("with reduced motion the cursor is at the point at once", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const account = await register(page, "cursor-calm", { user: "Calm" });
  await openBoard(page, account.boardId);
  const { context, other } = await secondSession(browser, account.boardId, account.email);
  try {
    await expect(page.locator(".presence .peer")).toHaveCount(1);
    await zoomInTo(other, 1);

    const { from, to } = await canvasFlight(other);
    await placePointer(other, from);
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

    // No spring and no fade: the only two places ever drawn are the old point and the
    // new one. A sample may still show the old point for the frame before the next
    // paint consumes the presence update — that is a frame of latency, not a flight.
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
    // At most two frames between the point arriving and the cursor being there.
    const jumpIndex = samples.indexOf(afterJump[0]!);
    const onTarget = samples.findIndex((sample) => sample.x === target.x && sample.y === target.y);
    expect(onTarget - jumpIndex).toBeLessThanOrEqual(2);
  } finally {
    await context.close();
  }
});
