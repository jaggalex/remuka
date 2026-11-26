import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password-123";

function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

export interface Account {
  email: string;
  orgId: string;
  boardId: string;
}

/**
 * Register an account and create an empty board through the same API the app uses,
 * then open it in the browser with a known display name and language.
 *
 * Going through the API keeps the scenario about the product, not about typing into a
 * sign-up form before every test.
 */
export async function register(
  page: Page,
  tag: string,
  options: { user?: string; title?: string } = {},
): Promise<Account> {
  const email = uniqueEmail(tag);
  // A zone that requires documents at sign-up refuses an account without them, so the
  // harness reads the same `/config` the form does. In the default `none` zone the list
  // is empty and the request is unchanged (ADR-256 §4).
  const configured = await page.request.get("/api/config");
  const legal = configured.ok()
    ? ((await configured.json()) as {
        legal?: { documents?: Array<{ doc: string; version: number; sha256: string; required: string }> };
      })
    : {};
  const acceptances = (legal.legal?.documents ?? [])
    .filter((document) => document.required === "signup")
    .map(({ doc, version, sha256 }) => ({ doc, version, sha256 }));
  const registered = await page.request.post("/api/auth/register", {
    data: { email, password: PASSWORD, name: options.user ?? tag, acceptances },
  });
  if (!registered.ok()) throw new Error(`register failed: ${await registered.text()}`);
  const body = (await registered.json()) as { org: { id: string } };

  const created = await page.request.post(`/api/orgs/${body.org.id}/boards`, {
    data: { title: options.title ?? `${tag} board` },
  });
  if (!created.ok()) throw new Error(`create board failed: ${await created.text()}`);
  const board = (await created.json()) as { board: { id: string } };

  return { email, orgId: body.org.id, boardId: board.board.id };
}

export async function openBoard(
  page: Page,
  boardId: string,
  options: { user?: string; lang?: "en" | "ru"; template?: string } = {},
): Promise<void> {
  const user = options.user ? `&user=${encodeURIComponent(options.user)}` : "";
  const template = options.template ? `&template=${encodeURIComponent(options.template)}` : "";
  await page.goto(`/?room=${boardId}&lang=${options.lang ?? "en"}${user}${template}`);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
}

/** Document sync can finish before the HTTP access decision enables editing. */
export async function waitForBoardEditor(page: Page): Promise<void> {
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Sticky note", exact: true })).toBeEnabled();
}

/** Wait until the camera and the canvas size are the same on two reads 80 ms apart. */
export async function settleCamera(page: Page): Promise<void> {
  let previous = "";
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const current = await page.evaluate(() => {
      const probe = (window as unknown as { __remo?: { camera?: { x: number; y: number; zoom: number } } })
        .__remo;
      const rect = document
        .querySelector<HTMLCanvasElement>(".layer.overlay")
        ?.getBoundingClientRect();
      return `${probe?.camera?.x}:${probe?.camera?.y}:${probe?.camera?.zoom}:${rect?.width}`;
    });
    if (current === previous) return;
    previous = current;
    await page.waitForTimeout(80);
  }
}

/** Select the requested kanban card, or the first card when none is specified. */
export async function selectKanbanCard(page: Page, cardId?: string): Promise<string> {
  await waitForBoardEditor(page);
  // ADR-197: a fresh person starts with the inspector closed; these scenarios read
  // the card fields, tags and links, so open it before selecting the card.
  await ensureProperties(page);
  // The panel narrows the canvas and the board refits; the view must stop moving before
  // world → client is computed, or the click lands where the card used to be.
  await settleCamera(page);
  // After a reload the document arrives over the socket; the probe is empty until then.
  await page.waitForFunction((wanted) => {
    const probe = window as unknown as {
      __remo?: { layouts: Array<{ placements: Array<{ cardId: string }> }> };
    };
    return Boolean(probe.__remo?.layouts?.some((entry) =>
      entry.placements.some((placement) => !wanted || placement.cardId === wanted),
    ));
  }, cardId);
  const point = await page.evaluate((wanted) => {
    const probe = window as unknown as {
      __remo: {
        camera: { x: number; y: number; zoom: number };
        layouts: Array<{ placements: Array<{ cardId: string; x: number; y: number }> }>;
      };
    };
    const placement = probe.__remo.layouts
      .flatMap((entry) => entry.placements)
      .find((entry) => !wanted || entry.cardId === wanted)!;
    const canvas = document.querySelector<HTMLCanvasElement>(".layer.overlay")!;
    const rect = canvas.getBoundingClientRect();
    return {
      id: placement.cardId,
      x: rect.left + rect.width / 2 + (placement.x - probe.__remo.camera.x) * probe.__remo.camera.zoom,
      y: rect.top + rect.height / 2 + (placement.y - probe.__remo.camera.y) * probe.__remo.camera.zoom,
    };
  }, cardId);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds,
  )).toEqual([point.id]);
  await expect(page.locator(".card-record")).toBeVisible();
  return point.id;
}

