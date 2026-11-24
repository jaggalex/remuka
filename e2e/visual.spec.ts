import { 
readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  addSticky,
  agentBoard,
  applyDefaultTableLayout,
  ensureProperties,
  freshBoard,
  goAllRooms,
  openAccount,
  openAgentMenu,
  openBoard,
  openBoardMenu,
  openFacilitation,
  openFold,
  openPeople,
  register,
  savedAfterEdit,
  seedConnector,
  seedNote,
  seedObject,
  seedStableNote,
  selectKanbanCard,
  setAccountTheme,
  watchSave,
} from "./helpers";

/**
 * Visual evidence and screen contracts (roadmap Q2.1).
 *
 * PNGs in `spec/baselines/` are compared in the Linux browser (`pnpm e2e:visual`,
 * ADR-222) and regenerated on purpose with `pnpm baselines`. On any other browser the
 * comparison is skipped, because a diff there means "another platform" (ADR-091); the
 * invariants below run everywhere: connector pixels are sampled where the routing must
 * differ, and every dialog must fit the viewport without horizontal overflow.
 */
const linuxBrowser = Boolean(process.env.REMO_BROWSER_WS);
/**
 * Same binary, software rendering: repeated runs are pixel-identical. A ratio was too
 * loose — 0.2 % of the timer dialog is ~400 px, more than its digits moving by 4 px.
 * Twenty pixels leave room for a stray antialiased edge and nothing larger.
 */
const MAX_DIFF_PIXELS = 20;
/**
 * Per-pixel colour threshold (ADR-238). Playwright ignores a difference up to about
 * 264 × threshold grey levels: 0.03 ≈ 8 levels, four times the measured run-to-run noise
 * (2 levels) and well under a faint real change such as the M12 grid (31 levels). The
 * default 0.2 (≈ 52 levels) let that grid pass unseen.
 */
const PIXEL_THRESHOLD = 0.03;

async function capture(
  page: Page,
  target: ReturnType<Page["locator"]>,
  name: string,
  mask: ReturnType<Page["locator"]>[] = [],
  maskAvatar = true,
) {
  if (!linuxBrowser) return;
  // Every scenario registers a fresh account, and the avatar's colour follows the account.
  // An overlay capture turns the mask into a pink rectangle showing through the scrim, so
  // it can opt out; its account has a fixed name and therefore a stable avatar.
  const avatar = page.locator(".account-button");
  // The people group shows the same browser-local presence colour as the avatar, so it
  // is masked with it: a fresh context picks a new colour every run (ADR-078).
  const people = page.locator(".people-trigger");
  const peopleFaces = page.locator(".people-list .rm-avatar");
  await expect(target).toHaveScreenshot(`${name}.png`, {
    maxDiffPixels: MAX_DIFF_PIXELS,
    threshold: PIXEL_THRESHOLD,
    mask: [...(maskAvatar ? [avatar, people, peopleFaces] : []), ...mask],
  });
}

/** A region of the page rather than an element: a row of the canvas, the bottom edge. */
async function captureClip(page: Page,
  name: string,
  clip: { x: number; y: number; width: number; height: number },
  mask: ReturnType<Page["locator"]>[] = [],
) {
  if (!linuxBrowser) return;
  await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixels: MAX_DIFF_PIXELS, threshold: PIXEL_THRESHOLD, clip, mask });
}

/** Calm animations: no cursor spring, no breathing over an agent plan (ADR-265 §4.2). */
async function calmMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "calm";
  });
  // One more frame paints the still picture; until then the overlay holds the old alpha.
  await page.waitForTimeout(350);
}

async function loudMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete document.documentElement.dataset.motion;
  });
}

/** A real PNG, drawn in the page: the upload checks signatures, not extensions. */
async function makePng(page: Page, width = 900, height = 600): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(20, 20, 120, 120);
      ctx.fillStyle = "#f0c040";
      ctx.fillRect(width - 160, height - 160, 100, 100);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!), "image/png"),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { width, height },
  );
  return Buffer.from(bytes);
}

/** The theme is a browser preference; the captures need both without a reload. */
async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem("remo.theme", value);
    document.documentElement.dataset.theme = value;
  }, theme);
}

/** A picture through the rail, as a person adds it (`spec/images.md` §9.1). */
async function uploadImage(page: Page, png: Buffer, name = "diagram.png"): Promise<void> {
  const rail = page.getByRole("toolbar", { name: "Tools" });
  const chooser = page.waitForEvent("filechooser");
  await rail.getByRole("button", { name: "Image", exact: true }).click();
  await (await chooser).setFiles([{ name, mimeType: "image/png", buffer: png }]);
}

function canvasPixels(page: Page) {
  return page.locator("[data-testid=connector-states] canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dark = (x: number, y: number) => {
      const index = (y * width + x) * 4;
      return data[index]! < 80 && data[index + 1]! < 80 && data[index + 2]! < 80;
    };
    const count = (fromX: number, toX: number, fromY: number, toY: number) => {
      let total = 0;
      for (let y = fromY; y < toY; y += 1) {
        for (let x = fromX; x < toX; x += 1) if (dark(x, y)) total += 1;
      }
      return total;
    };
    const signature = (fromY: number, toY: number) => {
      const cells: number[] = [];
      for (let row = 0; row < 5; row += 1) {
        for (let column = 0; column < 12; column += 1) {
          const x0 = 200 + column * 30;
          const y0 = fromY + row * ((toY - fromY) / 5);
          cells.push(count(x0, x0 + 30, y0, y0 + (toY - fromY) / 5));
        }
      }
      return cells.join(",");
    };
    return {
      // Between the notes, so the sticky text and borders are out of the sample.
      straight: count(300, 460, 84, 96),
      curved: count(300, 460, 350, 400),
      signatures: {
        straight: signature(60, 120),
        elbow: signature(180, 300),
        curved: signature(320, 430),
      },
      size: { width: canvas.width, height: canvas.height },
    };
  });
}

test("three connector routings paint differently", async ({ page }) => {
  await page.goto("/__ds?view=connectors&lang=en");
  await expect(page.locator("[data-testid=connector-states]")).toHaveAttribute("data-ready", "true");
  const canvas = page.locator("[data-testid=connector-states] canvas");
  await expect(canvas).toBeVisible();

  const pixels = await canvasPixels(page);
  await capture(page, page.locator("[data-testid=connector-states]"), "connectors");
  // The stage-1 debt named three baselines; each row is also its own file so a review
  // can look at one routing without hunting inside the overview.
  const box = await page.locator("[data-testid=connector-states] canvas").boundingBox();
  if (box) {
    for (const [name, top, height] of [
      ["straight", 30, 120],
      ["elbow", 160, 160],
      ["curved", 300, 155],
    ] as const) {
      await captureClip(page, `connector-${name}`, { x: box.x, y: box.y + top, width: box.width, height });
    }
  }
  console.log("connector pixels", pixels);

  expect(pixels.size).toEqual({ width: 760, height: 460 });
  // Every routing paints, the waypoint is on the line, and the three shapes are not the
  // same geometry rendered three times.
  expect(pixels.straight).toBeGreaterThan(100);
  expect(pixels.curved).toBeGreaterThan(100);
  expect(new Set(Object.values(pixels.signatures)).size).toBe(3);
});

