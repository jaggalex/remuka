import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  createShape,
  ensureProperties,
  freshBoard,
  openBoardMenu,
  register,
} from "./helpers";

interface ProbeWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: { elevation?: string };
}

const widgets = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __remo: { widgets: ProbeWidget[] } }).__remo.widgets,
  );

/** The line is added from the product's own shadow menu, not written into the document. */
async function chooseCardboard(page: Page): Promise<void> {
  await ensureProperties(page);
  const inspector = page.locator("aside.inspector");
  await inspector.getByRole("button", { name: "More actions", exact: true }).click();
  const menu = page.getByRole("menu", { name: "More actions" });
  await menu.getByRole("menuitemcheckbox", { name: "Cardboard", exact: true }).click();
  await page.keyboard.press("Escape");
}

test("the cardboard level is saved, reaches the second participant and lands in the PNG", async ({
  page,
  browser,
}) => {
  const account = await freshBoard(page, "cardboard", { template: "empty" });
  await createShape(page, "Ellipse");
  const shape = (await widgets(page)).find((widget) => widget.type === "shape")!;
  expect(shape, "the ellipse was created").toBeTruthy();

  // The level is offered beside the two existing ones and stored in the object.
  await chooseCardboard(page);
  await expect
    .poll(async () => (await widgets(page)).find((widget) => widget.id === shape.id)?.style?.elevation)
    .toBe("cardboard");
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });

  // It is document data, not a local menu state: a reload paints and reads the same level.
  await page.goto(`/?room=${account.boardId}&lang=en&select=${shape.id}`);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await expect
    .poll(async () => (await widgets(page)).find((widget) => widget.id === shape.id)?.style?.elevation)
    .toBe("cardboard");

  // A second account joins the room as a viewer and receives the same value over Yjs.
  const other = await browser.newContext();
  try {
    const guestPage = await other.newPage();
    const guest = await register(guestPage, "cardboard-guest");
    const invitation = await page.request.post(`/api/boards/${account.boardId}/invitations`, {
      data: { email: guest.email, role: "viewer" },
    });
    expect(invitation.ok(), await invitation.text()).toBeTruthy();
    const { url } = (await invitation.json()) as { url: string };
    await guestPage.goto(`/${new URL(url).search}&lang=en`);
    await guestPage
      .getByRole("dialog", { name: "You are invited" })
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await expect(guestPage.locator(".save-state")).toHaveAttribute("data-state", "saved", {
      timeout: 20_000,
    });
    await expect
      .poll(async () =>
        (await widgets(guestPage)).find((widget) => widget.id === shape.id)?.style?.elevation,
      )
      .toBe("cardboard");
  } finally {
    await other.close();
  }

  // The picture comes from the same painter: export the selection and read the shadow
  // band two board units right of the shape. Only a cardboard cast reaches there.
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  const dialog = page.locator(".export-dialog");
  await dialog.getByRole("radio", { name: /^Selection/ }).click();
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const png = await downloaded;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  await expect(page.locator(".export-status.done")).toBeVisible({ timeout: 20_000 });
  const bytes = await readFile((await png.path())!);
  const sample = await page.evaluate(
    async ({ base64, shapeWidth, shapeHeight }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      // Selection scope pads by 24 board units and exports at 2 device pixels per unit.
      const x = canvas.width - 48 + 4;
      const y = Math.round(canvas.height / 2);
      const pixel = [...ctx.getImageData(x, y, 1, 1).data];
      return {
        width: canvas.width,
        height: canvas.height,
        expectedWidth: Math.ceil((shapeWidth + 48) * 2),
        expectedHeight: Math.ceil((shapeHeight + 48) * 2),
        pixel,
      };
    },
    { base64: bytes.toString("base64"), shapeWidth: shape.width, shapeHeight: shape.height },
  );
  expect(sample.width).toBe(sample.expectedWidth);
  expect(sample.height).toBe(sample.expectedHeight);
  // `canvas-object-ink` #1e2136; the board behind the picture is #f7f7f8.
  expect(sample.pixel[0]).toBeLessThan(60);
  expect(sample.pixel[1]).toBeLessThan(60);
  expect(sample.pixel[2]).toBeLessThan(80);
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
});