/** Set the theme preference on the signed-in account, keeping its language. */
export async function setAccountTheme(
  page: Page,
  theme: "light" | "dark",
  lang: "ru" | "en" = "en",
): Promise<void> {
  const me = await page.request.get("/api/auth/me");
  const body = (await me.json()) as { csrfToken?: string | null };
  const saved = await page.request.patch("/api/auth/preferences", {
    data: { theme, lang },
    headers: body.csrfToken ? { "X-CSRF-Token": body.csrfToken } : {},
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.reload();
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
}

/** Set the language preference on the signed-in account (not just the URL). */
export async function setAccountLanguage(page: Page, lang: "ru" | "en"): Promise<void> {
  const me = await page.request.get("/api/auth/me");
  const body = (await me.json()) as { csrfToken?: string | null };
  const saved = await page.request.patch("/api/auth/preferences", {
    data: { lang },
    headers: body.csrfToken ? { "X-CSRF-Token": body.csrfToken } : {},
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
}

/** A fresh account plus an open, empty board. */
export async function freshBoard(
  page: Page,
  tag: string,
  options: { user?: string; title?: string; template?: string } = {},
): Promise<Account> {
  const account = await register(page, tag, options);
  await openBoard(page, account.boardId, {
    user: options.user,
    template: options.template ?? "kanban-framework",
  });
  await waitForBoardEditor(page);
  return account;
}

export interface AgentBoard extends Account {
  agentId: string;
}

/**
 * An open board whose organisation and board allow agents, with one agent of its own.
 *
 * The plan scenarios need the same three switches every time; setting them through the
 * API keeps the test about the preview, not about clicking through the organisation
 * screen before it (ADR-142).
 */
export async function agentBoard(page: Page, tag: string): Promise<AgentBoard> {
  const account = await register(page, tag);
  await openBoard(page, account.boardId);

  const policy = await page.request.put(`/api/orgs/${account.orgId}/agent-policy`, {
    data: { agentsEnabled: true },
  });
  expect(policy.ok(), await policy.text()).toBeTruthy();
  const created = await page.request.post(`/api/orgs/${account.orgId}/agents`, {
    data: { name: "Planner" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { agent: { id: string } };
  const enabled = await page.request.put(`/api/boards/${account.boardId}/agents`, {
    data: { enabled: true },
  });
  expect(enabled.ok(), await enabled.text()).toBeTruthy();

  return { ...account, agentId: body.agent.id };
}

/**
 * The header's menus (ADR-266). They are DS menus: opening one moves focus inside,
 * Escape closes it and returns focus to the trigger.
 */
export async function openBoardMenu(page: Page, group?: "more" | "propertiesAccess"): Promise<void> {
  await page.getByRole("button", { name: /^(?:Room menu|Меню комнаты):/ }).click();
  if (group) await page.getByRole("menu").locator(`[data-command="room.${group}"]`).click();
}

/** "Run" is the old Facilitation menu: timer, voting, presentation, follow. */
export async function openRun(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run", exact: true }).click();
}

/** Kept as the old name for the scenarios written before ADR-266. */
export const openFacilitation = openRun;

export async function openAgentMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Agent", exact: true }).click();
}

export async function openPeople(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^People in the room:/ }).click();
}

/** The room agent panel lives behind the Agent menu (ADR-266 §2). */
export async function openRoomAgent(page: Page): Promise<void> {
  await openAgentMenu(page);
  await page.getByRole("menuitem", { name: "Give the agent a task", exact: true }).click();
}

export async function openAccount(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Account and interface/ }).click();
}

/** The room menu now carries the right panel; the header has no Properties icon. */
export async function openProperties(page: Page): Promise<void> {
  await openBoardMenu(page, "propertiesAccess");
  await page.getByRole("menuitem", { name: /^(?:Properties|Свойства)$/ }).click();
}

/** Open the panel only when it is closed: the row toggles it. */
export async function ensureProperties(page: Page): Promise<void> {
  if (await page.locator("aside.inspector").isVisible()) return;
  await openProperties(page);
  await expect(page.locator("aside.inspector")).toBeVisible();
}

/** The room logo links back to the list of rooms. */
export async function goAllRooms(page: Page): Promise<void> {
  await page.locator(".topbar").getByRole("link", { name: /^(?:All rooms|Все комнаты)$/ }).click();
}

/**
 * Discussion lives in the header as an icon (ADR-119). The name carries the unread
 * count, so the locator matches the start of it.
 */
export async function openComments(page: Page): Promise<void> {
  await openBoardMenu(page, "more");
  await page.locator('[data-command="header.comments"]').click();
}

export async function startPresentation(page: Page): Promise<void> {
  await openRun(page);
  await page.getByRole("menuitem", { name: "Start presentation", exact: true }).click();
}

export async function addSticky(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Sticky note", exact: true }).click();
  // A new sticky opens ready to type; an untouched one is removed on exit (M0).
  // Give the scenarios a real note so the next pointer gesture has something to hit.
  const editor = page.locator(".inline-editor");
  await expect(editor).toBeVisible();
  const id = await page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
  );
  await editor.fill("Note");
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-editor")).toHaveCount(0);
  await expect.poll(() => objectCount(page, "sticky_note")).toBeGreaterThan(0);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
  return id;
}

/**
 * Choose a shape kind in the rail and create the default one with a click (ADR-271).
 *
 * Choosing a kind now arms the tool instead of creating at once, so the scenario clicks
 * the canvas without travelling; that is the "default shape" path of ADR-119.
 */
export async function createShape(
  page: Page,
  name = "Rectangle",
): Promise<string> {
  const before = await objectCount(page, "shape");
  const rail = page.getByRole("toolbar", { name: "Tools" });
  await rail.getByRole("button", { name: "Shape variants" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  const canvas = page.locator(".layer.overlay");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the canvas is not visible");
  // Off-centre: an empty room shows its start card in the middle, and that card owns
  // the click. The default shape still lands at the view's centre (ADR-119).
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.75);
  await expect.poll(() => objectCount(page, "shape")).toBe(before + 1);
  return page.evaluate(
    () => (window as unknown as { __remo: { selectedIds: string[] } }).__remo.selectedIds[0]!,
  );
}

export async function enableLink(page: Page, boardId: string): Promise<void> {
  const response = await page.request.put(`/api/boards/${boardId}/link`, {
    data: { enabled: true },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/**
 * Watch the save counter, then wait until a new edit has been acknowledged.
 *
 * Waiting for `/saved/` alone can pass on the previous acknowledgement; the counter
 * proves that a later update existed and that the server confirmed it.
 */
export async function watchSave(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector(".save-state");
    if (!el) return;
    const state = window as unknown as { __saveMax?: number; __saveObserver?: MutationObserver };
    state.__saveMax = 0;
    state.__saveObserver?.disconnect();
    state.__saveObserver = new MutationObserver(() => {
      const pending = Number(el.getAttribute("data-pending") ?? "0");
      if (pending > (state.__saveMax ?? 0)) state.__saveMax = pending;
    });
    state.__saveObserver.observe(el, {
      attributes: true,
      attributeFilter: ["data-pending", "data-state"],
    });
  });
}

export async function savedAfterEdit(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => Number((window as unknown as { __saveMax?: number }).__saveMax ?? 0),
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved", {
    timeout: 20_000,
  });
  await expect(page.locator(".save-state")).toHaveAttribute("data-pending", "0");
}

/** Place a comment on an empty point of the board and submit the composer. */
export async function addComment(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "New comment" }).click();
  const composer = page.locator(".comment-composer textarea");
  const placement = page.locator(".comment-placement");
  await expect(composer.or(placement)).toBeVisible();
  if (await placement.isVisible()) {
    const box = await placement.boundingBox();
    if (!box) throw new Error("comment placement surface is missing");
    await page.mouse.click(box.x + 40, box.y + box.height - 60);
  }
  await expect(composer).toBeVisible();
  // The composer is a Dialog; its text field asked for focus and keeps it.
  await expect(composer).toBeFocused();
  await composer.fill(text);
  await page.locator(".comment-composer").getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".comments-thread")).toContainText(text);
}