test("a locked object carries the canvas lock badge", async ({ page }) => {
  await freshBoard(page, "lock-badge", { template: "empty" });
  // A fixed id: the note's tilt is a hash of its id (ADR-265 §3.2) and this picture is
  // compared byte for byte; the lock badge sits on the note's corner.
  const id = await seedStableNote(page, { id: "lock-badge-note", x: 0, y: 0, text: "Note" });
  await zoomInToReadable(page);
  const view = await canvasView(page);
  const point = clientPoint(view, { x: 0, y: 0 });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toEqual([id]);
  await page.keyboard.press("Meta+Shift+l");
  await expect(page.locator(".badge-lock")).toHaveCount(1);
  // The selection badge is a DOM plate over the note's corner; clear it so the
  // canvas mark, not the plate, is what the baseline records (ADR-193). Wait for the
  // plate to leave the DOM: a slow runner otherwise captured it mid-removal.
  await page.keyboard.press("Escape");
  await expect(page.locator(".selection-badge")).toHaveCount(0);
  // A single note makes the camera fit it at >400 %; step back to a normal zoom so
  // the 16 px mark is read against the object, not against a magnified canvas.
  for (let step = 0; step < 8; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  await page.mouse.move(700, 500);
  // The hand spring settles the note back to its own tilt; the capture must not catch it
  // mid-settle (ADR-265 §4.2).
  await page.waitForTimeout(400);
  await capture(page, page.locator("body"), "lock-badge");
});

test("the board, export, timer and vote screens fit the viewport", async ({ page }) => {
  const account = await freshBoard(page, "visual");
  await addSticky(page);

  const overflow = async () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
      offenders: [...document.querySelectorAll("*")]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName,
          className: String((element as HTMLElement).className).slice(0, 60),
          right: Math.round(element.getBoundingClientRect().right),
        })),
    }));
  const fits = async () => {
    const metrics = await overflow();
    console.log("viewport", metrics);
    return metrics.scrollWidth <= metrics.innerWidth;
  };
  expect(await fits()).toBe(true);
  await capture(page, page.locator("body"), "board");

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await expect(page.locator(".export-dialog")).toBeVisible();
  expect(await page.locator(".export-dialog .export-choice").count()).toBeGreaterThanOrEqual(5);
  expect(await fits()).toBe(true);
  const exportDialog = page.getByRole("dialog", { name: "Export" });
  await capture(page, exportDialog, "export");
  // The header close of Dialog comes first; the footer has its own "Close".
  await exportDialog.getByRole("button", { name: "Close", exact: true }).first().click();

  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await expect(page.locator(".timer-dialog")).toBeVisible();
  await page.getByRole("button", { name: "5 min", exact: true }).click();
  // The running countdown is a chip beside Run; the menu row stays one word
  // (ADR-266 amendment: states are not items).
  await expect(page.locator(".topbar .session-chip").first()).toContainText(/^\d{2}:\d{2}$/);
  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Timer/ }).click();
  await expect(page.locator(".timer-face")).toBeVisible();
  await capture(page, page.getByRole("dialog", { name: "Shared timer" }), "timer");
  await page.getByRole("dialog", { name: "Shared timer" }).getByRole("button", { name: "Close", exact: true }).click();

  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: ["obj-a", "obj-b"], votesPerSubject: 2, minutes: 10, anonymous: true },
  });
  expect(created.status()).toBe(201);
  await openFacilitation(page);
  await page.getByRole("menuitem", { name: /Voting/ }).click();
  const vote = page.getByRole("dialog", { name: "Voting session" });
  await expect(vote).toBeVisible();
  await expect(page.locator(".vote-list li")).toHaveCount(2);
  expect(await fits()).toBe(true);
  await capture(page, vote, "vote");
});

test("a card with fields is readable", async ({ page }) => {
  await freshBoard(page, "visual-card");
  // ADR-197: the helper opens the inspector, then selects a placed card and waits
  // for the selection to land, so a resize cannot leave the click on a stale point.
  await selectKanbanCard(page);

  const fields = page.locator(".card-fields");
  await fields.locator("select").first().selectOption("in_progress");
  await fields.locator('input[type="date"]').first().fill("2026-10-30");
  await fields.locator('input[type="date"]').nth(1).fill("2026-10-31");
  // A tag on the card, drawn as a chip on its face (ADR-106).
  await openFold(page, "Tags");
  const tags = page.locator(".tags-panel");
  await tags.locator(".tag-add input").fill("Priority");
  await tags.locator(".tag-add button").click();
  await tags.locator(".tag-assign input[type=checkbox]").first().check();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });

  // The date fields fit the panel and show their whole date (E-16): a field neither
  // crosses the panel's content edge nor clips its own text under the calendar button.
  const dates = await page.locator("aside.inspector").evaluate((panel) => {
    const style = getComputedStyle(panel);
    const box = panel.getBoundingClientRect();
    const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    // A date input's text lives in its shadow parts, out of reach of scrollWidth: measure the
    // date as the browser shows it, in the input's own font, plus the 16 px picker button.
    const context = document.createElement("canvas").getContext("2d")!;
    return [...panel.querySelectorAll<HTMLInputElement>(".card-dates input")].map((input) => {
      context.font = getComputedStyle(input).font;
      const shown = new Date(`${input.value}T00:00`).toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      });
      return {
        past: Math.round(input.closest(".rm-input")!.getBoundingClientRect().right - right),
        clipped: Math.ceil(context.measureText(shown).width + 16 - input.clientWidth),
      };
    });
  });
  expect(dates.length).toBe(2);
  for (const date of dates) {
    expect(date.past, "a date field ends inside the panel").toBeLessThanOrEqual(0);
    expect(date.clipped, "a date field shows its whole date").toBeLessThanOrEqual(0);
  }

  await capture(page, page.locator(".layer.board"), "card-fields");
  await fields.locator('input[type="date"]').nth(1).blur();
  await capture(page, fields, "card-fields-panel");
});

test("the properties panel describes one subject (ADR-236)", async ({ page }) => {
  await freshBoard(page, "visual-panel");
  await ensureProperties(page);
  const panel = page.locator("aside.inspector");

  // Nothing selected: the room, its counts and the card filter, and nothing else.
  await expect(panel.locator(".inspector-kicker")).toHaveText("Room");
  await expect(panel.locator(".counts li").first()).toBeVisible();
  await expect(panel.locator(".card-filter")).toBeVisible();
  await expect(panel.locator(".kanban-state, .inspector-tech, .scope")).toHaveCount(0);
  await capture(page, panel, "panel-room");

  // A selected kanban: its state, without the room's counts or filter.
  const url = new URL(page.url());
  const kanbanId = await page.evaluate(
    () =>
      (window as unknown as { __remo: { widgets: Array<{ id: string; type: string }> } }).__remo.widgets.find(
        (widget) => widget.type === "kanban",
      )!.id,
  );
  url.searchParams.set("select", kanbanId);
  await page.goto(url.toString());
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  if (!(await panel.isVisible())) await ensureProperties(page);
  await expect(panel.locator(".kanban-state")).toBeVisible();
  await expect(panel.locator(".counts, .card-filter")).toHaveCount(0);
  await capture(page, panel, "panel-kanban");
});

/**
 * The rail and the bottom edge (ADR-119, §10.4).
 *
 * The rail is a panel of its own, every enabled tool is one colour, and the bottom-centre
 * plate never shares its slot with the zoom controls. All of that is geometry and
 * computed style, so it holds without a byte comparison; the PNGs are for the review.
 */
