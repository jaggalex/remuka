import { expect, test, type Page } from "@playwright/test";
import { buffer, text } from "node:stream/consumers";
import { enableLink, ensureProperties, freshBoard, openBoardMenu, openFold } from "./helpers";

/**
 * Pictures on the canvas (ADR-249, `spec/images.md` §9.1–9.3, §9.5, §9.7).
 *
 * Every case checks the document, not a pixel: a picture "arrived" when the board has an
 * image object with the file's own size, and the placeholder is gone. The upload runs
 * against the disk driver the test server uses, so no bucket is needed.
 */

interface ProbeWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alt?: string | null;
  fileId?: string | null;
  naturalWidth?: number | null;
  naturalHeight?: number | null;
}

interface Probe {
  __remo: {
    widgets: ProbeWidget[];
    selectedIds: string[];
    camera: { x: number; y: number; zoom: number };
  };
}

/** A real PNG, drawn in the page: the upload checks signatures, not extensions. */
async function makePng(page: Page, width = 200, height = 100): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(10, 10, 40, 40);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!), "image/png"),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { width, height },
  );
  return Buffer.from(bytes);
}

const imageList = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Probe).__remo.widgets.filter((widget) => widget.type === "image"),
  );

test("a link-only visitor sees the public image title without requesting original metadata", async ({ page, browser }) => {
  const account = await freshBoard(page, "images-link-viewer", { template: "empty" });
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Image" }).click();
  await (await choosing).setFiles({ name: "private-name.png", mimeType: "image/png", buffer: await makePng(page) });
  const bar = page.getByRole("toolbar", { name: "Image", exact: true });
  await expect(bar).toBeVisible();
  await enableLink(page, account.boardId);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    const originals: string[] = [];
    guest.on("request", request => {
      if (new URL(request.url()).pathname.endsWith("/original")) originals.push(request.method());
    });
    await guest.goto(`/?room=${account.boardId}&lang=en`);
    await guest.getByRole("button", { name: "Enter room", exact: true }).click();
    await expect(guest.locator(".save-state")).toHaveAttribute("data-state", "saved");
    await expect.poll(async () => (await imageList(guest)).length).toBe(1);
    await guest.locator(".layer.overlay").dblclick();
    const viewer = guest.locator(".rm-lightbox");
    await expect(viewer.getByRole("heading")).toHaveText("Image");
    await expect(viewer.getByRole("button", { name: "Download" })).toHaveCount(0);
    await bar.getByRole("button", { name: "Description" }).click();
    const description = page.getByRole("textbox", { name: "Description" });
    await description.fill("Public description");
    await description.press("Meta+Enter");
    await expect(viewer.getByRole("heading")).toHaveText("Public description");
    await expect(viewer).not.toContainText("private-name.png");
    expect(originals).toEqual([]);
  } finally {
    await context.close();
  }
});

test("the image tool uploads a picture and selects it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await freshBoard(page, "images-picker", { template: "empty" });
  const rail = page.getByRole("toolbar", { name: "Tools" });
  const png = await makePng(page, 1200, 800);

  const chooser = page.waitForEvent("filechooser");
  await rail.getByRole("button", { name: "Image" }).click();
  await (await chooser).setFiles([{ name: "big.png", mimeType: "image/png", buffer: png }]);

  await expect.poll(async () => (await imageList(page)).length, { timeout: 20_000 }).toBe(1);
  const image = (await imageList(page))[0]!;
  // The object is the picture's proportion, long side 480, never larger than the file.
  expect(image.naturalWidth).toBe(1200);
  expect(image.width).toBe(480);
  expect(image.height).toBe(320);
  expect(image.fileId).toBeTruthy();
  // It is selected once it exists, so the next action is about this picture.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Probe).__remo.selectedIds))
    .toEqual([image.id]);
  const bar = page.getByRole("toolbar", { name: "Image", exact: true });
  const actions = bar.getByRole("button");
  await expect(actions).toHaveCount(4);
  for (const action of await actions.all()) {
    const box = (await action.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  const description = bar.getByRole("button", { name: "Description" });
  await description.click();
  const field = page.getByRole("textbox", { name: "Description" });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("maxlength", "500");
  await field.fill("Unsaved description");
  await field.press("Escape");
  await expect(description).toBeFocused();
  await description.click();
  await expect(field).toHaveValue("");
});

test("a mixed drop takes the pictures and names the rest", async ({ page }) => {
  await freshBoard(page, "images-drop", { template: "empty" });
  const png = Array.from(await makePng(page, 100, 100));
  const pdf = Array.from(Buffer.from("%PDF-1.4"));

  await page.evaluate(
    ({ png, pdf }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(png)], "kept.png", { type: "image/png" }));
      transfer.items.add(new File([new Uint8Array(pdf)], "report.pdf", { type: "application/pdf" }));
      const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
      const rect = canvas.getBoundingClientRect();
      const options = {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };
      // The drop reuses this transfer: a browser keeps one drag alive across events.
      (window as unknown as { __dropTransfer: DataTransfer }).__dropTransfer = transfer;
      window.dispatchEvent(new DragEvent("dragenter", options));
      window.dispatchEvent(new DragEvent("dragover", options));
    },
    { png, pdf },
  );
  // The dashed frame says what the drop will do before it happens (§9.2).
  await expect(page.locator(".image-drop")).toBeVisible();
  await expect(page.locator(".image-drop")).toContainText("Drop to add");

  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    const drop = new DragEvent("drop", {
      dataTransfer: (window as unknown as { __dropTransfer: DataTransfer }).__dropTransfer,
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    window.dispatchEvent(drop);
  });

  await expect.poll(async () => (await imageList(page)).length, { timeout: 20_000 }).toBe(1);
  await expect(page.locator(".canvas-notice")).toContainText("can be added");
});