let seedKey = 0;

function seedHeaders(): Record<string, string> {
  seedKey += 1;
  return { "Idempotency-Key": `e2e-seed-${Date.now()}-${seedKey}` };
}

/**
 * Create an object through the same command API the product uses, before the browser
 * opens the board.
 *
 * A scenario that needs exact coordinates (a marquee rectangle, a pair of notes and the
 * line between them) should not spend its first lines dragging objects into place.
 */
export async function seedObject(
  page: Page,
  boardId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const response = await page.request.post(`/api/boards/${boardId}/commands`, {
    headers: seedHeaders(),
    data: { command: "board.item.create", input },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { result: { id: string } };
  return body.result.id;
}

export async function seedNote(
  page: Page,
  boardId: string,
  at: { x: number; y: number },
  size = { width: 160, height: 180 },
  content = "",
  parentId?: string,
): Promise<string> {
  return seedObject(page, boardId, {
    type: "sticky_note",
    x: at.x,
    y: at.y,
    ...size,
    content,
    ...(parentId ? { parentId } : {}),
  });
}

/**
 * Place a note with an id the scenario chooses, through the dev probe (ADR-265 §3.2).
 *
 * Visual baselines compare pixels, and a note's tilt is a hash of its id: a note the
 * API or the UI creates gets a random id, so the same screen photographs differently on
 * every run. This is the same document write the UI makes, so the note syncs and
 * survives a reload; only the id is chosen by the test. A caller that seeds before a
 * reload also waits for the save state (`watchSave` … `savedAfterEdit`).
 */
export async function seedStableNote(
  page: Page,
  input: {
    id: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    text?: string;
    parentId?: string;
    style?: { fontSize?: number };
    rotation?: number;
  },
): Promise<string> {
  await page.waitForFunction(() => Boolean((window as unknown as { __remo?: unknown }).__remo));
  await page.evaluate((note) => {
    (window as unknown as { __remo: { seedNote: (input: typeof note) => void } }).__remo.seedNote(note);
  }, input);
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as unknown as { __remo?: { widgets?: Array<{ id: string }> } }).__remo?.widgets?.some(
            (widget) => widget.id === id,
          ) ?? false,
        input.id,
      ),
    )
    .toBe(true);
  return input.id;
}