test("the rail is one panel and the bottom edge stays clear", async ({ page }) => {
  const account = await freshBoard(page, "visual-rail");
  // A fixed id: the note's tilt is a hash of its id (ADR-265 §3.2), and this picture is
  // compared byte for byte. The note is a subject of the vote counters below; creation
  // itself has its own scenarios.
  const origin = await page.evaluate(
    () => (window as unknown as { __remo: { camera: { x: number; y: number } } }).__remo.camera,
  );
  const stickyId = await seedStableNote(page, {
    id: "visual-rail-note",
    x: origin.x - 200,
    y: origin.y - 150,
    text: "Note",
  });
  // The hint is a first-use plate: show it for this frame, whatever ran before.
  await page.evaluate(() => window.localStorage.removeItem("remo.canvas.hint"));
  await page.reload();
  // The plate is a six-second first-use hint: wait for it, not for the document. Waiting
  // for the ack first made the measurement race the hint's own timer on a slow run.
  await expect(page.locator(".canvas-hint")).toBeVisible({ timeout: 5_000 });

  const frame = () =>
    page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      const touches = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
        Boolean(a && b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom);
      const hud = box(".canvas-hud");
      const hint = box(".canvas-hint");
      const rail = box(".tool-rail");
      const panel = document.querySelector(".tool-rail-panel");
      const colours = [...document.querySelectorAll(".tool-rail .rm-iconbtn")].map((icon) => ({
        disabled: (icon as HTMLButtonElement).disabled,
        // The resting selection tool is the one pressed control on the rail.
        selected: icon.getAttribute("aria-pressed") === "true",
        colour: getComputedStyle(icon).color,
      }));
      const hintElement = document.querySelector<HTMLElement>(".canvas-hint");
      return {
        hud,
        hint,
        rail,
        hudAndHint: touches(hud, hint),
        hintClipped: hintElement ? hintElement.scrollWidth > hintElement.clientWidth + 1 : false,
        hintWraps: hintElement ? getComputedStyle(hintElement).whiteSpace : null,
        panels: document.querySelectorAll(".tool-rail-panel").length,
        railBorder: panel ? getComputedStyle(panel).borderTopWidth : "",
        railRadius: panel ? getComputedStyle(panel).borderRadius : "",
        tools: colours
          .filter((entry) => !entry.disabled && !entry.selected)
          .map((entry) => entry.colour),
        selected: colours.filter((entry) => entry.selected).map((entry) => entry.colour),
        stops: colours.filter((entry) => entry.disabled).map((entry) => entry.colour),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });

  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const state = await frame();
    expect(state.scrollWidth, `no horizontal overflow at ${width}`).toBeLessThanOrEqual(
      state.innerWidth,
    );
    expect(state.hudAndHint, `the hint does not touch the zoom controls at ${width}`).toBe(false);
    expect(state.hintClipped, `the hint is not cut with an ellipsis at ${width}`).toBe(false);
    expect(state.hintWraps, `the hint wraps at ${width}`).toBe("normal");
    expect(state.hud!.x, `the HUD stays inside the canvas at ${width}`).toBeGreaterThanOrEqual(0);
    expect(state.rail!.x, `the rail is 12 px off the edge at ${width}`).toBe(12);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await frame();
  // One panel of tools, one of history; a hairline is not a panel.
  expect(state.panels).toBe(2);
  // ADR-181: chrome is outlined, not lifted — the rail carries a hairline instead of a shadow.
  expect(state.railBorder).toBe("1px");
  expect(state.railRadius).not.toBe("0px");
  // Р1: one colour for every tool that works; the muted token only for real stops.
  // Access arrives after the first paint, so a tool can be dimmed for a frame and
  // transition into its colour; the rail settles on one colour for all of them.
  await expect
    .poll(async () => new Set((await frame()).tools).size, { timeout: 10_000 })
    .toBe(1);
  expect(new Set(state.selected).size, "the pressed tool paints the accent").toBe(1);
  expect(state.selected[0]).not.toBe(state.tools[0]);
  expect(state.stops.length, "history is the only stop on a fresh board").toBeGreaterThan(0);
  const muted = await page.evaluate(
    () => getComputedStyle(document.querySelector(".tool-rail .rm-btn:disabled")!).color,
  );
  expect(state.stops.every((colour) => colour === muted)).toBe(true);
  // A tool that can explain itself is not dimmed: the connector has no selection here.
  await expect(
    page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Connector" }),
  ).toBeEnabled();

  await capture(page, page.locator(".tool-rail"), "rail");
  // The zoom value depends on where the test's sticky landed before the first fit, which
  // varies by run; this picture is about the bottom edge's layout, so it is masked.
  await captureClip(page, "canvas-bottom", { x: 0, y: 900 - 120, width: 1440, height: 120 }, [
    page.locator(".rm-zoom-value"),
  ]);

  // The voting line uses the same slot and the hint steps aside (§10.4, Н1). The note
  // the test just made is in scope, next to its nearest neighbour, so the artefact shows
  // two counters that a person can point at.
  const ids = await page.evaluate(
    (sticky) => {
      const probe = window as unknown as {
        __remo: { widgets: Array<{ id: string; x: number; y: number }> };
      };
      const widgets = probe.__remo.widgets;
      const note = widgets.find((widget) => widget.id === sticky)!;
      const other = widgets
        .filter((widget) => widget.id !== sticky)
        .sort(
          (a, b) =>
            Math.hypot(a.x - note.x, a.y - note.y) - Math.hypot(b.x - note.x, b.y - note.y),
        )[0]!;
      return [sticky, other.id];
    },
    stickyId,
  );
  const created = await page.request.post(`/api/boards/${account.boardId}/vote-sessions`, {
    data: { objectIds: ids, votesPerSubject: 3, minutes: 10, anonymous: false },
  });
  expect(created.status()).toBe(201);
  await expect(page.locator(".vote-board-bar")).toBeVisible();

  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const withVote = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.x, right: rect.right };
      };
      const hud = box(".canvas-hud");
      const bar = box(".vote-board-bar");
      return {
        hint: Boolean(document.querySelector(".canvas-hint")),
        overlap: Boolean(hud && bar && hud.x < bar.right && bar.x < hud.right),
        inside: Boolean(bar && bar.right <= window.innerWidth && bar.x >= 0),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    expect(withVote.hint, `no hint while voting at ${width}`).toBe(false);
    expect(withVote.overlap, `the voting line clears the zoom controls at ${width}`).toBe(false);
    expect(withVote.inside, `the voting line fits at ${width}`).toBe(true);
    expect(withVote.scrollWidth).toBeLessThanOrEqual(withVote.innerWidth);
  }

  // Fitted, a note is smaller on screen than the full counter: the number and one "+" at
  // the 24 px minimum target, without the words, so nothing covers the object (ADR-235).
  // The session clock counts down while the run goes: masked, or a slow run fails on 09:58.
  const voteClock = page.locator(".vote-board-clock");
  const chips = page.locator(".vote-chip");
  await expect(chips.first()).toHaveClass(/compact/);
  await expect(chips.first().getByRole("button")).toHaveCount(1);
  await expect(chips.first().getByRole("button", { name: /Vote for/ })).toBeVisible();
  await capture(page, page.locator(".canvas-wrap"), "vote-chips-overview", [voteClock]);

  // The counter on the object (§10.3): the same corner on every object, and two of the
  // shapes a running session shows — «0 +» on a neighbour and my own vote in words.
  // Zoom in for the full form: at the fitted zoom the note has no room for it.
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await page.locator(".vote-chip").first().getByRole("button", { name: /Vote for/ }).click();
  await expect(page.locator(".vote-chip").first()).toHaveClass(/mine/);
  await capture(page, page.locator(".canvas-wrap"), "vote-chips", [voteClock]);

  // Both themes: the rail is a panel, not a strip of icons on the canvas edge.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAccount(page);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  // The same counters in the dark theme: the plate, the accent of my vote and the
  // muted "+" must all be readable there too (§6, both themes).
  await capture(page, page.locator(".canvas-wrap"), "vote-chips-dark", [voteClock]);
  await capture(page, page.locator(".tool-rail"), "rail-dark");
});

/**
 * The header and its four menus (ADR-119).
 *
 * The PNGs are the artefact a person reviews; the assertions are the frame: 52 px, one
 * row, no horizontal scroll at the three widths the brief names, and every menu inside
 * the viewport rather than clipped by its right edge.
 */
test("the header stays on one row and its menus fit the viewport", async ({ page }) => {
  await freshBoard(page, "visual-header");
  // The first-use hint hides itself after six seconds, so whether it is in a capture
  // depended on how fast the run got there. This test is about the header: open the
  // room as a returning visitor, who has already seen the hint.
  await page.evaluate(() => window.localStorage.setItem("remo.canvas.hint", "seen"));
  await page.reload();
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".canvas-hint")).toHaveCount(0);

  for (const width of [1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const frame = await page.evaluate(() => {
      const header = document.querySelector(".topbar")!;
      const box = header.getBoundingClientRect();
      return {
        height: Math.round(box.height),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });
    expect(frame.height, `header height at ${width}`).toBe(52);
    expect(frame.scrollWidth, `horizontal overflow at ${width}`).toBeLessThanOrEqual(
      frame.innerWidth,
    );
  }

  await page.setViewportSize({ width: 1440, height: 900 });

  // §10 acceptance: no emoji or text glyph stands in for an icon, one primary button.
  const header = await page.locator(".topbar").innerText();
  expect(header).not.toMatch(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u);
  await expect(page.locator(".topbar .rm-btn-primary")).toHaveCount(1);

  const menus: [string, () => Promise<void>, string][] = [
    ["board menu", () => openBoardMenu(page), "topbar-board-menu"],
    ["run", () => openFacilitation(page), "topbar-facilitation"],
    ["people", () => openPeople(page), "topbar-people"],
    ["account", () => openAccount(page), "topbar-account"],
  ];
  for (const [name, open, file] of menus) {
    await open();
    const surface = page.locator(".rm-menu, .rm-popover").last();
    await expect(surface, name).toBeVisible();
    const box = await surface.boundingBox();
    expect(box, `${name} has a box`).not.toBeNull();
    expect(box!.x, `${name} starts inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${name} ends inside the viewport`).toBeLessThanOrEqual(1440);
    await capture(page, page.locator(".topbar").locator("xpath=.."), file);
    await page.keyboard.press("Escape");
    await expect(surface, `${name} closes on Escape`).toHaveCount(0);
  }

  // Both themes, with a menu open: the header is one surface, the menu another.
  await openAccount(page);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await capture(page, page.locator(".app"), "topbar-dark");
});

