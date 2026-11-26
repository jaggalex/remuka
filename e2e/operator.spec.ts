/**
 * The operator console with a second factor (ADR-260, `spec/totp.md` §4–§6).
 *
 * The role arrives only from the shell, so the scenario uses the documented CLI exactly
 * as an operator would; everything else is the product. Three promises are checked:
 *
 *   - enrolment returns the key and the recovery codes once and opens the console;
 *   - a correct password alone gives no session — the dialog grows a code field;
 *   - a session older than twelve hours gets the step-up window, and a recovery code
 *     opens the console.
 *
 * Only time puts `mfa_at` thirteen hours back, so the scenario moves the row it owns in
 * the run's own database; there is no route that ages a session.
 */
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { test, expect } from "@playwright/test";
import { PASSWORD, openAccount, register } from "./helpers";
import { E2E_DATABASE_URL, E2E_KEK, MAIL_FILE } from "./ports";

const LINK = /https?:\/\/[^\s"'<>]+/;

/** The confirmation letter the console driver wrote for this address. */
async function verificationLink(email: string): Promise<string> {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    try {
      const lines = (await readFile(MAIL_FILE, "utf8")).split("\n").filter(Boolean);
      for (const line of lines) {
        const letter = JSON.parse(line) as { to: string; text: string };
        if (letter.to !== email || !letter.text.includes("?verify=")) continue;
        const match = LINK.exec(letter.text);
        if (match) return match[0];
      }
    } catch {
      // The file does not exist until the first letter is sent.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`no verification letter for ${email}`);
}

/** Grant the role through the documented shell command, against the run's database. */
function grantOperator(email: string): void {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: E2E_DATABASE_URL,
    REMO_MIGRATION_DATABASE_URL: E2E_DATABASE_URL,
    REMO_OPERATOR: email,
    REMO_KEK: E2E_KEK,
  };
  execFileSync(
    process.execPath,
    ["scripts/operator-role.mjs", "grant", "--email", email, "--reason", "e2e", "--as", email],
    { cwd: process.cwd(), env, stdio: "pipe" },
  );
}

/* --------------------------------------------------------------- TOTP (RFC 6238) -- */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.toUpperCase().replace(/=+$/, "")) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function stepAt(ms = Date.now()): number {
  return Math.floor(ms / 1000 / 30);
}

function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    (((digest[offset]! & 0x7f) << 24) |
      (digest[offset + 1]! << 16) |
      (digest[offset + 2]! << 8) |
      digest[offset + 3]!) >>>
    0;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Wait until the clock is in a step after the one already spent. */
async function codeAfter(page: import("@playwright/test").Page, secret: string, used: number) {
  while (stepAt() <= used) await page.waitForTimeout(500);
  return totp(secret, stepAt());
}

