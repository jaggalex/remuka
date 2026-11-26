import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL } from "../../e2e/ports";
import { totpCode, totpStep } from "../../apps/sync/mfa.mjs";
import { PASSWORD, register } from "../../e2e/helpers";
import slots from "../../content/hints/slots.json";

test("the installation catalogue is public in both languages while all operator routes require a staff account", async ({ page }) => {
  const query = "?slot=room.empty&lang=ru";
  async function denied() {
    expect((await page.request.get("/api/operator/words" + query)).status()).toBe(404);
    for (const action of ["draft", "publish", "rollback"]) {
      expect((await page.request.post("/api/operator/words/" + action + query, { data: {} })).status()).toBe(404);
    }
  }
  await denied();
  await register(page, "ordinary-words-owner");
  await denied();
  for (const lang of ["ru","en"]) expect((await page.request.get("/api/hints?lang=" + lang)).ok()).toBe(true);
  expect((await page.request.get("/api/hints?lang=zz")).status()).toBe(422);
});

for (const lang of ["ru", "en"] as const) {
  test("the name in home news remains a text node · " + lang, async ({ page, browser }) => {
    const owner = await register(page, "words-name-owner");
    const peer = await browser.newPage();
    try {
      const colleague = await register(peer, "words-name-reader", { user: "<b>x</b>" });
      const invitation = await page.request.post(`/api/orgs/${owner.orgId}/invitations`, { data: { email: colleague.email } });
      const token = new URL((await invitation.json()).url).searchParams.get("invite");
      expect((await peer.request.post("/api/invitations/accept", { data: { token } })).ok()).toBe(true);
      await page.goto("/?lang=" + lang);
      const text = page.locator('[data-news-type="joined"]');
      await expect(text).toContainText("<b>x</b>");
      await expect(text.locator("b")).toHaveCount(0);
    } finally { await peer.close(); }
  });
}

test("a slow catalogue counts only the enabled empty-room wording for this visit", async ({ page }) => {
  const owner = await register(page, "words-slow");
  const variants = slots.find(slot => slot.id === "room.empty")!.defaults.ru.map(row => ({
    ...row, enabled: row.key === "benefit", fields: { ...row.fields, body: "Начните с одной идеи." },
  }));
  let release = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  const shown: string[] = [];
  page.on("request", request => {
    if (!request.url().endsWith("/hints/event")) return;
    const event = request.postDataJSON();
    if (event?.slot === "room.empty" && event.name === "hint.shown") shown.push(event.variant);
  });
  await page.route("**/api/hints?lang=ru", async route => {
    await ready;
    await route.fulfill({ json: { words: { "room.empty": variants } } });
  });
  try {
    await page.goto(`/?room=${owner.boardId}&lang=ru&template=empty`);
    await expect(page.locator(".empty-cards")).toBeVisible();
    await expect(page.locator(".save-state")).toHaveAttribute("data-state", "saved");
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  } finally { release(); }
  await expect(page.locator(".empty-heading p")).toHaveText("Начните с одной идеи.");
  await expect.poll(() => shown).toEqual(["benefit"]);
});

test("a failed catalogue request falls back to built-in wording and records that visible variant", async ({ page }) => {
  const owner = await register(page, "words-fallback");
  const seen: string[] = [];
  page.on("request", req => {
    if (req.url().endsWith("/hints/event")) {
      const event = req.postDataJSON();
      if (event.slot === "room.empty" && event.name === "hint.shown") seen.push(event.variant);
    }
  });
  await page.route("**/api/hints?lang=en", route => route.fulfill({ status: 503, json: {} }));
  await page.goto(`/?room=${owner.boardId}&lang=en&template=empty`);
  await expect(page.locator(".empty-heading p")).toContainText("Double-click");
  await expect.poll(() => seen).toEqual(["action"]);
});

test("the operator preview marks live values without changing the placeholders in the input", async ({ page }) => {
  const owner = await register(page, "words-preview");
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try {
    await db.query("insert into instance_operators(user_id) select id from users where email=$1", [owner.email]);
    const start = await page.request.post("/api/account/mfa/begin", { data: { password: PASSWORD } });
    const { secret } = await start.json();
    const confirmation = await page.request.post("/api/account/mfa/confirm", { data: { code: totpCode(secret, totpStep()) } });
    expect(confirmation.ok()).toBe(true);
    await page.goto("/operator?tab=words&lang=en");
    const editor = page.locator(".operator-words");
    await editor.getByLabel("Where the hint appears").selectOption("news.joined");
    const row = editor.locator("fieldset").first();
    await row.getByLabel("Text", { exact: true }).fill("{name} has an invitation.");
    await expect(row.locator('mark[title="{name}"]')).toHaveText("Alex");
    await expect(row.getByLabel("Text", { exact: true })).toHaveValue("{name} has an invitation.");
  } finally { await db.end(); }
});