/**
 * The brand sign on every surface a new person meets (ADR-272, spec §3.8).
 *
 * The landing's coral circle and blue square are the product's; the smile is graphite on
 * paper and paper in the dark theme. The captures are the artefact: a second picture or
 * an inverted one shows here.
 */
test("the room header, home, help and sign-in carry the same mark in both themes", async ({
  page,
}) => {
  await page.goto("/?lang=en");
  await page.locator(".home-empty").getByRole("button", { name: "Sign in", exact: true }).click();
  await capture(page, page.locator(".rm-dialog"), "brand-sign-in");
  await page.keyboard.press("Escape");

  const account = await freshBoard(page, "visual-brand");
  await goAllRooms(page);
  await capture(page, page.locator(".home-topbar"), "brand-home");

  await page.goto("/help/en");
  await capture(page, page.locator(".help-topbar"), "brand-help");

  await openBoard(page, account.boardId, { lang: "en" });
  await setAccountTheme(page, "dark");
  await page.goto("/help/en");
  await capture(page, page.locator(".help-topbar"), "brand-help-dark");
});

/**
 * A kanban room and the file its export makes (ADR-267 §2.1).
 *
 * The screen and the picture share one painter, so the two baselines are a pair: column
 * headers with counts, cards in their column's colour, the green ground and the title
 * plate. The export is shown at a fitted width; the file itself is 2× the board box.
 */
test("a kanban room and its export show the same picture", async ({ page }, testInfo) => {
  await freshBoard(page, "visual-kanban");
  await capture(page, page.locator(".app"), "board-kanban");

  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await expect(page.locator(".export-dialog")).toBeVisible();
  await page.locator(".export-dialog .export-choice", { hasText: "Whole room" }).click();
  const download = page.waitForEvent("download");
  await page.locator(".export-dialog").getByRole("button", { name: "Export", exact: true }).click();
  const png = await download;
  // The Linux browser runs remotely, where a download has no local path until saved.
  const file = testInfo.outputPath("kanban-export.png");
  await png.saveAs(file);
  const bytes = await readFile(file);
  await expect(page.locator(".export-status.done")).toBeVisible({ timeout: 20_000 });
  await page.locator(".export-dialog").getByRole("button", { name: "Close", exact: true }).first().click();

  await page.evaluate(async (data) => {
    const image = new Image();
    image.id = "export-picture";
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    // Above every layer of the app; the capture is of the picture alone.
    image.style.cssText =
      "position:fixed;left:0;top:0;max-width:1200px;height:auto;z-index:2147483647;background:#ffffff";
    document.body.append(image);
  }, bytes.toString("base64"));
  await capture(page, page.locator("#export-picture"), "board-kanban-export", [], false);
});

/**
 * The plan preview (ADR-188), on data the fake provider makes identical on every run.
 *
 * The fixture is two notes and one line, so the artefact shows the whole reading: the
 * room with the dashed plan in it, and the task panel with the counts and the bounds.
 */
test("the agent plan preview is readable and fits the viewport", async ({ page }) => {
  await agentBoard(page, "visual-plan");
  await openAgentMenu(page);
  await page.getByRole("menuitem", { name: /Ask the agent/ }).click();
  const agents = page.getByRole("dialog", { name: "AI agents in this room" });
  await expect(agents).toBeVisible();
  await agents.getByRole("combobox", { name: "Agent", exact: true }).selectOption({
    label: "Planner",
  });
  await agents.getByRole("combobox", { name: "Skill", exact: true }).selectOption("brief-to-board");

  await page
    .getByLabel("What should it draw?")
    .fill("Соедини две заметки FAKE_PLAN_CONNECTED");
  await page.getByRole("button", { name: "Ask the agent" }).click();

  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  // Stable data: two objects, one connector, three actions, drawn in the room.
  await expect(plan).toContainText("Objects: 2 · connectors: 1 · actions: 3");
  const drawn = await page.evaluate(() => window.__remo.proposal);
  expect(drawn?.blocks).toHaveLength(2);
  expect(drawn?.lines).toHaveLength(1);

  const box = await plan.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  // The plan's hull breathes in canvas time, which a screenshot cannot freeze; calm
  // animations hold it at full opacity, so the frame is deterministic.
  await calmMotion(page);
  await capture(page, page.locator(".app"), "agent-plan");
  await loudMotion(page);
});

/**
 * The tidy preview (ADR-143, ADR-188): the notes where they are and their dashed ghosts
 * where they go, the block hull and the task panel, on a deterministic prefix layout. The model is the fake provider, so the
 * note text and the block title are identical on every run.
 */
test("the tidy preview shows before and after and fits the viewport", async ({ page }) => {
  const board = await agentBoard(page, "visual-tidy");
  const rows = [
    { x: -520, y: 260, text: "US-3: pay" },
    { x: 80, y: -180, text: "US-1: browse" },
    { x: 620, y: 420, text: "US-10: refund" },
    { x: 260, y: 60, text: "US-2: cart" },
    { x: -320, y: -420, text: "US-5: ship" },
  ];
  for (const row of rows) {
    const response = await page.request.post(`/api/boards/${board.boardId}/commands`, {
      headers: { "Idempotency-Key": `visual-tidy-${row.text}-${Date.now()}` },
      data: {
        command: "board.item.create",
        input: { type: "sticky_note", x: row.x, y: row.y, width: 160, height: 180, content: row.text },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await expect.poll(() => page.evaluate(() => window.__remo.widgets.length)).toBe(5);
  // The board fits itself to the seeded content after the sync lands; ask for the whole
  // board explicitly, so every note is on screen and the camera is where we read it.
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(400);

  const geometry = await page.evaluate(() => {
    const probe = window.__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return { camera: probe.camera, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  });
  const toClient = (world: { x: number; y: number }) => ({
    x: geometry.rect.left + geometry.rect.width / 2 + (world.x - geometry.camera.x) * geometry.camera.zoom,
    y: geometry.rect.top + geometry.rect.height / 2 + (world.y - geometry.camera.y) * geometry.camera.zoom,
  });
  const widgets = await page.evaluate(() => window.__remo.widgets);
  // Bottom-up: the arrange bar opens above the selection, so clicking downwards would
  // let the bar cover the next note.
  const ordered = [...widgets].sort((a, b) => b.y - a.y);
  const first = toClient({ x: ordered[0].x, y: ordered[0].y });
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Shift");
  for (const widget of ordered.slice(1)) {
    const point = toClient({ x: widget.x, y: widget.y });
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.up("Shift");
  await expect
    .poll(() => page.evaluate(() => window.__remo.selectedIds.length))
    .toBe(5);

  await page.getByRole("button", { name: "Tidy up", exact: true }).click();
  const tidy = page.getByRole("dialog", { name: "Tidy up selection" });
  await expect(tidy).toBeVisible();
  await tidy.getByRole("button", { name: "Tidy up", exact: true }).click();
  const plan = page.getByRole("dialog", { name: "Agent plan" });
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan).toContainText("Moves: 5");
  await expect(plan).toContainText("Blocks: US");
  const drawn = await page.evaluate(() => window.__remo.proposal);
  expect(drawn?.moves).toHaveLength(5);
  expect(drawn?.blocks.filter((block) => block.type === "frame")).toHaveLength(1);

  const box = await plan.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  // The pointer last clicked a dialog button where the bar now stands; park it so a
  // hover state cannot become part of the picture.
  await page.mouse.move(0, 0);
  await calmMotion(page);
  await capture(page, page.locator(".app"), "agent-plan-tidy");
  await loudMotion(page);
});

test("the section panel shows the table and its axes", async ({ page }) => {
  const account = await register(page, "visual-section");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    title: "Section",
  });

  await openBoard(page, account.boardId);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  // The note is the table's content, and its tilt is a hash of its id: a fixed id keeps
  // this picture the same on every run (ADR-265 §3.2).
  await seedStableNote(page, {
    id: "visual-section-note",
    x: 0,
    y: 0,
    width: 160,
    height: 180,
    text: "Inside",
    parentId: frameId,
  });
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as unknown as { __remo: { widgets: Array<{ id: string }> } }).__remo.widgets.some(
            (widget) => widget.id === id,
          ),
        frameId,
      ),
    )
    .toBe(true);
  const frame = await page.evaluate((id) => {
    const probe = window as unknown as {
      __remo: { widgets: Array<{ id: string; x: number; y: number; height: number }> };
    };
    return probe.__remo.widgets.find((widget) => widget.id === id)!;
  }, frameId);
  const point = await page.evaluate(({ x, y }) => {
    const probe = (window as unknown as {
      __remo: { camera: { x: number; y: number; zoom: number } };
    }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (y - probe.camera.y) * probe.camera.zoom,
    };
  }, { x: frame.x, y: frame.y - frame.height / 2 + 24 });
  await page.mouse.click(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toEqual([frameId]);

  await ensureProperties(page);
  const panel = page.locator(".section-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("radio", { name: "Table", exact: true }).click();
  const layoutDialog = page.locator(".section-layout-card");
  await expect(layoutDialog).toBeVisible();
  await layoutDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(panel.locator(".section-axis-row")).toHaveCount(3);
  // A selected section fits one screen at 900 px, without scrolling (ADR-236, sketch D4).
  const inspectorBox = page.locator("aside.inspector");
  const overflow = await inspectorBox.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow, "the section panel needs no scrolling").toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Columns: Column 1" }).click();
  await expect(panel.getByLabel("Axis name")).toHaveValue("Column 1");
  // An empty header size is Auto, named by the field itself rather than a bare unit.
  const headerHeight = panel.getByRole("spinbutton", { name: "Header height" });
  await expect(headerHeight).toHaveAttribute("placeholder", "Auto");
  await expect(panel.locator(".table-header-size .rm-input-affix")).toHaveCount(0);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

  await page.waitForTimeout(300);
  await capture(page, page.locator(".app"), "section-panel");

  // The header group sits below the fold of the panel: its spacing and Auto need their own picture.
  const headerGroup = panel.locator(".table-header-group");
  await headerGroup.scrollIntoViewIfNeeded();
  await capture(page, headerGroup, "section-panel-header");
});

/** World point → client point for the canvas, the same inverse the handlers use. */
async function canvasView(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __remo?: { camera: { x: number; y: number; zoom: number } };
    }).__remo;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      camera: probe?.camera ?? { x: 0, y: 0, zoom: 1 },
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    };
  });
}