/** A connector between two seeded objects; the line is derived from their boxes. */
export async function seedConnector(
  page: Page,
  boardId: string,
  from: string,
  to: string,
): Promise<string> {
  const response = await page.request.post(`/api/boards/${boardId}/commands`, {
    headers: seedHeaders(),
    data: { command: "board.connector.create", input: { from, to } },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { result: { id: string } };
  return body.result.id;
}

/**
 * Turning a section that already holds material into a table asks how to lay it out
 * (ADR-206, T4). Every scenario that flips the view must accept the default layout;
 * skipping it leaves the section a frame with no axes and no mirror.
 */
export async function applyDefaultTableLayout(page: Page): Promise<void> {
  const card = page.locator(".section-layout-card");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Apply", exact: true }).click();
}

/**
 * Zoom in with the zoom panel until the camera reaches `min`. The buttons zoom around the
 * centre, where a new object is created, so that object stays in view.
 */
export async function zoomInTo(page: Page, min: number): Promise<void> {
  const zoom = () =>
    page.evaluate(() => (window as unknown as { __remo: { camera: { zoom: number } } }).__remo.camera.zoom);
  while ((await zoom()) < min) {
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  }
}

/**
 * How many objects of a type the document holds (all types when omitted). Read from the
 * document, not from the panel: the room's counts are on screen only when nothing is
 * selected (ADR-236).
 */
export async function objectCount(page: Page, type?: string): Promise<number> {
  return page.evaluate(
    (wanted) =>
      ((window as unknown as { __remo?: { widgets?: Array<{ type: string }> } }).__remo?.widgets ?? []).filter(
        (widget) => !wanted || widget.type === wanted,
      ).length,
    type ?? null,
  );
}

/**
 * Open a folded group of the properties panel by its row name (ADR-236). Clicking an
 * open row would close it, so it is opened only when closed.
 */
export async function openFold(page: Page, name: string | RegExp): Promise<void> {
  const fold = page
    .locator("aside.inspector details.rm-disclosure")
    .filter({ has: page.locator("summary", { hasText: name }) })
    // An outer fold contains its children's summaries; the innermost is the target.
    .last();
  const summary = fold.locator(":scope > summary");
  if (!await summary.isVisible()) {
    const outer = page.locator("aside.inspector details.properties-more");
    await outer.locator(":scope > summary").click();
  }
  if ((await fold.getAttribute("open")) === null) await summary.click();
  await expect(fold).toHaveAttribute("open", "");
}
