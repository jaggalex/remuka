import { expect, test, type Page } from "@playwright/test";
import { freshBoard, goAllRooms } from "./helpers";

/**
 * The plan states a person sees on every page of the space (ADR-319, `spec/billing.md`
 * §8.5), as floating messages of the page's toaster: the past_due message for admins,
 * the Free notice for members of a suspended space, nothing for members during the grace.
 *
 * The billing summary is stubbed: these states need a failed renewal, which no HTTP
 * route can produce, and the banner's only input is that one answer. The server side of
 * the same fields (`viewerIsAdmin`, `graceEnd`) is pinned by `billing-subscription.db.test.mjs`.
 */

const LIMITS = { seats: 20, rooms: null, agentTasksPerMonth: null, trashDays: 30, storageBytes: null };

function summary(status: "past_due" | "suspended" | "active", viewerIsAdmin: boolean) {
  return {
    plan: status === "suspended" ? "free" : "team",
    status,
    limits: LIMITS,
    features: [],
    usage: { seats: 3, rooms: 4 },
    storage: { usedBytes: 0, limitBytes: null },
    subscription: {
      id: "sub-e2e", plan: "team", status, interval: "month", amount: 59000, currency: "RUB",
      currentPeriodStart: "2026-11-27T00:00:00.000Z", currentPeriodEnd: "2026-12-27T00:00:00.000Z",
      cancelAtPeriodEnd: false, trialEnd: null,
    },
    viewerIsAdmin,
    graceEnd: status === "past_due" ? "2027-01-10T09:00:00.000Z" : null,
    currency: "RUB",
    frozenRooms: [],
    readOnly: false,
  };
}

async function stubBilling(page: Page, body: ReturnType<typeof summary>): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/billing$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

const notice = (page: Page) => page.locator(".rm-toaster .rm-toast");

test("an admin of a past-due space gets a floating billing message on the home and in the room", async ({ page }) => {
  await stubBilling(page, summary("past_due", true));
  await freshBoard(page, "banner-admin");
  const message = notice(page);
  await expect(message).toHaveCount(1);
  await expect(message).toContainText("The Team payment didn't go through. Until");
  await expect(message).toContainText("update your card so the workspace doesn't move to Free");
  await expect(message).toHaveClass(/rm-toast-warning/);
  await page.screenshot({ path: "test-results/billing-notice-room.png" });

  // A warning is never timed out: it is still there after the 5 s of feedback messages.
  await page.waitForTimeout(6000);
  await expect(message).toBeVisible();

  await goAllRooms(page);
  await expect(notice(page)).toContainText("The Team payment didn't go through.");
  await page.screenshot({ path: "test-results/billing-notice-home.png" });
  await notice(page).getByRole("button", { name: "Update card" }).click();
  await expect(page.locator(".org-dialog")).toBeVisible();
});

test("a closed billing message stays closed for the session", async ({ page }) => {
  await stubBilling(page, summary("past_due", true));
  await freshBoard(page, "banner-close");
  await goAllRooms(page);
  await expect(notice(page)).toHaveCount(1);
  await notice(page).getByRole("button", { name: "Dismiss notification" }).click();
  await expect(notice(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".home")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(notice(page)).toHaveCount(0);
});

test("a member sees nothing during the grace", async ({ page }) => {
  await stubBilling(page, summary("past_due", false));
  await freshBoard(page, "banner-grace");
  await goAllRooms(page);
  await expect(page.locator(".home")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(notice(page)).toHaveCount(0);
});

test("a member of a suspended space learns why rooms are read-only", async ({ page }) => {
  await stubBilling(page, summary("suspended", false));
  await freshBoard(page, "banner-member");
  await goAllRooms(page);
  await expect(notice(page)).toContainText(
    "The workspace is on Free: rooms beyond the plan are read-only. Admins manage the plan",
  );
});

test("the floating message fits a phone and stays clear of the top bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await stubBilling(page, summary("past_due", true));
  await freshBoard(page, "banner-phone");
  const message = notice(page);
  await expect(message).toBeVisible();
  const box = (await message.boundingBox())!;
  const bar = (await page.locator(".topbar").first().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(await message.evaluate((node) => node.scrollWidth > node.clientWidth + 1)).toBe(false);
  await page.screenshot({ path: "test-results/billing-notice-390.png" });
});
