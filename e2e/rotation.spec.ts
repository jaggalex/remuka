import { expect, test, type Page } from "@playwright/test";
import {
  PASSWORD,
  freshBoard,
  seedConnector,
  seedObject,
  waitForBoardEditor,
  type Account,
} from "./helpers";

/**
 * Rotation (ADR-271, ADR-283, T18).
 *
 * The canvas has no DOM nodes, so every gesture is the same pointer sequence a person
 * makes: press the round handle, move, release. The angle is read from the dev probe,
 * and the geometry assertions use the same conventions the model uses (a degree is
 * clockwise, the centre never moves).
 */

interface View {
  camera: { x: number; y: number; zoom: number };
  rect: { left: number; top: number; width: number; height: number };
}

interface ProbeWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text?: string | null;
}

async function view(page: Page): Promise<View> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __remo: { camera: View["camera"] } }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe.camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

function toClient(current: View, world: { x: number; y: number }) {
  return {
    x: current.rect.left + current.rect.width / 2 + (world.x - current.camera.x) * current.camera.zoom,
    y: current.rect.top + current.rect.height / 2 + (world.y - current.camera.y) * current.camera.zoom,
  };
}

/** Clockwise degrees, matching the product's stored unit (y grows down). */
function rotate(point: { x: number; y: number }, centre: { x: number; y: number }, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  return {
    x: centre.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: centre.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function widgets(page: Page): Promise<ProbeWidget[]> {
  return page.evaluate(
    () => (window as unknown as { __remo: { widgets: ProbeWidget[] } }).__remo.widgets,
  );
}

async function widget(page: Page, id: string): Promise<ProbeWidget> {
  await expect
    .poll(async () => (await widgets(page)).some((entry) => entry.id === id))
    .toBe(true);
  return (await widgets(page)).find((entry) => entry.id === id)!;
}

async function selected(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  );
}

async function selectAt(page: Page, world: { x: number; y: number }): Promise<void> {
  const point = toClient(await view(page), world);
  await page.mouse.click(point.x, point.y);
}

/** The round handle: 14 px stem plus a 5 px radius, above the middle of the top side. */
function handleWorld(entry: ProbeWidget, zoom: number) {
  const centre = { x: entry.x, y: entry.y };
  const local = { x: 0, y: -entry.height / 2 - 19 / zoom };
  return rotate(local, { x: 0, y: 0 }, entry.rotation);
}

async function dragHandle(
  page: Page,
  entry: ProbeWidget,
  degrees: number,
  options: { shift?: boolean; settle?: boolean } = {},
): Promise<void> {
  const current = await view(page);
  const centre = { x: entry.x, y: entry.y };
  const local = handleWorld(entry, current.camera.zoom);
  const start = { x: centre.x + local.x, y: centre.y + local.y };
  const end = rotate(start, centre, degrees);
  const from = toClient(current, start);
  const to = toClient(current, end);
  if (options.shift) await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  if (options.shift) await page.keyboard.up("Shift");
  if (options.settle !== false) {
    await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  }
}

function idempotency(): Record<string, string> {
  return { "Idempotency-Key": `e2e-rotate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
}

async function setRotation(
  page: Page,
  boardId: string,
  id: string,
  rotation: number,
): Promise<void> {
  const response = await page.request.post(`/api/boards/${boardId}/commands`, {
    headers: idempotency(),
    data: { command: "board.item.update", input: { id, patch: { rotation } } },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect
    .poll(async () => (await widget(page, id)).rotation)
    .toBe(rotation);
}

async function undo(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
}

test("the handle turns a shape, Shift steps by 15°, the keys too, and one undo returns", async ({
  page,
}) => {
  const account = await freshBoard(page, "rotation-handle", { template: "empty" });
  const id = await seedObject(page, account.boardId, {
    type: "shape",
    x: 0,
    y: 0,
    width: 220,
    height: 120,
    content: "Проверка",
  });
  await waitForBoardEditor(page);
  await selectAt(page, { x: 0, y: 0 });
  expect(await selected(page)).toEqual([id]);

  await dragHandle(page, await widget(page, id), -12);
  await expect.poll(async () => Math.round((await widget(page, id)).rotation)).toBe(-12);

  await undo(page);
  await expect.poll(async () => (await widget(page, id)).rotation).toBe(0);

  await dragHandle(page, await widget(page, id), -12, { shift: true });
  await expect.poll(async () => Math.round((await widget(page, id)).rotation)).toBe(-15);

  await dragHandle(page, await widget(page, id), -12, { shift: true });
  await expect.poll(async () => Math.round((await widget(page, id)).rotation)).toBe(-30);

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+ArrowRight" : "Control+Shift+ArrowRight",
  );
  await expect.poll(async () => Math.round((await widget(page, id)).rotation)).toBe(-15);

  // One keystroke, one undo step.
  await undo(page);
  await expect.poll(async () => Math.round((await widget(page, id)).rotation)).toBe(-30);

  // The registry is the menu: rotate 90 and reset are not hand-written items.
  const centre = { x: 0, y: 0 };
  const point = toClient(await view(page), centre);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByRole("menuitem", { name: "Rotate 90°", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reset rotation", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Rotate 90°", exact: true }).click();
  await expect.poll(async () => Math.round((await widget(page, id)).rotation)).toBe(60);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Reset rotation", exact: true }).click();
  await expect.poll(async () => (await widget(page, id)).rotation).toBe(0);
});

test("a click and a marquee follow the turned outline, not its described box", async ({ page }) => {
  const account = await freshBoard(page, "rotation-hit", { template: "empty" });
  const id = await seedObject(page, account.boardId, {
    type: "shape",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });
  await waitForBoardEditor(page);
  await setRotation(page, account.boardId, id, 45);

  // The corner of the axis-aligned box is empty board.
  await selectAt(page, { x: 68, y: -68 });
  expect(await selected(page)).toEqual([]);

  // A point on the turned edge belongs to the object.
  await selectAt(page, { x: 0, y: -49 });
  expect(await selected(page)).toEqual([id]);

  // A marquee over only the empty corner takes nothing.
  await selectAt(page, { x: 500, y: 500 });
  const current = await view(page);
  const from = toClient(current, { x: 60, y: -78 });
  const to = toClient(current, { x: 78, y: -60 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  expect(await selected(page)).toEqual([]);

  // A marquee over the middle takes it.
  const middle = toClient(current, { x: -20, y: -20 });
  const middleEnd = toClient(current, { x: 20, y: 20 });
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(middleEnd.x, middleEnd.y, { steps: 8 });
  await page.mouse.up();
  expect(await selected(page)).toEqual([id]);
});

test("a turned shape resizes in its own axes: the opposite corner stays, Shift keeps the ratio", async ({
  page,
}) => {
  const account = await freshBoard(page, "rotation-resize", { template: "empty" });
  const id = await seedObject(page, account.boardId, {
    type: "shape",
    x: 0,
    y: 0,
    width: 160,
    height: 100,
  });
  await waitForBoardEditor(page);
  await setRotation(page, account.boardId, id, 30);
  await selectAt(page, { x: 0, y: 0 });
  expect(await selected(page)).toEqual([id]);

  const before = await widget(page, id);
  const current = await view(page);
  const zoom = current.camera.zoom;
  const gap = 7 / zoom;
  const centre = { x: before.x, y: before.y };
  const seLocal = { x: before.width / 2 + gap, y: before.height / 2 + gap };
  const se = rotate(seLocal, { x: 0, y: 0 }, before.rotation);
  const nwLocal = { x: -before.width / 2, y: -before.height / 2 };
  const nwBefore = rotate(nwLocal, { x: 0, y: 0 }, before.rotation);

  const start = toClient(current, { x: centre.x + se.x, y: centre.y + se.y });
  const localDelta = { x: 24, y: 16 };
  const turnedDelta = rotate(localDelta, { x: 0, y: 0 }, before.rotation);
  const end = toClient(current, {
    x: centre.x + se.x + turnedDelta.x,
    y: centre.y + se.y + turnedDelta.y,
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });

  const after = await widget(page, id);
  expect(after.width).toBeGreaterThan(before.width + 10);
  expect(after.height).toBeGreaterThan(before.height + 5);
  // The new box's own north-west corner, in the world: it must be the old one.
  const nwAfterLocal = rotate(
    { x: -after.width / 2, y: -after.height / 2 },
    { x: 0, y: 0 },
    after.rotation,
  );
  const nwAfter = { x: after.x + nwAfterLocal.x, y: after.y + nwAfterLocal.y };
  expect(Math.hypot(nwAfter.x - nwBefore.x, nwAfter.y - nwBefore.y)).toBeLessThan(1);

  // Shift: the proportion is kept exactly, whatever the pointer says.
  const ratioBefore = after.width / after.height;
  const again = await view(page);
  const seAgain = rotate(
    { x: after.width / 2 + gap, y: after.height / 2 + gap },
    { x: 0, y: 0 },
    after.rotation,
  );
  const startAgain = toClient(again, { x: after.x + seAgain.x, y: after.y + seAgain.y });
  const endAgain = toClient(again, {
    x: after.x + seAgain.x + 40 * Math.cos((after.rotation * Math.PI) / 180),
    y: after.y + seAgain.y + 40 * Math.sin((after.rotation * Math.PI) / 180),
  });
  await page.keyboard.down("Shift");
  await page.mouse.move(startAgain.x, startAgain.y);
  await page.mouse.down();
  await page.mouse.move(endAgain.x, endAgain.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  const shifted = await widget(page, id);
  expect(Math.abs(shifted.width / shifted.height - ratioBefore)).toBeLessThan(0.03);
});

test("three objects turn about one common centre, and text turns with its object", async ({
  page,
}) => {
  const account = await freshBoard(page, "rotation-block", { template: "empty" });
  const ids = [
    await seedObject(page, account.boardId, {
      type: "sticky_note",
      x: -200,
      y: 0,
      width: 100,
      height: 100,
      content: "A",
    }),
    await seedObject(page, account.boardId, {
      type: "sticky_note",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      content: "B",
    }),
    await seedObject(page, account.boardId, {
      type: "sticky_note",
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      content: "C",
    }),
  ];
  await waitForBoardEditor(page);
  const current = await view(page);
  // Start the marquee above the arrange bar: the bar owns the space just above the
  // block, and a press there would never reach the canvas.
  const from = toClient(current, { x: -300, y: -300 });
  const to = toClient(current, { x: 300, y: 300 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  expect(new Set(await selected(page))).toEqual(new Set(ids));

  const before = await widgets(page);
  const members = before.filter((entry) => ids.includes(entry.id));
  const handle = {
    x: 0,
    y: Math.min(...members.map((entry) => entry.y - entry.height / 2)) - 19 / current.camera.zoom,
  };
  const start = toClient(current, handle);
  const end = toClient(current, rotate(handle, { x: 0, y: 0 }, 90));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });

  const after = await widgets(page);
  for (const original of members) {
    const turned = after.find((entry) => entry.id === original.id)!;
    expect(Math.round(turned.rotation)).toBe(90);
    const expected = rotate({ x: original.x, y: original.y }, { x: 0, y: 0 }, 90);
    expect(Math.abs(turned.x - expected.x)).toBeLessThan(1);
    expect(Math.abs(turned.y - expected.y)).toBeLessThan(1);
  }

  // A text object opens its editor at the same angle as the paint.
  const note = after.find((entry) => entry.id === ids[1]!)!;
  await selectAt(page, { x: note.x, y: note.y });
  const point = toClient(await view(page), { x: note.x, y: note.y });
  await page.mouse.dblclick(point.x, point.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  // The block was turned 90°: the editor's matrix is the same quarter turn, not an
  // axis-aligned box laid over a turned object (T18 acceptance 5).
  await expect(editor).toHaveCSS("transform", /matrix\(0, 1, -1, 0/);
  await page.keyboard.press("Escape");
});

test("a connector stays on the turned contour and a second participant sees the angle", async ({
  page,
  browser,
}) => {
  const account: Account = await freshBoard(page, "rotation-share", { template: "empty" });
  const origin = new URL(page.url()).origin;
  const fromId = await seedObject(page, account.boardId, {
    type: "shape",
    x: -200,
    y: 0,
    width: 160,
    height: 100,
  });
  const toId = await seedObject(page, account.boardId, {
    type: "sticky_note",
    x: 200,
    y: 0,
    width: 160,
    height: 120,
    content: "Проверка",
  });
  await waitForBoardEditor(page);
  await seedConnector(page, account.boardId, fromId, toId);
  await setRotation(page, account.boardId, fromId, 45);

  // The object under the pointer is the turned shape only where its contour is:
  // clicking the empty AABB corner must not select it, the contour must.
  const shape = await widget(page, fromId);
  // The left-side midpoint: on the contour, away from the line that leaves towards the
  // sticky and from the round handle (T18).
  const edge = rotate({ x: -shape.width / 2, y: 0 }, { x: 0, y: 0 }, shape.rotation);
  await selectAt(page, { x: shape.x + edge.x, y: shape.y + edge.y });
  expect(await selected(page)).toContain(fromId);

  // A second account with an editor grant opens the same room and reads the same angle.
  const second = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const email = `e2e-rotation-${Date.now()}@example.com`;
  const registered = await second.request.post("/api/auth/register", {
    data: { email, password: PASSWORD, name: "Editor" },
  });
  const editor = (await registered.json()) as { user: { id: string } };
  const invite = await page.request.post(`/api/orgs/${account.orgId}/invitations`, { data: { email } });
  const invited = (await invite.json()) as { url: string };
  await second.request.post("/api/invitations/accept", {
    data: { token: new URL(invited.url).searchParams.get("invite") },
  });
  await page.request.post(`/api/boards/${account.boardId}/grants`, {
    data: { subjectType: "user", subjectId: editor.user.id, role: "editor" },
  });
  const editorPage = await second.newPage();
  await editorPage.goto(
    `${origin}/?room=${account.boardId}&lang=en&user=Editor&select=${fromId}`,
  );
  await waitForBoardEditor(editorPage);
  await expect
    .poll(async () => (await widget(editorPage, fromId)).rotation)
    .toBe(45);
  await second.close();
});

test("an old-document patch keeps the angle, and a template with a turn is read", async ({ page }) => {
  const account = await freshBoard(page, "rotation-legacy", { template: "empty" });
  const id = await seedObject(page, account.boardId, {
    type: "sticky_note",
    x: 0,
    y: 0,
    width: 160,
    height: 180,
    content: "Идея",
    rotation: -12,
  });
  await waitForBoardEditor(page);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await expect.poll(async () => (await widget(page, id)).rotation).toBe(-12);

  // A legacy writer that patches another field must not zero the angle: the command
  // merges into the stored record (ADR-271 compatibility).
  const response = await page.request.post(`/api/boards/${account.boardId}/commands`, {
    headers: idempotency(),
    data: {
      command: "board.item.update",
      input: { id, patch: { style: { fillColor: "#cddff8" } } },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect.poll(async () => (await widget(page, id)).rotation).toBe(-12);

  // The projection returns the real value to an agent token or the read API. The
  // relational mirror lands a moment after the save acknowledgement.
  await expect
    .poll(async () => {
      const read = await page.request.get(`/api/boards/${account.boardId}/widgets`);
      if (!read.ok()) return null;
      const body = (await read.json()) as { widgets: Array<{ id: string; rotation: number }> };
      return body.widgets.find((entry) => entry.id === id)?.rotation ?? null;
    })
    .toBe(-12);
});

test("calm motion has nothing to animate on the rotation handle", async ({ page }) => {
  const account = await freshBoard(page, "rotation-calm", { template: "empty" });
  const id = await seedObject(page, account.boardId, {
    type: "shape",
    x: 0,
    y: 0,
    width: 200,
    height: 120,
  });
  await waitForBoardEditor(page);
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "calm";
  });
  await selectAt(page, { x: 0, y: 0 });
  expect(await selected(page)).toEqual([id]);

  // The handle is painted, not a DOM element: no transition or animation can run.
  const animated = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".canvas-wrap *")).some((node) => {
      const style = getComputedStyle(node);
      return (
        node.classList.contains("rotation-handle") ||
        (style.animationName !== "none" && /rotate|handle/i.test(style.animationName)) ||
        (/rotate/.test(style.transitionProperty) && style.transitionDuration !== "0s")
      );
    }),
  );
  expect(animated).toBe(false);
});

test("a connector rebuilds while the handle is still held (T18 acceptance 4)", async ({ page }) => {
  const account = await freshBoard(page, "rotation-live-line", { template: "empty" });
  const shapeId = await seedObject(page, account.boardId, {
    type: "shape",
    x: -200,
    y: 0,
    width: 160,
    height: 100,
    content: "A",
  });
  const noteId = await seedObject(page, account.boardId, {
    type: "sticky_note",
    x: 200,
    y: 0,
    width: 160,
    height: 120,
    content: "B",
  });
  await waitForBoardEditor(page);
  const lineId = await seedConnector(page, account.boardId, shapeId, noteId);
  await selectAt(page, { x: -200, y: 0 });
  expect(await selected(page)).toEqual([shapeId]);

  const current = await view(page);
  const shape = await widget(page, shapeId);
  const local = handleWorld(shape, current.camera.zoom);
  const centre = { x: shape.x, y: shape.y };
  const start = { x: centre.x + local.x, y: centre.y + local.y };
  const point = (degrees: number) => {
    const world = rotate(start, centre, degrees);
    return toClient(current, world);
  };
  const startClient = toClient(current, start);
  const path = () =>
    page.evaluate(
      (id) =>
        (window as unknown as {
          __remo: { connectorPath: (id: string) => Array<{ x: number; y: number }> | null };
        }).__remo.connectorPath(id),
      lineId,
    );

  await page.mouse.move(startClient.x, startClient.y);
  await page.mouse.down();
  await page.mouse.move(point(-30).x, point(-30).y, { steps: 8 });
  await page.waitForTimeout(120);
  const first = await path();
  await page.mouse.move(point(-60).x, point(-60).y, { steps: 8 });
  await page.waitForTimeout(120);
  const second = await path();
  expect(first && second).toBeTruthy();
  // The shape is the start of the line; its anchor is what turns.
  const startOf = (points: Array<{ x: number; y: number }> | null) => points![0]!;
  expect(
    Math.hypot(startOf(first).x - startOf(second).x, startOf(first).y - startOf(second).y),
  ).toBeGreaterThan(10);

  await page.mouse.up();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  const settled = await path();
  expect(
    Math.hypot(startOf(settled).x - startOf(second).x, startOf(settled).y - startOf(second).y),
  ).toBeLessThan(2);
});
