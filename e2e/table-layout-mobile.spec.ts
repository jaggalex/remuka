import { expect, test } from "@playwright/test";
import { ensureProperties, register, seedNote, seedObject } from "./helpers";

test("a narrow screen can apply the table preview opened from properties", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { boardId } = await register(page, "table-layout-mobile");
  const frame = await seedObject(page, boardId, { type: "frame", title: "Risks", x: 0, y: 0, width: 560, height: 360 });
  await seedNote(page, boardId, { x: 0, y: 0 }, undefined, "Deadline", frame);
  await page.goto(`/?room=${boardId}&lang=en&select=${frame}`);
  await ensureProperties(page);
  const panel = page.locator(".section-panel");
  await panel.getByRole("radio", { name: "Table", exact: true }).click();
  const preview = page.locator(".section-layout-card");
  await preview.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(panel.locator(".section-axis-group").first().locator(".section-axis-row")).toHaveCount(2);
});
