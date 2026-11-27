import { expect, test } from "@playwright/test";
import { freshBoard, openRun, selectKanbanCard } from "./helpers";

/**
 * A reaction on the selected object floats straight up for at least five seconds and
 * fades on the way (ADR-315): measured from the running animation, not from a screenshot.
 */
test("a reaction on the selected object rises for five seconds and fades out", async ({ page }) => {
  await freshBoard(page, "reaction-motion");
  await selectKanbanCard(page);
  const measured = page.evaluate(() => new Promise<{ duration: number; frames: { offset: number; opacity: number; dx: number; dy: number }[] }>((resolve) => {
    const layer = document.querySelector(".reactions-layer")!;
    const observer = new MutationObserver(() => {
      const burst = layer.querySelector<HTMLElement>(".reaction-burst.anchored");
      if (!burst) return;
      observer.disconnect();
      const animation = burst.getAnimations()[0]!;
      const duration = Number(animation.effect!.getComputedTiming().duration);
      const keyframes = (animation.effect as KeyframeEffect).getKeyframes();
      // Sample the real computed transform at the keyframe offsets by seeking a paused copy.
      animation.pause();
      const frames = keyframes.map((frame) => {
        animation.currentTime = (frame.computedOffset ?? 0) * duration;
        const style = getComputedStyle(burst);
        const matrix = new DOMMatrixReadOnly(style.transform);
        return { offset: frame.computedOffset ?? 0, opacity: Number(style.opacity), dx: matrix.m41, dy: matrix.m42 };
      });
      resolve({ duration, frames });
    });
    observer.observe(layer, { childList: true });
  }));
  await openRun(page);
  await page.locator(".menu-reaction").first().click();
  const { duration, frames } = await measured;
  expect(duration).toBeGreaterThanOrEqual(5000);
  const first = frames[0]!;
  const middle = frames.find((frame) => frame.offset === 0.5)!;
  const last = frames.at(-1)!;
  // Still fully visible halfway, gone at the end.
  expect(middle.opacity).toBe(1);
  expect(last.opacity).toBe(0);
  // Straight up: at least 200 px of rise, at most a gentle sway sideways.
  expect(first.dy - last.dy).toBeGreaterThanOrEqual(200);
  for (const frame of frames) expect(Math.abs(frame.dx - first.dx)).toBeLessThanOrEqual(16);
});
