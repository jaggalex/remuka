import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { register } from "./helpers";
import { E2E_KEK } from "./ports";

test.skip(process.env.E2E_BILLING !== "1", "Requires pnpm e2e --billing");

function fixture<T>(...args: string[]): T {
  const result = execFileSync(process.execPath, ["e2e/fixtures/billing-plan-change.mjs", ...args], {
    env: { ...process.env, REMO_BILLING: "on", REMO_PAY_FAKE: "1", REMO_KEK: E2E_KEK },
    encoding: "utf8",
  });
  return (result ? JSON.parse(result) : null) as T;
}

async function confirmPayment(page: Page, label = "Успешно") {
  await expect(page).toHaveURL(/fake_pay=/);
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page).toHaveURL(/\/org\/billing\?.*billing=return/);
}

for (const [kind, width] of [["personal", 390], ["shared", 1440]] as const) {
  test(`upgrade and downgrade for a ${kind} organisation at ${width}px`, async ({ page }, info) => {
    const owner = await register(page, `plan-change-${kind}`);
    const organisation = kind === "personal" ? { id: owner.orgId } : (await (
      await page.request.post("/api/orgs", { data: { name: "Ромашка" } })
    ).json()).org;
    const orgId = organisation.id;
    const { connectionId } = fixture<{ connectionId: string }>("setup", orgId, kind, owner.email);
    try {
      const pageUrl = `/org/billing?org=${orgId}&lang=ru`;
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(pageUrl);
      const choose = async (name: string) => {
        await page.locator(".billing-status-card").getByRole("button").click();
        await page.locator(".billing-choose").getByRole("radio", { name: new RegExp(name) }).check();
        await page.getByRole("button", { name: "Показать расчёт" }).click();
        await expect(page.getByRole("heading", { name: `Переход на ${name}` })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      };
      await choose("Team");
      const autopay = page.getByRole("checkbox", { name: "Продлевать тариф автоматически" });
      await expect(autopay).toBeVisible();
      await expect(autopay).not.toBeChecked();
      if (kind === "personal") await autopay.check();
      const pay = page.getByRole("button", { name: /Перейти к оплате · 445/ });
      await expect(pay).toBeVisible();
      await page.screenshot({ path: info.outputPath(`upgrade-${width}.png`), fullPage: true });
      await pay.click();
      await expect((await (await page.request.get(`/api/orgs/${orgId}/billing`)).json()).plan).toBe("pro");
      await confirmPayment(page);
      await expect(page.getByRole("heading", { name: "Team подключён" })).toBeVisible();
      await expect(page.locator(".billing-facts")).toContainText("Team");

      await choose("Pro");
      await expect(page.locator(".billing-change-total")).toContainText(/0,00/);
      await page.screenshot({ path: info.outputPath(`downgrade-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Запланировать переход на Pro" }).click();
      await expect(page.locator(".billing-scheduled-change")).toContainText("Запланировано");
      await expect(page.locator(".billing-facts")).toContainText("Team");
      await page.screenshot({ path: info.outputPath(`scheduled-${width}.png`), fullPage: true });

      const { boundary } = fixture<{ boundary: string }>("renew", orgId);
      await page.goto(pageUrl);
      if (kind === "shared") {
        await expect(page.locator(".billing-facts")).toContainText("Team");
        await page.getByRole("button", { name: /Оплатить счёт · 290/ }).click();
        await confirmPayment(page);
        await expect(page.getByRole("heading", { name: "Pro подключён" })).toBeVisible();
      }
      await expect(page.locator(".billing-facts")).toContainText("Pro");
      await expect(page.locator(".billing-scheduled-change")).toHaveCount(0);
      const final = await (await page.request.get(`/api/orgs/${orgId}/billing`)).json();
      expect(final.subscription.currentPeriodStart).toBe(boundary);
    } finally {
      fixture("cleanup", orgId, connectionId);
    }
  });
}