/** Fit is deterministic: the same content always lands at the same zoom. */
async function zoomInToReadable(page: Page) {
  await page.getByRole("button", { name: "Fit" }).click();
  await page.waitForTimeout(250);
}

function clientPoint(
  view: Awaited<ReturnType<typeof canvasView>>,
  world: { x: number; y: number },
) {
  return {
    x: view.rect.left + view.rect.width / 2 + (world.x - view.camera.x) * view.camera.zoom,
    y: view.rect.top + view.rect.height / 2 + (world.y - view.camera.y) * view.camera.zoom,
  };
}

/**
 * A block selection: one box with handles, quiet rings on the members (ADR-211).
 *
 * The badge is the written form of the same state, so the baseline shows both the chrome
 * and the sentence a person reads.
 */
test("a block selection shows one box and its composition", async ({ page }) => {
  const account = await register(page, "visual-block");
  await seedNote(page, account.boardId, { x: -320, y: 0 });
  await seedNote(page, account.boardId, { x: 0, y: 0 });
  await seedNote(page, account.boardId, { x: 320, y: 0 });
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);
  await zoomInToReadable(page);

  const view = await canvasView(page);
  // One marquee instead of three shift-clicks: a missed click must not turn the
  // baseline into a different selection.
  const startPoint = { x: view.rect.left + 90, y: view.rect.top + 90 };
  const endPoint = {
    x: view.rect.left + view.rect.width - 90,
    y: view.rect.top + view.rect.height - 90,
  };
  await page.mouse.move(startPoint.x, startPoint.y);
  await page.mouse.down();
  await page.mouse.move(endPoint.x, endPoint.y, { steps: 10 });
  await page.mouse.up();

  const selected = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds.length,
  );
  expect(selected).toBe(3);
  await expect(page.locator(".selection-badge")).toContainText("3 objects");
  await expect(page.locator(".selection-badge")).toContainText("3 change size");
  await capture(page, page.locator(".canvas-wrap"), "selection-block");

  const notes = await page.evaluate(() => {
    const list = (window as unknown as {
      __remo: { widgets: Array<{ type: string; x: number; y: number; width: number; height: number }> };
    }).__remo.widgets;
    return list
      .filter((widget) => widget.type === "sticky_note")
      .map((widget) => ({ x: widget.x, y: widget.y, width: widget.width, height: widget.height }));
  });

  const right = Math.max(...notes.map((note) => note.x + note.width / 2));
  const bottom = Math.max(...notes.map((note) => note.y + note.height / 2));
  const gap = 7 / view.camera.zoom;
  const corner = clientPoint(view, { x: right + gap, y: bottom + gap });
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x - 700 / view.camera.zoom, corner.y - 500 / view.camera.zoom, { steps: 10 });
  await expect(page.locator(".canvas-limit")).toBeVisible();
  await capture(page, page.locator("body"), "selection-min-stop");
  await page.mouse.up();
});

/**
 * A connector label with explicit lines (ADR-213): Enter is a line, the chip covers the
 * line and stays on `labelAt`.
 */
test("a connector label keeps its lines", async ({ page }) => {
  const account = await register(page, "visual-label");
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  // Fixed ids: the notes' tilt is a hash of their id (ADR-265 §3.2), and this picture is
  // compared byte for byte. The save state proves the server has them before the
  // connector command reads the document.
  await watchSave(page);
  const from = await seedStableNote(page, { id: "visual-label-from", x: -260, y: 0, width: 160, height: 180 });
  const to = await seedStableNote(page, { id: "visual-label-to", x: 260, y: 0, width: 160, height: 180 });
  await savedAfterEdit(page);
  await seedConnector(page, account.boardId, from, to);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __remo?: { widgets?: Array<{ type: string }> } }).__remo?.widgets?.filter(
            (widget) => widget.type === "connector",
          ).length ?? 0,
      ),
    )
    .toBe(1);
  await page.waitForTimeout(400);
  await zoomInToReadable(page);

  const view = await canvasView(page);
  const middle = clientPoint(view, { x: 0, y: 0 });
  await page.mouse.dblclick(middle.x, middle.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Проверить заказ\nСогласовать с\nфинансовым отделом");
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);
  await capture(page, page.locator(".canvas-wrap"), "label-wrap");
});

/**
 * The hard ink shadow of the third level (ADR-267, T4).
 *
 * One shape carries "Cardboard": the photo shows the offset silhouette with no blur in
 * the light theme, and the same object in the dark theme, where the level is painted as
 * "Floating" until the dark cardboard arrives (ADR-265, stage 6).
 */
test("cardboard casts a hard shadow in light and falls back to floating in dark", async ({
  page,
}) => {
  await freshBoard(page, "visual-cardboard", { template: "empty" });
  const rail = page.getByRole("toolbar", { name: "Tools" });
  await rail.getByRole("button", { name: "Shape variants" }).click();
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();

  const at = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo?: { widgets: Array<{ type: string; x: number; y: number }> };
    }).__remo;
    const one = probe?.widgets.find((widget) => widget.type === "shape");
    return one ? { x: one.x, y: one.y } : null;
  });
  if (!at) throw new Error("the shape was not created");
  const view = await canvasView(page);
  const point = clientPoint(view, at);
  await page.mouse.dblclick(point.x, point.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await editor.fill("Проверка");
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);

  await ensureProperties(page);
  const more = page.locator("aside.inspector").getByRole("button", { name: "More actions", exact: true });
  await more.click();
  await page.getByRole("menu", { name: "More actions" })
    .getByRole("menuitemcheckbox", { name: "Cardboard", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await zoomInToReadable(page);
  await page.keyboard.press("Escape");
  await calmMotion(page);
  await capture(page, page.locator(".canvas-wrap"), "elevation");

  await openAccount(page);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await calmMotion(page);
  await capture(page, page.locator(".canvas-wrap"), "elevation-dark");
});

