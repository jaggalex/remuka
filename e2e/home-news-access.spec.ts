import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL } from "./ports";
import { agentBoard, register } from "./helpers";

test("home respects a colleague’s room grants both when listing news and when following an earlier update", async ({ page, browser }) => {
  const owner = await register(page, "news-access-owner", { title: "Shared QA room" });
  const viewer = await browser.newContext();
  try {
    const peer = await viewer.newPage();
    const reader = await register(peer, "news-access-peer");
    const { user } = await (await peer.request.get("/api/auth/me")).json();
    const invite = await page.request.post(`/api/orgs/${owner.orgId}/invitations`, { data: { email: reader.email } });
    const invitation = new URL((await invite.json()).url).searchParams.get("invite");
    expect((await peer.request.post("/api/invitations/accept", { data: { token: invitation } })).ok()).toBe(true);
    const me = await (await peer.request.get("/api/auth/me")).json();
    const org = me.orgs.find((item: { id: string }) => item.id === owner.orgId);
    const privateBoard = await page.request.post(`/api/orgs/${owner.orgId}/boards`, { data: { title: "Unrelated QA room" } });
    const secret = (await privateBoard.json()).board.id;
    expect((await page.request.post(`/api/boards/${owner.boardId}/grants`,
      { data: { subjectType: "user", subjectId: user.id, role: "editor" } })).ok()).toBe(true);
    async function mention(room: string, text: string) {
      const response = await page.request.post(`/api/boards/${room}/comments`,
        { data: { anchor: { kind: "point", x: 2, y: 3 }, body: text + " @" + user.handle } });
      expect(response.ok(), await response.text()).toBe(true);
      return (await response.json()).thread.id;
    }
    const target = await mention(owner.boardId, "First discussion");
    await mention(owner.boardId, "Second discussion");
    await mention(secret, "Hidden discussion");
    const feed = `/api/home/news?org=${owner.orgId}`;
    const first = await (await peer.request.get(feed)).json();
    const update = first.news.find((event: { type: string }) => event.type === "mention");
    expect(update.roomId).toBe(owner.boardId);
    expect(update.targetId).not.toBe(target);
    expect(JSON.stringify(first)).not.toContain(secret);
    expect(JSON.stringify(first)).not.toContain("Unrelated QA room");
    await peer.goto(`/?org=${org.slug}&lang=en`);
    const reply = peer.locator('[data-news-type="mention"]').getByRole("link", { name: "Reply" });
    const url = new URL(await reply.getAttribute("href") ?? "", peer.url());
    expect(Object.fromEntries(url.searchParams)).toEqual({ room: owner.boardId, homeAction: "mention", target: update.targetId });
    const removal = await page.request.delete(`/api/boards/${owner.boardId}/grants/user/${user.id}`);
    expect(removal.ok(), await removal.text()).toBe(true);
    await reply.click();
    await expect(peer.locator(".access-gate")).toBeVisible();
    await expect(peer.locator(".comments-thread")).toHaveCount(0);
    expect((await (await peer.request.get(feed)).json()).news).toEqual([]);
    await peer.goto(`/?org=${org.slug}&lang=en`);
    await expect(peer.locator(".home-lead")).toBeVisible();
    await expect(peer.getByRole("heading", { name: "It’s quiet on your team" })).toBeVisible();
    await expect(peer.locator(".home-now article")).toHaveCount(0);
    await expect(peer.locator(".home-news-lead")).toHaveCount(0);
  } finally { await viewer.close(); }
});


test("review opens the named proposal; an already settled update cannot open another pending plan", async ({ page }) => {
  const account = await agentBoard(page, "news-review-target");
  const { user } = await (await page.request.get("/api/auth/me")).json();
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try {
    // Two reviewable rows in this run's own database model the completion of two jobs.
    // The history is real; no provider call is needed to test review navigation.
    const { rows } = await db.query(
      `insert into agent_tasks(org_id,agent_id,board_id,created_by,intent,status,created_at)
       values ($1,$2,$3,$4,'Earlier plan','awaiting_approval', now() - interval '30 seconds'),
              ($1,$2,$3,$4,'Newer plan','awaiting_approval', now())
       returning id,intent`, [account.orgId, account.agentId, account.boardId, user.id]);
    const target = rows.find(row => row.intent === "Newer plan").id;
    const other = rows.find(row => row.intent === "Earlier plan").id;
    await page.goto("/?lang=en");
    const review = page.locator('[data-news-type="agent"]').getByRole("link", { name: "Review" });
    const href = await review.getAttribute("href");
    expect(Object.fromEntries(new URL(href!, page.url()).searchParams)).toEqual({ room: account.boardId, homeAction: "agent", target });
    const opening = page.waitForRequest(r => new URL(r.url()).pathname === `/api/agent-tasks/${target}/plan`);
    await review.click();
    await opening;
    await expect(page.getByRole("dialog", { name: "Agent plan" })).toBeVisible();
    await db.query("update agent_tasks set status='applied' where id=$1", [target]);
    const requests: string[] = [];
    page.on("request", r => { if (r.url().includes("/agent-tasks/")) requests.push(new URL(r.url()).pathname); });
    await page.reload();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Earlier plan");
    await expect(page.getByRole("dialog", { name: "Agent plan" })).toHaveCount(0);
    expect(requests).not.toContain(`/api/agent-tasks/${other}/plan`);
  } finally { await db.end(); }
});

test("a new colleague’s invite action reaches the sharing panel of the chosen room", async ({ page, browser }) => {
  const owner = await register(page, "news-invite", { title: "Room for the new colleague" });
  const peer = await browser.newContext();
  try {
    const colleague = await peer.newPage();
    const account = await register(colleague, "news-invite-reader");
    const invite = await page.request.post(`/api/orgs/${owner.orgId}/invitations`, { data: { email: account.email } });
    const token = new URL((await invite.json()).url).searchParams.get("invite");
    expect((await colleague.request.post("/api/invitations/accept", { data: { token } })).ok()).toBe(true);
    await page.goto("/?lang=en");
    await page.locator('[data-news-type="joined"]').getByRole("button", { name: "Invite to a room" }).click();
    const room = page.getByRole("dialog").getByRole("link", { name: "Room for the new colleague" });
    const link = new URL((await room.getAttribute("href"))!, page.url());
    expect(link.searchParams.get("room")).toBe(owner.boardId);
    expect(link.searchParams.get("homeAction")).toBe("invite");
    await room.click();
    await expect(page.locator(".share-dialog")).toBeVisible();
  } finally { await peer.close(); }
});
