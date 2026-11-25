import { expect, test } from "@playwright/test";
import { freshBoard } from "./helpers";

test("an empty room starts with a note or a shape and the inspector closed", async ({ page }) => {
  await freshBoard(page, "empty-start", { template: "empty" });

  const start = page.locator(".empty-board");
  await expect(start).toBeVisible();
  await expect(start).toContainText("It's quiet in here");
  await expect(start.getByRole("button", { name: "First sticker" })).toBeVisible();
  await expect(start.getByRole("button", { name: "Take a template" })).toBeVisible();
  await expect(start.getByRole("button", { name: "Ask the agent" })).toBeVisible();
  // ADR-197: a person with no stored choice does not land on a technical panel.
  await expect(page.locator(".app")).toHaveClass(/no-inspector/);
  await expect(page.locator(".inspector")).toBeHidden();

  const zoom = () =>
    page.evaluate(
      () => (window as unknown as { __remo: { camera: { zoom: number } } }).__remo.camera.zoom,
    );
  const before = await zoom();
  await start.getByRole("button", { name: "First sticker" }).click();
  await expect(page.locator(".inline-editor")).toBeVisible();
  await expect(page.locator(".empty-board")).toHaveCount(0);
  // The first note does not zoom the room onto itself (ADR-197).
  await page.waitForTimeout(300);
  expect(await zoom()).toBeCloseTo(before, 5);
});

test("the empty room's example opens the template picker", async ({ page }) => {
  await freshBoard(page, "empty-example", { template: "empty" });

  await page.locator(".empty-board").getByRole("button", { name: "Take a template" }).click();
  await expect(page.locator(".rm-popover")).toBeVisible();
  await expect(page.getByText("Kanban room")).toBeVisible();
});
