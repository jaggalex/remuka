import { expect, test } from "@playwright/test";
import { checkTransfer } from "./transfer";
import { Client } from "pg";
import { PASSWORD, openBoard, register } from "../../e2e/helpers";
import { E2E_DATABASE_URL } from "../../e2e/ports";
import { totpCode, totpStep } from "../../apps/sync/mfa.mjs";

test("publishing is a TOTP-confirmed change on the next visit; rollback restores the previous wording", async ({ browser, page }, info) => {
  const account = await register(page, "words-editor");
  const room = await browser.newPage();
  const customer = await register(room, "words-reader");
  await openBoard(room, customer.boardId, { lang: "en", template: "empty" });
  const body = room.locator(".empty-heading p");
  await expect(body).toContainText("Double-click");
  const before = await body.innerText();
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try {
    const id = (await db.query("select id from users where email=$1", [account.email])).rows[0].id;
    await db.query("insert into instance_operators(user_id) values ($1)", [id]);
    const begin = await page.request.post("/api/account/mfa/begin", { data: { password: PASSWORD } });
    expect(begin.ok(), await begin.text()).toBe(true);
    const { secret } = await begin.json();
    const step = totpStep();
    const confirmed = await page.request.post("/api/account/mfa/confirm", { data: { code: totpCode(secret, step) } });
    expect(confirmed.ok(), await confirmed.text()).toBe(true);
    // An existing operator session may read even when publishing needs another code.
    await db.query("update sessions set mfa_at=now()-interval '20 minutes',mfa_factor='totp' where user_id=$1", [id]);
    await page.addInitScript(() => localStorage.setItem("remo.motion", "calm"));
    await page.goto("/operator?tab=words&lang=en");
    const editor = page.locator(".operator-words");
    await expect(editor).toBeVisible();
    await editor.getByLabel("Where the hint appears").selectOption("room.empty");
    await editor.getByLabel("Text language").selectOption("en");
    const variants = editor.locator("fieldset");
    await expect(variants).toHaveCount(3);
    await variants.nth(0).getByLabel("Text", { exact: true }).fill("A new drawing starts with a thought.");
    await variants.nth(1).getByLabel("Show this variant").uncheck();
    await variants.nth(2).getByLabel("Show this variant").uncheck();
    await editor.getByRole("button", { name: "Save draft" }).click();
    await expect(editor.getByRole("status")).toContainText("saved");
    await expect(body).toHaveText(before);
    await editor.getByLabel("Reason for publishing or restoring").fill("Make the first step clearer");
    await editor.getByRole("button", { name: "Publish", exact: true }).click();
    const challenge = page.getByRole("dialog");
    await expect(challenge).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "calm");
    const firstDigit = challenge.getByLabel("Digit 1 of 6");
    // The enrolment code has already been used and cannot confirm this challenge.
    await firstDigit.fill(totpCode(secret, step));
    await challenge.getByRole("button", { name: "Confirm" }).click();
    await expect(challenge.getByRole("alert")).toBeVisible();
    const refused = challenge.locator(".rm-shake");
    await expect(refused).toHaveAttribute("data-shake", "1");
    await expect(refused).toHaveCSS("animation-name", "none");
    const code = totpCode(secret, Math.max(totpStep(), step + 1));
    await firstDigit.evaluate((input, code) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", code);
      input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, code);
    await expect(challenge.locator(".stepup-cells input")).toHaveCount(6);
    expect(await challenge.locator(".stepup-cells input").evaluateAll(inputs =>
      inputs.map(input => (input as HTMLInputElement).value).join(""))).toBe(code);
    await challenge.getByRole("button", { name: "Confirm" }).click();
    await expect(editor).toContainText("Published version 2");
    await expect(body).toHaveText(before);
    const first = await page.request.get("/api/hints?lang=en");
    const cached = await page.request.get("/api/hints?lang=en", { headers: { "If-None-Match": first.headers().etag! } });
    expect(cached.status()).toBe(304);
    await room.reload();
    await expect(body).toHaveText("A new drawing starts with a thought.");
    await checkTransfer(info, "A new drawing starts with a thought.");
    await editor.getByLabel("Reason for publishing or restoring").fill("Restore the original");
    await editor.getByRole("button", { name: "Restore previous version" }).click();
    await expect(editor).toContainText("Published version 3");
    await room.reload();
    await expect(body).not.toContainText("A new drawing");
    const audit = await db.query("select reason,after from audit_events where actor_id=$1 and action='hint.published' order by id", [id]);
    expect(audit.rows.map(r => r.after.version)).toEqual([2,3]);
  } finally { await db.end(); await room.close(); }
});