/** A shape that grew for its text (ADR-214): width unchanged, height down. */
test("a shape grows for its text", async ({ page }) => {
  const account = await register(page, "visual-shape-grow");
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);
  await zoomInToReadable(page);

  const rail = page.getByRole("toolbar", { name: "Tools" });
  await rail.getByRole("button", { name: "Shape variants" }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();

  const at = await page.evaluate(() => {
    const probe = (window as unknown as {
      __remo?: { widgets: Array<{ type: string; x: number; y: number }> };
    }).__remo;
    const one = probe?.widgets.find((widget) => widget.type === "shape");
    return one ? { x: one.x, y: one.y } : null;
  });
  if (!at) throw new Error("the shape was not created");
  const view = await canvasView(page);
  const point = clientPoint(view, at);
  await page.mouse.dblclick(point.x, point.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await editor.fill(
    "Подпись диаграммы, которой нужно больше места, чем было у прямоугольника. ".repeat(10),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);

  // Wait for the growth itself, not for a guessed delay: the shape is taller than when
  // it was created, then Fit frames it, so the label is legible in the baseline.
  const height = () =>
    page.evaluate(() => {
      const probe = (window as unknown as {
        __remo?: { widgets: Array<{ type: string; height: number }> };
      }).__remo;
      return probe?.widgets.find((widget) => widget.type === "shape")?.height ?? 0;
    });
  await expect.poll(height).toBeGreaterThan(200);
  // Fit frames the grown box, which is what makes the label legible in the baseline;
  // two steps back leave a margin, so the frame shows a box on a board rather than one
  // border lying on the viewport edge.
  await zoomInToReadable(page);
  const zoom = () =>
    page.evaluate(
      () =>
        (window as unknown as { __remo?: { camera: { zoom: number } } }).__remo?.camera.zoom ?? 0,
    );
  const fitted = await zoom();
  // Two steps of 1.2 are 1.44; the poll only has to see most of that, not an exact value.
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect.poll(zoom).toBeLessThan(fitted / 1.35);

  // The first line of a painted block sits inside the padding. Measuring the ascent
  // against the wrong baseline mode drew it a few pixels too high and a fitted label
  // touched the top border, so the gap is asserted, not just photographed.
  const gap = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.board")!;
    const ctx = canvas.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const dark = (x: number, y: number) => data[(y * width + x) * 4]! < 100;
    const counts: number[] = [];
    for (let y = 0; y < height; y += 1) {
      let count = 0;
      for (let x = 0; x < width; x += 2) if (dark(x, y)) count += 1;
      counts.push(count);
    }
    const borderCount = Math.max(...counts);
    let border = counts.indexOf(borderCount);
    // The outline is a few pixels thick; step past it before looking for the label.
    while (border < height && counts[border]! > borderCount * 0.8) border += 1;
    for (let y = border; y < Math.min(height, border + 120); y += 1) {
      if (counts[y]! > 30) return (y - border) / (window.devicePixelRatio || 1);
    }
    return 0;
  });
  const stretched = await zoom();
  // Padding is 8 world px at the shape's floor; the first line's ink starts below it.
  expect(gap).toBeGreaterThan(8 * stretched * 0.7);
  await page.keyboard.press("Escape");
  await expect(page.locator(".selection-badge")).toHaveCount(0);
  // Fit keeps focus, and its tooltip would land in the frame: blur it, park the
  // cursor on the grid, and wait for the tooltip to be gone rather than for a delay.
  const canvas = await canvasView(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(canvas.rect.left + canvas.rect.width - 40, canvas.rect.top + 100);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await capture(page, page.locator(".canvas-wrap"), "shape-grow");
});

/**
 * Headings, lists and a checklist on the board (ADR-252 §7).
 *
 * The text and the note are seeded through the same delta the future toolbar will send,
 * because the editor's line-format tools are a later stage. The baseline is the painter:
 * heading sizes, three list levels, computed numbers, a checked item and a link.
 */
test("headings, lists and a checklist read on the canvas in both themes", async ({ page }) => {
  const account = await register(page, "visual-rich-blocks");
  const body = await seedObject(page, account.boardId, {
    type: "text",
    x: -200,
    y: 0,
    width: 440,
    height: 320,
    content: "",
    style: { fontSize: 16 },
  });
  const noteId = "visual-rich-note";
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  // The note's tilt is a hash of its id (ADR-265 §3.2); a fixed id keeps this picture the
  // same on every run, while the blocks below still come through the editor's delta.
  await seedStableNote(page, {
    id: noteId,
    x: 320,
    y: 0,
    width: 220,
    height: 200,
    style: { fontSize: 16 },
  });
  await page.waitForTimeout(400);

  await page.evaluate(
    ({ body, note }) => {
      const probe = (window as unknown as {
        __remo: {
          setDelta: (id: string, delta: Array<{ insert: string; attributes?: Record<string, unknown> }>) => void;
        };
      }).__remo;
      probe.setDelta(body, [
        { insert: "План релиза" },
        { insert: "\n", attributes: { block: "h1" } },
        { insert: "Что проверить" },
        { insert: "\n", attributes: { block: "h2" } },
        { insert: "Сборка проходит" },
        { insert: "\n", attributes: { block: "bullet" } },
        { insert: "Тесты зелёные" },
        { insert: "\n", attributes: { block: "bullet", indent: 1 } },
        { insert: "Ревью пройдено" },
        { insert: "\n", attributes: { block: "bullet", indent: 2 } },
        { insert: "Собрать отчёт" },
        { insert: "\n", attributes: { block: "ordered" } },
        { insert: "Показать команде" },
        { insert: "\n", attributes: { block: "ordered" } },
        { insert: "Отправить ссылку" },
        { insert: "\n", attributes: { block: "check", checked: true } },
        { insert: "Дождаться ответа" },
        { insert: "\n", attributes: { block: "check" } },
        { insert: "Документация: " },
        { insert: "example.com/docs", attributes: { href: "https://example.com/docs" } },
        { insert: " и " },
        { insert: "npm run build", attributes: { code: true } },
      ]);
      probe.setDelta(note, [
        { insert: "Чек-лист на бумаге" },
        { insert: "\n", attributes: { block: "h2" } },
        { insert: "Готово" },
        { insert: "\n", attributes: { block: "check", checked: true } },
        { insert: "Осталось" },
        { insert: "\n", attributes: { block: "check" } },
      ]);
    },
    { body, note: noteId },
  );

  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await zoomInToReadable(page);
  // The document materialized the block lines: the painter is not looking at guesses.
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as unknown as { __remo: { widgets: Array<{ id: string; lines: unknown[] | null }> } })
            .__remo.widgets.find((widget) => widget.id === id)?.lines?.length ?? 0,
        body,
      ),
    )
    .toBeGreaterThan(5);

  await capture(page, page.locator(".canvas-wrap"), "rich-blocks");

  await setTheme(page, "dark");
  await page.waitForTimeout(300);
  await capture(page, page.locator(".canvas-wrap"), "rich-blocks-dark");
  await setTheme(page, "light");

  // A checkbox on the board toggles without opening the editor (ADR-252 §8). The probe
  // answers the same question the pointer handler asks, so the test finds the marker
  // exactly where a person would click.
  const view = await canvasView(page);
  const box = await page.evaluate((id) => {
    const probe = (window as unknown as {
      __remo: { widgets: Array<{ id: string; x: number; y: number; width: number; height: number }> };
    }).__remo;
    const one = probe.widgets.find((widget) => widget.id === id);
    return one ? { x: one.x, y: one.y, width: one.width, height: one.height } : null;
  }, noteId);
  if (!box) throw new Error("the note disappeared");
  let target: { x: number; y: number; line: number } | null = null;
  for (let y = box.y - box.height / 2 + 4; y < box.y + box.height / 2 && !target; y += 6) {
    for (let x = box.x - box.width / 2 + 4; x < box.x + box.width / 2; x += 6) {
      const point = clientPoint(view, { x, y });
      const hit = await page.evaluate(
        ({ x: clientX, y: clientY }) =>
          (window as unknown as { __remo: { probe: (x: number, y: number) => { text: { kind: string; line: number } | null } } })
            .__remo.probe(clientX, clientY).text,
        point,
      );
      if (hit?.kind === "checkbox") {
        target = { ...point, line: hit.line };
        break;
      }
    }
  }
  if (!target) throw new Error("the checklist marker was not among the hit targets");
  const before = await page.evaluate(
    ({ id, line }) =>
      Boolean(
        (window as unknown as { __remo: { widgets: Array<{ id: string; lines: Array<{ checked: boolean }> | null }> } })
          .__remo.widgets.find((widget) => widget.id === id)?.lines?.[line]?.checked,
      ),
    { id: noteId, line: target.line },
  );
  await page.mouse.click(target.x, target.y);
  await expect(page.locator(".inline-editor")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        ({ id, line }) =>
          Boolean(
            (window as unknown as { __remo: { widgets: Array<{ id: string; lines: Array<{ checked: boolean }> | null }> } })
              .__remo.widgets.find((widget) => widget.id === id)?.lines?.[line]?.checked,
          ),
        { id: noteId, line: target!.line },
      ),
    )
    .toBe(!before);
});

