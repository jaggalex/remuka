/**
 * Registration consent and the re-acceptance window (ADR-256 §3, §5, §7).
 *
 * The documents are an installation fact: the ordinary run is the `none` zone and has no
 * checkboxes, so every scenario reads `GET /config` and skips when the run has no required
 * document. Point a run at a zone to see them:
 *
 *   E2E_COMPLIANCE_ZONE=ru pnpm e2e e2e/legal.spec.ts
 *   E2E_COMPLIANCE_ZONE=eu pnpm e2e e2e/legal.spec.ts
 *
 * The re-acceptance scenario starts from an account that has a session but no journal
 * rows — the state of every account created before the release. It removes the rows of a
 * freshly registered account through the run's own throwaway database, then signs in again
 * and proves the window cannot be passed without accepting (§5). Nothing else in the
 * product can produce that state, which is why the fixture reaches the database.
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { PASSWORD, register } from "./helpers";
import { E2E_DATABASE_URL } from "./ports";

interface LegalDoc {
  doc: string;
  zone: string;
  version: number;
  sha256: string;
  required: "signup" | "none";
  reaccept: boolean;
  withdrawable: boolean;
  status: "draft" | "published";
}

async function documents(page: Page): Promise<LegalDoc[]> {
  const response = await page.request.get("/api/config");
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = (await response.json()) as { legal?: { documents?: LegalDoc[] } };
  return body.legal?.documents ?? [];
}

function text(zone: string, ru: string, en: string): string {
  return zone === "ru" ? ru : en;
}

async function openRegister(page: Page, zone: string): Promise<void> {
  // Registration is its own screen (ADR-265 stage 3, mockup App-SignUp), reached from the
  // sign-in dialog and addressable as `?signup=1`.
  await page.goto(`/?signup=1&lang=${zone === "ru" ? "ru" : "en"}`);
  const screen = page.locator(".signup-screen");
  await expect(screen).toBeVisible();
  await screen.locator('input[autocomplete="name"]').fill("Legal Test");
  await screen.locator('input[type="email"]').fill(`legal-ui-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`);
  await screen.locator('input[type="password"]').fill(PASSWORD);
}

test("the documents page serves a guest without acceptance actions", async ({ page, browser }) => {
  const documentsHere = await documents(page);
  test.skip(documentsHere.length === 0, "configure E2E_COMPLIANCE_ZONE=ru|eu for the legal documents");
  const zone = documentsHere[0]!.zone;
  const guest = await browser.newContext();
  try {
    const visitor = await guest.newPage();
    await visitor.goto(`/?legal=documents&lang=${zone === "ru" ? "ru" : "en"}`);
    await expect(
      visitor.getByRole("heading", { name: text(zone, "Документы", "Documents") }),
    ).toBeVisible();
    await expect(visitor.locator(".legal-doc")).toHaveCount(documentsHere.length);
    await expect(visitor.getByRole("button", { name: text(zone, "Принять", "Accept") })).toHaveCount(0);
    await expect(visitor.getByRole("button", { name: text(zone, "Отозвать согласие", "Withdraw consent") })).toHaveCount(0);
    await expect(visitor.locator(".legal-page-note").first()).toContainText(
      text(zone, "Войдите, чтобы видеть", "Sign in to see"),
    );

    // The landing footer is the guest's way in: one link, no acceptance, no account.
    await visitor.goto(`/?lang=${zone === "ru" ? "ru" : "en"}`);
    await expect(
      visitor.locator(".home-footer").getByRole("link", {
        name: text(zone, "Документы", "Documents"),
      }),
    ).toHaveAttribute("href", "/?legal=documents");
  } finally {
    await guest.close();
  }
});

test("the documents page shows what was accepted and withdraws only the consent", async ({ page }) => {
  const documentsHere = await documents(page);
  const required = documentsHere.filter((document) => document.required === "signup");
  const withdrawable = documentsHere.find(
    (document) => document.withdrawable && document.reaccept,
  );
  test.skip(!withdrawable, "configure E2E_COMPLIANCE_ZONE=ru: the consent is the withdrawable document");
  const zone = withdrawable!.zone;
  const email = `legal-page-${Date.now()}@example.com`;

  const registered = await page.request.post("/api/auth/register", {
    data: {
      email,
      password: PASSWORD,
      name: "Documents Test",
      acceptances: required.map(({ doc, version, sha256 }) => ({ doc, version, sha256 })),
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();

  await page.goto(`/?legal=documents&lang=${zone === "ru" ? "ru" : "en"}`);
  await expect(page.locator(".legal-doc")).toHaveCount(documentsHere.length);
  await expect(page.locator(".legal-doc-status.is-accepted").first()).toContainText(
    text(zone, "Принято", "Accepted"),
  );

  const withdraw = page.getByRole("button", {
    name: text(zone, "Отозвать согласие", "Withdraw consent"),
  });
  await expect(withdraw).toHaveCount(1);
  await withdraw.click();
  const confirmation = page.getByRole("dialog", {
    name: text(zone, "Отозвать согласие?", "Withdraw consent?"),
  });
  await confirmation
    .getByRole("button", { name: text(zone, "Отозвать", "Withdraw"), exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator(".legal-page-consequence")).toContainText(
    text(zone, "Согласие отозвано", "Consent withdrawn"),
  );

  const state = (await (await page.request.get("/api/account/legal")).json()) as {
    documents: Array<{ doc: string; accepted: boolean; withdrawnAt: string | null }>;
  };
  const consent = state.documents.find((document) => document.doc === withdrawable!.doc);
  expect(consent?.accepted).toBe(false);
  expect(consent?.withdrawnAt).toBeTruthy();
});

test("registration asks for every required document and creates the account only with them", async ({
  page,
}) => {
  const documentsHere = await documents(page);
  const required = documentsHere.filter((document) => document.required === "signup");
  test.skip(required.length === 0, "configure E2E_COMPLIANCE_ZONE=ru|eu for the legal documents");
  const zone = required[0].zone;

  await openRegister(page, zone);
  const dialog = page.locator(".signup-screen");
  const create = dialog.getByRole("button", {
    name: text(zone, "Создать аккаунт", "Create account"),
    exact: true,
  });
  const boxes = dialog.getByRole("checkbox");
  await expect(boxes).toHaveCount(required.length);
  for (let index = 0; index < required.length; index += 1) {
    await expect(boxes.nth(index)).not.toBeChecked();
  }
  // Empty boxes mean no account: the button is inactive before any click.
  await expect(create).toBeDisabled();
  for (let index = 0; index < required.length; index += 1) await boxes.nth(index).check();
  await expect(create).toBeEnabled();
  await create.click();

  // The screen stays in its "done" state (mockup App-SignUp); the session exists.
  await expect(dialog.getByRole("status")).toContainText(text(zone, "Готово!", "Done!"), {
    timeout: 20_000,
  });
  const me = await page.request.get("/api/auth/me");
  expect(me.ok()).toBeTruthy();
  const { user } = (await me.json()) as { user: { id: string } };
  const accepted = await page.request.get("/api/account/legal");
  const state = (await accepted.json()) as { pending: string[]; documents: Array<{ doc: string; accepted: boolean }> };
  expect(state.pending).toEqual([]);
  expect(state.documents.filter((document) => document.accepted).map((document) => document.doc).sort()).toEqual(
    required.map((document) => document.doc).sort(),
  );
  expect(user.id).toBeTruthy();
});

test("a guest sees the name-visibility line when the installation has a zone", async ({
  page,
}) => {
  const documentsHere = await documents(page);
  test.skip(documentsHere.length === 0, "configure E2E_COMPLIANCE_ZONE=ru|eu for the legal documents");
  await page.goto("/?lang=en");
  await page.getByRole("button", { name: /^Account and interface/ }).click();
  const line = page.locator(".legal-guest-name");
  await expect(line).toContainText("The people in this room will see your name.");
  await expect(line.getByRole("link", { name: "Documents and policy" })).toHaveAttribute(
    "href",
    "/?legal=documents",
  );
});

test("the re-acceptance window offers a room backup without closing", async ({ page }) => {
  const documentsHere = await documents(page);
  const pendingDocs = documentsHere.filter((document) => document.reaccept);
  test.skip(pendingDocs.length === 0, "configure E2E_COMPLIANCE_ZONE=ru|eu for the re-acceptance window");
  const zone = pendingDocs[0]!.zone;
  const account = await register(page, "legal-backup");

  // The state of an account created before the release: a session, a room, no proof.
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "delete from legal_acceptances where user_id = (select id from users where email = $1)",
      [account.email],
    );
  } finally {
    await client.end();
  }

  await page.goto(`/?room=${account.boardId}&lang=${zone === "ru" ? "ru" : "en"}`);
  const sheet = page.getByRole("dialog", {
    name: zone === "ru" ? "Документы обновились" : "Documents have been updated",
  });
  await expect(sheet).toBeVisible({ timeout: 20_000 });

  const backup = sheet.getByRole("button", {
    name: zone === "ru" ? "Скачать бэкап комнаты" : "Download room backup",
  });
  await expect(backup).toBeVisible();
  const download = page.waitForEvent("download");
  await backup.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.remuka-backup\.json$/);
  // §5: the window is still there; the download did not become a way out.
  await expect(sheet).toBeVisible();
});

test("the server refuses an account without the required acceptances", async ({ page }) => {
  const required = (await documents(page)).filter((document) => document.required === "signup");
  test.skip(required.length === 0, "configure E2E_COMPLIANCE_ZONE=ru|eu for the legal documents");
  const email = `legal-refused-${Date.now()}@example.com`;

  const response = await page.request.post("/api/auth/register", {
    data: { email, password: PASSWORD, name: "No consent" },
  });
  expect(response.status()).toBe(400);
  const body = (await response.json()) as { error: string; missing: string[] };
  expect(body.error).toBe("LEGAL_ACCEPTANCE_REQUIRED");
  expect(body.missing.sort()).toEqual(required.map((document) => document.doc).sort());

  // The refused attempt created nothing: signing in with the same password fails.
  const login = await page.request.post("/api/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(login.status()).toBe(401);
});

test("an account with no journal rows is blocked until it accepts the current revision", async ({
  page,
}) => {
  const documentsHere = await documents(page);
  const required = documentsHere.filter((document) => document.required === "signup");
  const pendingDocs = documentsHere.filter((document) => document.reaccept);
  test.skip(pendingDocs.length === 0, "configure E2E_COMPLIANCE_ZONE=ru|eu for the legal documents");
  const zone = pendingDocs[0].zone;
  const email = `legal-reaccept-${Date.now()}@example.com`;

  const registered = await page.request.post("/api/auth/register", {
    data: {
      email,
      password: PASSWORD,
      name: "Reaccept Test",
      acceptances: required.map(({ doc, version, sha256 }) => ({ doc, version, sha256 })),
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();

  // The state of an account created before the release: a session, no proof of anything.
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "delete from legal_acceptances where user_id = (select id from users where email = $1)",
      [email],
    );
  } finally {
    await client.end();
  }
  expect((await page.request.post("/api/auth/logout")).ok()).toBeTruthy();

  await page.goto(`/?lang=${zone === "ru" ? "ru" : "en"}`);
  await page.getByRole("button", { name: text(zone, "Войти", "Sign in"), exact: true }).first().click();
  const login = page.getByRole("dialog").filter({ has: page.locator('input[type="email"]') });
  await login.locator('input[type="email"]').fill(email);
  await login.locator('input[type="password"]').fill(PASSWORD);
  await login.getByRole("button", { name: text(zone, "Войти", "Sign in"), exact: true }).click();

  const sheet = page.getByRole("dialog", {
    name: text(zone, "Документы обновились", "Documents have been updated"),
  });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  // §5: no close button and Escape does nothing; only the two named actions exist.
  await expect(sheet.getByRole("button", { name: text(zone, "Выйти", "Sign out") })).toBeVisible();
  const accept = sheet.getByRole("button", { name: text(zone, "Принять", "Accept"), exact: true });
  await expect(accept).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();

  const boxes = sheet.getByRole("checkbox");
  for (let index = 0; index < (await boxes.count()); index += 1) await boxes.nth(index).check();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(sheet).toHaveCount(0, { timeout: 20_000 });

  const state = (await (await page.request.get("/api/account/legal")).json()) as {
    pending: string[];
  };
  expect(state.pending).toEqual([]);
});
