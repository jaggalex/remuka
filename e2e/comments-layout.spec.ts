import { expect, test } from "@playwright/test";
import { addComment, freshBoard, openComments } from "./helpers";

/**
 * The comments panel reads at the size of the rest of the room (spec/character.md §3.3:
 * text 15–16 px) and the reply field takes the width of its thread, as on App-Panels.
 */
for (const width of [1440, 390]) {
  test(`a comment thread is readable and its reply field is wide at ${width}`, async ({ page }, testInfo) => {
    await freshBoard(page, `comments-layout-${width}`, { template: "empty" });
    await openComments(page);
    await addComment(page, "Длинный комментарий: ревью в понедельник успеваем? Дизайн будет к пятнице.");
    // The thread is created on a desktop width; the check runs on the width under test.
    await page.setViewportSize({ width, height: 900 });

    const thread = page.locator(".comments-thread").first();
    const box = await thread.evaluate((el) => {
      const px = (node: Element | null) => (node ? Number.parseFloat(getComputedStyle(node).fontSize) : 0);
      const field = el.querySelector(".comment-reply textarea")!.getBoundingClientRect();
      const del = el.querySelector(".comment-body > .rm-btn")?.getBoundingClientRect();
      const body = el.querySelector(".comment-body")!.getBoundingClientRect();
      return {
        thread: el.getBoundingClientRect().width,
        field: field.width,
        text: px(el.querySelector(".comment-body p")),
        name: px(el.querySelector(".comment-meta b")),
        about: px(el.querySelector(".comments-about")),
        deleteWidth: del?.width ?? 0,
        bodyWidth: body.width,
        overflow: el.scrollWidth > el.clientWidth + 1,
      };
    });
    expect(box.text).toBeGreaterThanOrEqual(15);
    expect(box.name).toBeGreaterThanOrEqual(14);
    expect(box.about).toBeGreaterThanOrEqual(13);
    expect(box.field).toBeGreaterThanOrEqual(box.thread * 0.5);
    expect(box.deleteWidth).toBeLessThan(box.bodyWidth * 0.6);
    expect(box.overflow).toBe(false);
    await testInfo.attach(`comments-${width}`, { body: await page.locator(".comments-panel").screenshot(), contentType: "image/png" });

    // Enter sends a reply; Shift+Enter keeps a new line.
    const field = thread.locator(".comment-reply textarea");
    await field.click();
    await field.pressSequentially("Да, ставлю на 11:00");
    await page.keyboard.press("Enter");
    await expect(thread.locator(".comment-message")).toHaveCount(2);
    await expect(field).toHaveValue("");
  });
}

/** On a phone the panel covers the canvas; while a new comment is being placed it steps aside. */
test("a new comment can be placed on a phone", async ({ page }) => {
  await freshBoard(page, "comments-phone", { template: "empty" });
  await page.setViewportSize({ width: 390, height: 844 });
  await openComments(page);
  await page.locator(".comments-panel").getByRole("button", { name: "New comment" }).click();
  await expect(page.locator(".comments-panel")).toBeHidden();
  await page.mouse.click(120, 420);
  await expect(page.getByRole("dialog", { name: "New comment" })).toBeVisible();
});