test("a pasted picture lands and wins over text", async ({ page }) => {
  await freshBoard(page, "images-paste", { template: "empty" });
  const png = Array.from(await makePng(page, 120, 90));

  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], "pasted.png", { type: "image/png" }));
    transfer.items.add(new File(["hello"], "note.txt", { type: "text/plain" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, png);

  await expect.poll(async () => (await imageList(page)).length, { timeout: 20_000 }).toBe(1);
  // The text beside the picture did not become a note.
  const notes = await page.evaluate(
    () => (window as unknown as Probe).__remo.widgets.filter((widget) => widget.type === "sticky_note").length,
  );
  expect(notes).toBe(0);
});

test("the object bar describes, replaces and views the picture", async ({ page }) => {
  await freshBoard(page, "images-object", { template: "empty" });
  const rail = page.getByRole("toolbar", { name: "Tools" });
  const png = await makePng(page, 1200, 800);
  const chooser = page.waitForEvent("filechooser");
  await rail.getByRole("button", { name: "Image" }).click();
  await (await chooser).setFiles([{ name: "first.png", mimeType: "image/png", buffer: png }]);
  await expect.poll(async () => (await imageList(page)).length, { timeout: 20_000 }).toBe(1);
  const before = (await imageList(page))[0]!;

  const bar = page.getByRole("toolbar", { name: "Image", exact: true });
  await expect(bar.locator(".image-bar-title")).toHaveText("Image");
  await expect(bar.getByRole("button", { name: "Open", exact: true })).toHaveText("Open");
  await expect(bar.getByRole("button", { name: "Replace" })).toBeVisible();
  await bar.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".rm-lightbox-title")).toHaveText("first.png");
  await page.keyboard.press("Escape");

  // Description: one document edit, capped at 500 behind the field.
  await bar.getByRole("button", { name: "Description" }).click();
  const field = page.getByRole("textbox", { name: "Description" });
  await field.fill("Sales funnel");
  await page.keyboard.press("Meta+Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Probe).__remo.widgets.find((w) => w.type === "image")?.alt,
      ),
    )
    .toBe("Sales funnel");

  // Replace: same object, new file, and the upload's own object does not survive.
  const replacement = await makePng(page, 300, 300);
  const replacing = page.waitForEvent("filechooser");
  await bar.getByRole("button", { name: "Replace" }).click();
  await (await replacing).setFiles([
    { name: "second.png", mimeType: "image/png", buffer: replacement },
  ]);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Probe).__remo.widgets.find((w) => w.type === "image")?.naturalWidth,
      ),
    )
    .toBe(300);
  const after = await imageList(page);
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(before.id);
  expect(after[0]!.width).toBe(480);
  expect(after[0]!.height).toBe(480);

  await bar.getByRole("button", { name: "More" }).click();
  const [original] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Download original" }).click(),
  ]);
  const bytes = await buffer(await original.createReadStream());
  expect(bytes.toString("ascii", 1, 4)).toBe("PNG");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([300, 300]);

  // Original size: the picture's own pixels, capped at 2048.
  await bar.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: /Original size/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as Probe).__remo.widgets.find((w) => w.type === "image")?.width,
      ),
    )
    .toBe(300);

  // The viewer opens from the bar and from a double click, and Escape returns focus.
  await bar.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".rm-lightbox")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Sales funnel");
  await expect(page.getByRole("dialog").getByText("Scroll to zoom, drag to move", { exact: true })).toBeVisible();
  await expect(page.locator(".rm-lightbox-title")).toHaveText("second.png");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Download", exact: true }))
    .toHaveText("Download");
  await page.keyboard.press("Escape");
  await expect(page.locator(".rm-lightbox")).toHaveCount(0);

  const point = await page.evaluate((id) => {
    const probe = (window as unknown as Probe).__remo;
    const widget = probe.widgets.find((entry) => entry.id === id)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (widget.x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (widget.y - probe.camera.y) * probe.camera.zoom,
    };
  }, before.id);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator(".rm-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".rm-lightbox")).toHaveCount(0);

  await ensureProperties(page);
  await openFold(page, "Name and link");
  const objectName = page.locator(".object-name-field input");
  await objectName.fill("Chosen object name");
  await objectName.press("Enter");
  await bar.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".rm-lightbox-title")).toHaveText("Chosen object name");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Meta+Shift+l");
  await expect(page.locator(".badge-lock")).toHaveCount(1);
  await expect(bar.getByRole("button", { name: "Replace" })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Description" })).toBeDisabled();
  await bar.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".rm-lightbox")).toBeVisible();
  await page.keyboard.press("Escape");

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: /^(?:Export|Экспорт)/ }).click();
  const exportDialog = page.locator(".export-dialog");
  await exportDialog.getByRole("radio", {name: /Room backup/}).click();
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    exportDialog.getByRole("button", {name:"Download backup", exact: true}).click(),
  ]);
  const bundle = JSON.parse(await text(await backup.createReadStream()));
  expect(bundle.widgets[before.id]).toMatchObject({type:"image", alt: "Sales funnel"});
});
