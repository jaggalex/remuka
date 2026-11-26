import { expect, test } from "@playwright/test";
import { openBoard, register } from "./helpers";

test("a quiet home shows a tip and a quiet heading without news cards", async ({ page }) => {
  await register(page, "news-quiet");
  await page.goto("/?lang=en");
  await expect(page.locator(".home-lead")).toBeVisible();
  await expect(page.getByRole("heading", { name: "It’s quiet on your team" })).toBeVisible();
  await expect(page.locator(".home-now article")).toHaveCount(0);
});

test("a teammate joining appears and can be dismissed", async ({ page, browser }) => {
  const account = await register(page, "news-home");
  const context = await browser.newContext();
  try {
    const peer = await context.newPage();
    const colleague = await register(peer, "news-peer", { user: "<b>x</b>" });
    const invited = await page.request.post("/api/orgs/" + account.orgId + "/invitations", { data: { email: colleague.email } });
    expect(invited.ok(), await invited.text()).toBeTruthy();
    const { url } = await invited.json();
    const accepted = await peer.request.post("/api/invitations/accept", { data: { token: new URL(url).searchParams.get("invite") } });
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
    await page.goto("/?lang=en");
    const item = page.locator('[data-news-type="joined"]');
    await expect(page.locator(".home-news-lead")).toContainText("<b>x</b> joined the team.");
    await expect(page.locator(".home-now article")).toHaveCount(1);
    await expect(item).toContainText("<b>x</b>");
    await expect(item.locator("b")).toHaveCount(0);
    await item.getByRole("button", { name: "Invite to a room" }).click();
    await expect(page.getByRole("dialog").getByRole("link")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await item.getByRole("button", { name: "Got it, hide this update" }).click();
    await expect(page.locator(".home-lead")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "It’s quiet on your team" })).toBeVisible();
    await expect(page.locator(".home-news-lead")).toHaveCount(0);
    await expect(item).toHaveCount(0);
  } finally { await context.close(); }
});

test("a reply opens its thread, removes the read update and keeps comment text out of home", async ({ page, browser }) => {
  const account = await register(page, "news-reply");
  const context = await browser.newContext();
  try {
    const peer = await context.newPage();
    const colleague = await register(peer, "news-reply-peer", { user: "Maya" });
    const me = await (await peer.request.get("/api/auth/me")).json();
    const invitation = await page.request.post("/api/orgs/" + account.orgId + "/invitations", { data: { email: colleague.email } });
    const { url } = await invitation.json();
    expect((await peer.request.post("/api/invitations/accept", { data: { token: new URL(url).searchParams.get("invite") } })).ok()).toBeTruthy();
    expect((await page.request.post("/api/boards/" + account.boardId + "/grants",
      { data: { subjectType: "user", subjectId: me.user.id, role: "editor" } })).ok()).toBeTruthy();
    const threadPath = "/api/boards/" + account.boardId + "/comments";
    const { thread } = await (await page.request.post(threadPath,
      { data: { anchor: { kind: "point", x: 0, y: 0 }, body: "Confidential first message" } })).json();
    expect((await peer.request.post(threadPath + "/" + thread.id + "/replies", { data: { body: "Confidential reply" } })).ok()).toBeTruthy();
    await page.goto("/?lang=en");
    await expect(page.locator(".home-news-lead")).toContainText("There’s a new message for you");
    await expect(page.locator(".home-news-lead").locator("a, button")).toHaveCount(0);
    await expect(page.locator(".home-now article")).toHaveCount(2);
    await expect(page.locator(".home-now")).toContainText("Maya");
    await expect(page.locator("main")).not.toContainText("Confidential");
    await page.locator('[data-news-type="joined"]').getByRole("button", { name: "Got it, hide this update" }).click();
    await expect(page.locator(".home-news-lead")).not.toContainText("Maya joined the team");
    await expect(page.locator(".home-now article")).toHaveCount(1);
    const recorded = page.waitForRequest(r => r.url().includes("/api/home/news/click"));
    await page.locator('.home-now [data-news-type="mention"]').getByRole("link", { name: "Reply" }).click();
    expect((await recorded).postDataJSON()).toEqual({ type: "mention" });
    await expect(page.locator(".comments-thread.is-active")).toContainText("Confidential reply");
    await expect.poll(async () => {
      const res = await page.request.get("/api/home/news?org=" + account.orgId);
      return (await res.json()).news.some((item: { type: string }) => item.type === "mention");
    }).toBe(false);
    await openBoard(peer, account.boardId, { template: "empty" });
    await page.goto("/?lang=en");
    const live = page.locator('[data-news-type="live"]');
    await expect(live).toContainText("Maya");
    await live.getByRole("link", { name: "Join" }).click();
    await expect(page).toHaveURL(new RegExp("room=" + account.boardId));
  } finally { await context.close(); }
});