/**
 * A note that cannot show all its text (ADR-214): the mark sits in the corner and the
 * badge says it in words, so the state is not colour-only.
 */
test("a clipped label is marked and named", async ({ page }) => {
  const account = await register(page, "visual-text-overflow");
  await openBoard(page, account.boardId);
  await page.waitForFunction(() => {
    const probe = (window as unknown as { __remo?: { camera?: unknown } }).__remo;
    return !!probe?.camera;
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.fonts.ready);
  await zoomInToReadable(page);

  const id = await addSticky(page);
  const at = await page.evaluate((noteId) => {
    const probe = (window as unknown as {
      __remo?: { widgets: Array<{ id: string; x: number; y: number }> };
    }).__remo;
    const one = probe?.widgets.find((widget) => widget.id === noteId);
    return one ? { x: one.x, y: one.y } : null;
  }, id);
  if (!at) throw new Error("the note was not created");
  const view = await canvasView(page);
  const point = clientPoint(view, at);
  await page.mouse.dblclick(point.x, point.y);
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  await editor.fill(
    "Заметка, в которую не помещается весь текст, и это видно по знаку в углу. ".repeat(16),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);

  // Fit frames the note closely; step back until the mark and the letters are readable.
  await zoomInToReadable(page);
  const zoom = () =>
    page.evaluate(
      () =>
        (window as unknown as { __remo?: { camera: { zoom: number } } }).__remo?.camera.zoom ?? 0,
    );
  for (let step = 0; step < 8 && (await zoom()) > 1.8; step += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  await expect.poll(zoom).toBeLessThanOrEqual(1.8);

  const framed = await page.evaluate((noteId) => {
    const probe = (window as unknown as {
      __remo?: { widgets: Array<{ id: string; x: number; y: number }> };
    }).__remo;
    const one = probe?.widgets.find((widget) => widget.id === noteId);
    return one ? { x: one.x, y: one.y } : null;
  }, id);
  if (!framed) throw new Error("the note disappeared");
  const framedView = await canvasView(page);
  const spot = clientPoint(framedView, framed);
  await page.mouse.click(spot.x, spot.y);
  const badge = page.locator(".selection-badge");
  await expect(badge).toContainText("Sticky note");
  await expect(badge).toContainText("Text does not fit");
  await page.mouse.move(framedView.rect.left + framedView.rect.width - 40, framedView.rect.top + 100);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await capture(page, page.locator(".canvas-wrap"), "text-overflow");
});

/**
 * Room access after the M3 pilot (sketch D1): labelled fields, one primary action, the
 * public link on, a group heading per block. The link holds the room id, so it is masked.
 */
test("room access reads as one form", async ({ page }) => {
  await freshBoard(page, "visual-share");
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Room access" });
  await dialog.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Turn off", exact: true })).toBeVisible();
  await capture(page, dialog, "share", [dialog.getByRole("textbox", { name: "Public link" })]);
});

/**
 * Pictures on a board (`spec/images.md` §9.1–§9.3, §9.5, §9.7) and the storage tab
 * (§9.8). The captures are the evidence a reviewer looks at; the assertions keep them
 * from becoming a screenshot of an empty state that happens to be stable.
 */
test("the image states are readable in both themes", async ({ page }) => {
  // Ten captures, two of them with a held upload: the default budget is for one screen.
  test.setTimeout(180_000);
  const account = await register(page, "visual-images");
  await openBoard(page, account.boardId, { template: "empty" });
  // Two notes at the edges keep the first-use card out of the captures and leave the
  // centre free for the drop frame and the upload placeholder. Fixed ids: a note's tilt
  // is a hash of its id (ADR-265 §3.2), so a random one would change every run's picture.
  await watchSave(page);
  await seedStableNote(page, { id: "visual-images-left", x: -700, y: 0, width: 160, height: 180 });
  await seedStableNote(page, { id: "visual-images-right", x: 700, y: 0, width: 160, height: 180 });
  await savedAfterEdit(page);
  // The first-use hint hides itself after six seconds: whether a capture caught it would
  // depend on how fast the run got there, not on the state being reviewed.
  await page.evaluate(() => window.localStorage.setItem("remo.canvas.hint", "seen"));
  await openBoard(page, account.boardId, { template: "empty" });
  const png = await makePng(page);

  // The rail button, not the picker: the icon and its label are the entry point (§9.1).
  await expect(page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Image" })).toBeVisible();
  await capture(page, page.locator(".tool-rail"), "image-rail");
  await setTheme(page, "dark");
  await capture(page, page.locator(".tool-rail"), "image-rail-dark");
  await setTheme(page, "light");

  // The drop frame covers the canvas and names the count (§9.2). The transfer is never
  // released here, so the frame stays until the explicit leave.
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "drop.png", { type: "image/png" }));
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    const options = {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    window.dispatchEvent(new DragEvent("dragenter", options));
    window.dispatchEvent(new DragEvent("dragover", options));
  });
  await expect(page.locator(".image-drop")).toBeVisible();
  await capture(page, page.locator(".canvas-wrap"), "image-drop");
  await setTheme(page, "dark");
  await capture(page, page.locator(".canvas-wrap"), "image-drop-dark");
  await setTheme(page, "light");
  await page.evaluate(() => window.dispatchEvent(new DragEvent("dragleave", { bubbles: true })));
  await expect(page.locator(".image-drop")).toHaveCount(0);

  // The author's placeholder while the bytes travel (§9.3). The request is held at the
  // route so the state is captured rather than raced; the progress ring is masked
  // because its arc moves between frames.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let continued: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    continued = resolve;
  });
  await page.route("**/api/boards/*/files", async (route) => {
    await gate;
    // `unroute` may already have handled the request: releasing and unregistering are
    // two steps, and the handler must not report that race as a test failure.
    await route.continue().catch(() => {});
    continued();
  });
  await uploadImage(page, png, "upload.png");
  const slot = page.locator(".image-slot");
  await expect(slot).toBeVisible();
  // The ring's arc and percentage move with the request; the slot itself is the state.
  const ring = page.locator(".image-slot .rm-ring");
  await capture(page, page.locator(".canvas-wrap"), "image-upload", [ring]);
  await setTheme(page, "dark");
  await capture(page, page.locator(".canvas-wrap"), "image-upload-dark", [ring]);
  await setTheme(page, "light");
  // The object appears when the document says so, then the painter asks for a variant;
  // a capture in between is a dominant-colour placeholder, not a picture.
  const variantLoaded = page.waitForResponse((response) =>
    /\/files\/[^/]+\/w(256|1024|2048)\?board=/.test(response.url()),
  );
  release();
  await settled;
  await page.unroute("**/api/boards/*/files");
  await expect(slot).toHaveCount(0, { timeout: 20_000 });
  await variantLoaded;
  await page.waitForTimeout(200);

  // The selected picture and its object bar (§9.5): Replace · Description · Open · More.
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __remo?: { selectedIds?: string[] } }).__remo?.selectedIds?.length ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  const bar = page.locator(".sticky-bar").filter({ has: page.getByRole("button", { name: "Replace" }) });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Description" })).toBeVisible();
  // Let the 2048 px variant decode, or the capture catches the dominant-colour placeholder.
  await page.waitForTimeout(500);
  await capture(page, page.locator(".canvas-wrap"), "image-selected");
  await setTheme(page, "dark");
  await capture(page, page.locator(".canvas-wrap"), "image-selected-dark");
  await setTheme(page, "light");

  // The viewer (§9.7): the picture, its size and the download action.
  await bar.getByRole("button", { name: "Open" }).click();
  const lightbox = page.locator(".rm-lightbox");
  await expect(lightbox).toBeVisible();
  const picture = lightbox.locator(".image-lightbox-picture");
  await expect(picture).toBeVisible();
  // A visible `<img>` can still be empty: wait for the decoded w2048 bitmap.
  await expect
    .poll(() => picture.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  // `onLoad` fits the picture in a second render; a capture between the two is at 100 %.
  await page.waitForTimeout(300);
  // The viewer covers the page: the control that opened it can keep a focus ring, and the
  // account avatar's colour is per account, both showing through the scrim. The viewer's
  // picture is the subject; focus and avatars have their own scenarios.
  const noRing = await page.addStyleTag({
    content:
      "*:focus-visible { outline: none !important; } .account-button, .presence { visibility: hidden !important; }",
  });
  await capture(page, lightbox, "image-lightbox", [], false);
  await setTheme(page, "dark");
  await capture(page, lightbox, "image-lightbox-dark", [], false);
  await setTheme(page, "light");
  await noRing.evaluate((node) => node.remove());
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);

  // The room is untouched by the captures: one image object, no placeholder left behind.
  const images = await page.evaluate(() =>
    (window as unknown as { __remo?: { widgets?: Array<{ type: string }> } }).__remo?.widgets?.filter(
      (widget) => widget.type === "image",
    ).length ?? 0,
  );
  expect(images).toBe(1);
  expect(account.boardId).toBeTruthy();
});

