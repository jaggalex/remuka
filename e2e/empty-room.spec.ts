import { expect, test } from "@playwright/test";
import { enableLink, freshBoard, openBoard, register, setAccountTheme } from "./helpers";

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

  const template = page.locator(".empty-board").getByRole("button", { name: "Take a template" });
  const badge = template.locator(".empty-card-icon");
  const agentBadge = page.locator(".empty-card-icon.is-agent");
  for (const theme of ["light", "dark"] as const) {
    await setAccountTheme(page, theme);
    await expect(badge).toHaveCSS("background-color", "rgb(200, 232, 212)");
    await expect(badge.locator("svg")).toHaveCSS("stroke", "rgb(30, 33, 54)");
    await expect(agentBadge).toHaveCSS("background-color", "rgb(243, 232, 255)");
    await expect(agentBadge).toHaveCSS("border-top-color", "rgb(138, 53, 214)");
    await expect(agentBadge.locator("svg")).toHaveCSS("stroke", "rgb(138, 53, 214)");
  }
  await template.click();
  await expect(page.locator(".rm-popover")).toBeVisible();
  await expect(page.getByText("Kanban room")).toBeVisible();
});

for (const lang of ["en", "ru"] as const) {
  test(`empty-room instructions rotate by visit and stay put during a visit (${lang})`, async ({ page }) => {
    const { boardId } = await register(page, `empty-visits-${lang}`);
    await openBoard(page, boardId, { template: "empty", lang });
    const titles = lang === "ru"
      ? ["Здесь пока тихо", "Чистый лист — лучший старт", "Комната ждёт людей"]
      : ["It's quiet in here", "Start with a blank canvas", "Make room for your team"];
    const heading = page.locator(".empty-heading h1");
    for (const [visit, title] of [...titles, titles[0]!].entries()) {
      if (visit > 0) await page.reload();
      await expect(page.locator(".empty-cards")).toBeVisible();
      await expect(heading).toHaveText(title);
      const viewport = page.viewportSize()!;
      await page.setViewportSize({ ...viewport, width: viewport.width === 390 ? 1440 : 390 });
      await expect(heading).toHaveText(title);
      await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("remuka.hints.room.empty") ?? "{}").visits)).toBe(visit + 1);
    }
  });
}

test("a double click on the empty canvas creates the first editable sticker", async ({ page }) => {
  await freshBoard(page, "empty-double-click", { template: "empty" });
  await page.locator(".layer.overlay").dblclick({ position: { x: 180, y: 110 } });
  await expect(page.locator(".inline-editor")).toBeVisible();
  await expect(page.locator(".empty-board")).toHaveCount(0);
});

test("an invitation hint yields to a teammate and the replacement stays for that visit", async ({ page, browser }) => {
  const { boardId } = await register(page, "empty-hint-together");
  // Arrange the third visit before the room opens, without resetting this value on reload.
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("remuka.hints.room.empty", '{"done":0,"visits":2}'));
  await openBoard(page, boardId, { template: "empty" });
  const title = page.locator(".empty-heading h1");
  await expect(title).toHaveText("Make room for your team");
  const ownerVisit = await page.evaluate(() => performance.timeOrigin);
  await enableLink(page, boardId);
  const guest = await browser.newContext({ locale: "en-US" });
  try {
    const teammate = await guest.newPage();
    await teammate.goto(`/?room=${boardId}&lang=en`);
    await teammate.getByRole("button", { name: "Enter room", exact: true }).click();
    await expect(teammate.locator(".rm-readonly")).toContainText("View only");
    await expect(page.getByRole("button", { name: "People in the room: 2" })).toBeVisible();
    await expect(title).toHaveText("It's quiet in here");
  } finally {
    await guest.close();
  }
  // An abruptly closed tab can remain in awareness until its 30-second expiry.
  await expect(page.getByRole("button", { name: "People in the room: 1" })).toBeVisible({ timeout: 40_000 });
  expect(await page.evaluate(() => performance.timeOrigin), "The owner must still be on the same page visit").toBe(ownerVisit);
  await expect(title).toHaveText("It's quiet in here");
});