test("an operator enrols, signs in with a code and clears the step-up window", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const account = await register(page, "operator");

  // A confirmed address is a condition of the role (spec/operator.md §2.2).
  await page.goto(`${await verificationLink(account.email)}&lang=en`);
  await expect(page.getByText("Email confirmed")).toBeVisible({ timeout: 20_000 });
  grantOperator(account.email);

  // A fresh password session opens the console — and the console sends it to enrolment.
  await page.request.post("/api/auth/logout");
  await page.goto("/?lang=en");
  await openAccount(page);
  await page.locator(".rm-popover").getByRole("button", { name: "Sign in", exact: true }).click();
  const login = page.getByRole("main").filter({ has: page.locator('input[type="email"]') });
  await login.locator('input[type="email"]').fill(account.email);
  await login.locator('input[type="password"]').fill(PASSWORD);
  await login.getByRole("button", { name: "Sign in", exact: true }).click();
  // The account button exists for a guest too; the session is the fact to wait for.
  await expect
    .poll(async () => (await page.request.get("/api/auth/me")).status(), { timeout: 20_000 })
    .toBe(200);

  await page.goto("/operator?lang=en");
  await expect(page.getByRole("heading", { name: "Turn on the second factor" })).toBeVisible({
    timeout: 20_000,
  });

  // Enrolment: password → key → first code → recovery codes, shown once.
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Turn on" }).click();
  const secret = (await page.locator(".mfa-secret").textContent({ timeout: 20_000 }))?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(page.locator(".mfa-qr-placeholder a")).toHaveAttribute("href", /^otpauth:\/\/totp\//);

  const enrollingStep = stepAt();
  const enrolmentCode = totp(secret, enrollingStep);
  await page.getByLabel("Code from the app").fill(enrolmentCode);
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.locator(".mfa-code-list code")).toHaveCount(10, { timeout: 20_000 });
  const codes = await page.locator(".mfa-code-list code").allTextContents();
  await page.getByLabel("I have saved the codes").check();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Installation operator" })).toBeVisible({
    timeout: 20_000,
  });

  // Sign out. The password alone must not open a session any more.
  await page.request.post("/api/auth/logout");
  await page.goto("/?lang=en");
  await openAccount(page);
  await page.locator(".rm-popover").getByRole("button", { name: "Sign in", exact: true }).click();
  const second = page.getByRole("main").filter({ has: page.locator('input[type="email"]') });
  await second.locator('input[type="email"]').fill(account.email);
  await second.locator('input[type="password"]').fill(PASSWORD);
  await second.getByRole("button", { name: "Sign in", exact: true }).click();

  // The code field appears without a reload, and no session exists yet.
  await expect(page.locator('input[autocomplete="one-time-code"]')).toBeVisible({
    timeout: 20_000,
  });
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);

  const loginCode = await codeAfter(page, secret, enrollingStep);
  await page.locator('input[autocomplete="one-time-code"]').fill(loginCode);
  await page.getByRole("main").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(async () => (await page.request.get("/api/auth/me")).status(), { timeout: 20_000 })
    .toBe(200);

  // Thirteen hours later the console asks again; a recovery code is enough.
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "update sessions set mfa_at = now() - interval '13 hours' where user_id = (select id from users where email = $1)",
      [account.email],
    );
  } finally {
    await client.end();
  }

  await page.goto("/operator?lang=en");
  const stepUp = page.getByRole("dialog");
  await expect(stepUp).toBeVisible({ timeout: 20_000 });
  await expect(stepUp.getByRole("heading", { name: "Is it you?" })).toBeVisible();
  await stepUp.getByRole("button", { name: "Use a recovery code" }).click();
  await stepUp.getByLabel("Recovery code").fill(codes[0]!);
  await stepUp.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("heading", { name: "Installation operator" })).toBeVisible({
    timeout: 20_000,
  });

  // ------------------------------------------------- actions from the console --
  // A paid payment and a room with a public link, in a shared organisation the operator
  // administers. The console's forms then exercise the same functions as the shell.
  const suffix = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const invoiceId = randomUUID();
  const paymentId = randomUUID();
  const connectionId = randomUUID();
  const orgName = `E2E actions ${suffix}`;
  const boardId = `e2e-actions-${suffix}`;
  const seedClient = new Client({ connectionString: E2E_DATABASE_URL });
  await seedClient.connect();
  try {
    const { rows: [user] } = await seedClient.query(
      "select id from users where email = $1",
      [account.email],
    );
    await seedClient.query("insert into orgs (id, name, slug, kind, created_by) values ($1, $2, $3, 'shared', $4)", [
      orgId,
      orgName,
      `e2e-actions-${suffix}`,
      user.id,
    ]);
    await seedClient.query(
      `insert into org_memberships (org_id, user_id, relation, state)
       values ($1, $2, 'member', 'active')`,
      [orgId, user.id],
    );
    await seedClient.query(
      "insert into admin_roles (org_id, user_id, role) values ($1, $2, 'org_admin')",
      [orgId, user.id],
    );
    await seedClient.query(
      `insert into billing_accounts (org_id, billing_email, currency)
       values ($1, $2, 'RUB')`,
      [orgId, account.email],
    );
    await seedClient.query(
      `insert into payment_connections
         (id, provider, name, mode, status, currencies, method_groups, webhook_token)
       values ($1, 'manual', 'E2E manual', 'test', 'active', '{RUB}', '{invoice}', $2)`,
      [connectionId, `e2e-webhook-${suffix}`],
    );
    await seedClient.query(
      `insert into invoices
         (id, org_id, number, status, currency, subtotal, discount, credit_applied, total, lines)
       values ($1, $2, $3, 'paid', 'RUB', 29000, 0, 0, 29000, '[]'::jsonb)`,
      [invoiceId, orgId, `E2E-${suffix}`],
    );
    await seedClient.query(
      `insert into payments
         (id, org_id, invoice_id, connection_id, provider_payment_id, idempotency_key,
          amount, currency, status)
       values ($1, $2, $3, $4, 'manual:e2e', $5, 29000, 'RUB', 'succeeded')`,
      [paymentId, orgId, invoiceId, connectionId, `e2e-payment-${suffix}`],
    );
    await seedClient.query(
      `insert into boards (id, title, org_id, owner_id, visibility)
       values ($1, $2, $3, $4, 'link')`,
      [boardId, `E2E room ${suffix}`, orgId, user.id],
    );
    await seedClient.query(
      "insert into board_links (board_id, enabled, created_by) values ($1, true, $2)",
      [boardId, user.id],
    );
  } finally {
    await seedClient.end();
  }

  // Refund: the form states the consequences, the reason opens the button, the card is
  // re-read from the server after the answer.
  await page.getByRole("tab", { name: "Customers" }).click();
  await page.getByLabel("Search by e-mail, organisation or invoice number").fill(orgName);
  await page.getByRole("button", { name: new RegExp(orgName) }).click();
  await expect(page.getByRole("heading", { name: new RegExp(orgName) })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Refund", exact: true }).click();
  const refundDialog = page.getByRole("dialog").filter({ hasText: "Refund money" });
  await expect(refundDialog).toBeVisible();
  await expect(refundDialog).toContainText("The client receives a letter");
  const refundSubmit = refundDialog.getByRole("button", { name: "Refund", exact: true });
  await expect(refundSubmit).toBeDisabled();
  await refundDialog.getByLabel("Reason").fill("duplicate payment, E2E refund");
  await expect(refundSubmit).toBeEnabled();
  await refundSubmit.click();
  await expect(refundDialog).toBeHidden({ timeout: 20_000 });

  // Complaint: a measure by room link, then lifting it with its reason.
  await page.getByRole("tab", { name: "Complaints" }).click();
  await page.getByRole("button", { name: "New measure" }).click();
  const picker = page.getByRole("dialog").filter({ hasText: "Who the measure is addressed to" });
  await picker.getByLabel("Room link or its id").fill(`/?room=${boardId}`);
  await picker.getByRole("button", { name: "Next" }).click();
  const measureDialog = page.getByRole("dialog").filter({ hasText: "New measure on a complaint" });
  await measureDialog.getByLabel("Reason").fill("the public link leads to unlawful material");
  await measureDialog.getByRole("button", { name: "New measure", exact: true }).click();
  await expect(measureDialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(`E2E room ${suffix}`)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Lift the measure" }).first().click();
  const revertDialog = page.getByRole("dialog").filter({ hasText: "Lift the measure" });
  await revertDialog.getByLabel("Reason").fill("the complaint was resolved");
  await revertDialog.getByRole("button", { name: "Lift the measure", exact: true }).click();
  await expect(revertDialog).toBeHidden({ timeout: 20_000 });

  const checkClient = new Client({ connectionString: E2E_DATABASE_URL });
  await checkClient.connect();
  try {
    const { rows: refunds } = await checkClient.query(
      "select amount, idempotency_key from refunds where org_id = $1",
      [orgId],
    );
    expect(refunds).toHaveLength(1);
    expect(Number(refunds[0]!.amount)).toBe(29000);
    expect(refunds[0]!.idempotency_key).toMatch(/^operator-refund:.*:console:/);
    const { rows: audit } = await checkClient.query(
      `select action, channel, mfa from audit_events
        where org_id = $1 and action in ('billing.refunded', 'abuse.link_disabled', 'abuse.reverted')
        order by at`,
      [orgId],
    );
    expect(audit.map((row) => row.action)).toEqual([
      "billing.refunded",
      "abuse.link_disabled",
      "abuse.reverted",
    ]);
    expect(audit.every((row) => row.channel === "console")).toBe(true);
    // The recovery code that opened this step-up is the factor the journal names.
    expect(audit[0]!.mfa).toBe("recovery");
    const { rows: measures } = await checkClient.query(
      "select reverted_at from operator_actions where subject_id = $1",
      [boardId],
    );
    expect(measures).toHaveLength(1);
    expect(measures[0]!.reverted_at).not.toBeNull();
  } finally {
    await checkClient.end();
  }
});