/**
 * The organisation's storage tab (§9.8). It exists only when plans are enabled
 * (`REMO_BILLING=on`), so the visual gate skips it in an ordinary self-host run; the
 * baseline is produced by a billing run, which is also the installation that shows the
 * quota bar. `pnpm baselines` covers the image states above.
 */
test("the storage tab shows the organisation's pictures", async ({ page }) => {
  await freshBoard(page, "visual-storage", { template: "empty" });
  const png = await makePng(page, 600, 400);
  await uploadImage(page, png, "stored.png");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __remo?: { widgets?: Array<{ type: string }> } }).__remo?.widgets?.filter(
          (widget) => widget.type === "image",
        ).length ?? 0,
      ),
    )
    .toBe(1);

  await page.getByRole("button", { name: /^Account and interface/ }).click();
  await page.getByRole("button", { name: "Organisation and people" }).click();
  await expect(page.locator(".org-dialog")).toBeVisible();
  // The tab list arrives after the billing catalogue answers; counting too early reads
  // as "billing is off" and skips a screen that exists.
  await expect(page.getByRole("tab").first()).toBeVisible();
  const storage = page.getByRole("tab", { name: "Storage" });
  test.skip((await storage.count()) === 0, "the storage tab needs REMO_BILLING=on");
  await storage.click();
  const panel = page.locator(".storage-panel");
  await expect(panel).toBeVisible();
  // The picture uploaded above is the one this tab counts.
  await expect(panel).toContainText(/kB/);
  // The footer names the account, and every scenario registers a fresh one. The whole
  // footer is masked, not just the email: a mask's own width follows its text.
  const foot = page.locator(".org-foot");
  await capture(page, page.locator(".org-dialog"), "image-storage", [foot]);
  await setTheme(page, "dark");
  await capture(page, page.locator(".org-dialog"), "image-storage-dark", [foot]);
});

/* ------------------------------------------------------------- ink on paper --- */

/**
 * The owner's room after ADR-273: a caption saved with the old grey and a kanban with
 * lanes, in both themes.
 *
 * The raster is the same scene on purpose. The pair is what proves the rule: the caption
 * turns from ink to paper because its surface changed, while the board's light-green
 * ground keeps ink and its grid stays a hairline.
 */
test("ink: the owner's room reads in both themes", async ({ page }) => {
  const account = await register(page, "visual-ink-room");
  await openBoard(page, account.boardId, {
    lang: "ru",
    template: "product-roadmap-basic-prefilled",
  });
  await page.waitForFunction(
    () =>
      (window as unknown as { __remo?: { widgets?: Array<{ type: string }> } }).__remo?.widgets?.some(
        (widget) => widget.type === "text",
      ) ?? false,
  );
  await capture(page, page.locator(".app"), "ink-room-light");
  await setTheme(page, "dark");
  await capture(page, page.locator(".app"), "ink-room-dark");
});

/** Where a widget's centre is on screen, for a click that selects it. */
async function widgetCentre(page: Page, id: string) {
  return page.evaluate((wanted) => {
    const probe = (window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        widgets: Array<{ id: string; x: number; y: number }>;
      };
    }).__remo;
    const widget = probe.widgets.find((entry) => entry.id === wanted)!;
    const rect = document.querySelector<HTMLCanvasElement>(".layer.overlay")!.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (widget.x - probe.camera.x) * probe.camera.zoom,
      y: rect.top + rect.height / 2 + (widget.y - probe.camera.y) * probe.camera.zoom,
    };
  }, id);
}

/** The whole room as a PNG, shown in the page so the picture itself is the baseline. */
async function exportRoom(
  page: Page,
  testInfo: { outputPath: (name: string) => string },
  name: string,
): Promise<void> {
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await expect(page.locator(".export-dialog")).toBeVisible();
  await page.locator(".export-dialog .export-choice", { hasText: "Whole room" }).click();
  const download = page.waitForEvent("download");
  await page.locator(".export-dialog").getByRole("button", { name: "Export", exact: true }).click();
  const png = await download;
  const file = testInfo.outputPath(`${name}.png`);
  await png.saveAs(file);
  await expect(page.locator(".export-status.done")).toBeVisible({ timeout: 20_000 });
  await page
    .locator(".export-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  const bytes = await readFile(file);
  await page.evaluate(async (data) => {
    document.querySelector("#ink-export-picture")?.remove();
    const image = new Image();
    image.id = "ink-export-picture";
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    image.style.cssText =
      "position:fixed;left:0;top:0;max-width:1200px;height:auto;z-index:2147483647;background:#ffffff";
    document.body.append(image);
  }, bytes.toString("base64"));
  await capture(page, page.locator("#ink-export-picture"), name, [], false);
  await page.evaluate(() => document.querySelector("#ink-export-picture")?.remove());
}

/**
 * Every kind of content ink on one board: a frame with a table, stickies of four fills and
 * a caption whose stored colour is the old grey. Both themes and both exports.
 *
 * The scene is built through the same commands the product uses, so it is also the
 * document the painters and the export read — no fixture paints its own colours.
 */
test("ink: a frame, a table, stickies and a caption are the same in the export", async ({
  page,
}, testInfo) => {
  const account = await register(page, "visual-ink-objects");
  const frameId = await seedObject(page, account.boardId, {
    type: "frame",
    x: -520,
    y: 40,
    width: 880,
    height: 520,
    title: "Section",
  });
  await seedObject(page, account.boardId, {
    type: "text",
    x: -60,
    y: -560,
    width: 560,
    height: 96,
    content: "Roadmap",
    style: { color: "#58534e", fontSize: 44 },
  });
  await openBoard(page, account.boardId, { template: "empty" });

  // Every note gets an id of its choosing: its tilt is a hash of the id (ADR-265 §3.2),
  // and a created one has a random id, so the same scene would photograph differently
  // on every run.
  await seedStableNote(page, { id: "ink-inside", x: -700, y: -90, text: "Inside", parentId: frameId });
  await seedStableNote(page, { id: "ink-second", x: -380, y: -90, text: "Second", parentId: frameId });
  const notes: Array<[string, number, number, string]> = [
    ["ink-yellow", 420, -170, "#f4e0a8"],
    ["ink-orange", 660, -170, "#ffdcc6"],
    ["ink-blue", 420, 150, "#cddff8"],
    ["ink-green", 660, 150, "#c8e8d4"],
  ];
  for (const [id, x, y, fillColor] of notes) {
    await seedStableNote(page, { id, x, y, text: id.replace("ink-", ""), style: { fillColor } });
  }

  // The frame becomes a table: headers and the grid are content ink too.
  const centre = await widgetCentre(page, frameId);
  await page.mouse.click(centre.x, centre.y);
  await ensureProperties(page);
  const panel = page.locator(".section-panel");
  await panel.getByRole("radio", { name: "Table", exact: true }).click();
  await applyDefaultTableLayout(page);
  // The panel is not part of the picture: hide it, then fit the whole board.
  await page.getByRole("button", { name: "Hide the panel", exact: true }).click();
  await expect(page.locator(".app")).toHaveClass(/no-inspector/);
  // Nothing selected, so Fit frames the room and not one object.
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
      ),
    )
    .toEqual([]);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });

  await capture(page, page.locator(".app"), "ink-objects-light");
  await exportRoom(page, testInfo, "ink-objects-export-light");

  await setTheme(page, "dark");
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await capture(page, page.locator(".app"), "ink-objects-dark");
  await exportRoom(page, testInfo, "ink-objects-export-dark");
});
