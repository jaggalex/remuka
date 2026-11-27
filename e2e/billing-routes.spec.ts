import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openBoard, openBoardMenu, register } from "./helpers";

test.skip(process.env.E2E_BILLING !== "1", "Requires pnpm e2e --billing");

for (const width of [390, 1440]) {
  test(`billing banners retain the organisation, action and accessible layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await register(page, "billing-banners");
    const response = await page.request.post("/api/orgs", { data: { name: "Field team" } });
    expect(response.ok()).toBeTruthy();
    const { org } = await response.json();
    const billingPath = `/api/orgs/${org.id}/billing`;
    const seed = await page.request.get(billingPath);
    expect(seed.ok()).toBeTruthy();
    const summary = await seed.json();
    const states = [
      { name: "free", status: "active", action: "Change plan" },
      { name: "trial", status: "trialing", action: "Change plan" },
      { name: "past-due", status: "past_due", action: "Update payment method" },
      { name: "read-only", status: "active", action: "Choose active rooms" },
      { name: "suspended", status: "suspended", action: "Pay now" },
    ];
    let state = states[0]!;
    await page.route("**" + billingPath, route => route.fulfill({ json: {
      ...summary, status: state.status, plan: state.name === "trial" ? "team" : "free",
      readOnly: state.name === "read-only", usage: { ...summary.usage, rooms: state.name === "read-only" ? 6 : 0 },
    } }));
    for (const next of states) {
      state = next;
      await page.goto("/org/billing?lang=en&org=" + encodeURIComponent(org.slug));
      const banner = page.locator(".billing-status-card");
      await expect(banner).toHaveAttribute("data-status", next.name);
      await expect(banner.getByRole("button")).toHaveCount(1);
      await banner.getByRole("button", { name: next.action }).click();
      if (next.name === "past-due") await expect(page.locator("#billing-payment-method")).toBeFocused();
      else if (next.name === "read-only") await expect(page.locator("#billing-active-rooms")).toBeFocused();
      else await expect(page.locator(".billing-choose")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(scan.violations.map(({ id, nodes }) => [id, nodes.map(node => node.target)])).toEqual([]);
    await page.getByRole("tab", { name: "People" }).click();
    await expect(page).toHaveURL(/\/org\/people\?/);
    await page.goBack();
    await expect(page.locator(".billing-status-card")).toBeVisible();
  });
}

test("the price and application return address follow the selected plan, promo and consent", async ({ page }) => {
  await register(page, "checkout-price");
  const create = await page.request.post("/api/orgs", { data: { name: "Checkout team" } });
  expect(create.ok()).toBeTruthy();
  const { org } = await create.json();
  const prices = [
    { id: "pro-month", currency: "USD", plan: "pro", interval: "month", amount: 1000 },
    { id: "pro-year", currency: "USD", plan: "pro", interval: "year", amount: 9000 },
  ];
  await page.route("**/api/billing/catalog*", route => route.fulfill({ json: {
    currencies: [{ currency: "USD", prices, methodGroups: ["invoice"], plans: {} }],
  } }));
  await page.route("**/api/billing/promo/check", route => route.fulfill({ json: {
    code: "WELCOME", currency: "USD", discount: 200, total: 800,
  } }));
  let returned: URL | undefined;
  await page.route(`**/api/orgs/${org.id}/billing/checkout`, route => {
    const body = route.request().postDataJSON();
    expect(body.priceId).toBe("pro-month");
    expect(body.promoCode).toBe("WELCOME");
    expect(body.consent.autopay).toBe(true);
    returned = new URL(body.returnUrl);
    return route.fulfill({ json: { invoiceId: "fixture-1", widget: { kind: "instructions", text: "Invoice sent" } } });
  });
  await page.goto("/org/billing?lang=en&org=" + org.slug);
  await page.locator(".billing-status-card button").click();
  const chooser = page.locator(".billing-choose");
  const pay = chooser.getByRole("button", { name: /^Pay / });
  await expect(pay).toContainText("$10.00");
  await expect(pay).toBeDisabled();
  await chooser.getByRole("checkbox").check();
  await chooser.locator("summary").click();
  await chooser.locator(".billing-promo input").fill("welcome");
  await expect(pay).toBeDisabled();
  await chooser.locator(".billing-promo button").click();
  await expect(pay).toContainText("$8.00");
  await chooser.getByRole("radio", { name: "Year", exact: true }).check();
  await expect(pay).toBeDisabled();
  await expect(pay).toContainText("$90.00");
  await chooser.getByRole("radio", { name: "Month", exact: true }).check();
  await chooser.locator(".billing-promo button").click();
  await pay.click();
  await expect(page.locator(".billing-instructions")).toContainText("Invoice sent");
  expect(returned?.pathname).toBe("/org/billing");
  expect(returned?.searchParams.get("org")).toBe(org.id);
  expect(returned?.searchParams.get("lang")).toBe("en");
});

test("an administrator can edit active rooms without changing a private room outside the directory", async ({ page, browser }) => {
  const admin = await register(page, "picker-admin", { title: "Visible room" });
  const guest = await browser.newContext();
  try {
    const peer = await guest.newPage();
    const member = await register(peer, "picker-member");
    const invite = await page.request.post(`/api/orgs/${admin.orgId}/invitations`, { data: { email: member.email } });
    expect(invite.ok()).toBeTruthy();
    const token = new URL((await invite.json()).url).searchParams.get("invite");
    expect((await peer.request.post("/api/invitations/accept", { data: { token } })).ok()).toBeTruthy();
    const hidden = await peer.request.post(`/api/orgs/${admin.orgId}/boards`, { data: { title: "Private room" } });
    expect(hidden.ok()).toBeTruthy();
    const hiddenId = (await hidden.json()).board.id;
    const additional = await page.request.post(`/api/orgs/${admin.orgId}/boards`, { data: { title: "Second visible room" } });
    expect(additional.ok()).toBeTruthy();
    await page.goto("/org/billing?lang=en&org=" + admin.orgId);
    const picker = page.locator(".billing-rooms");
    await picker.locator("button").first().click();
    await expect(picker.getByRole("checkbox", { name: "Visible room", exact: true })).toBeChecked();
    await expect(picker).not.toContainText("Private room");
    await expect(picker.locator(".billing-rooms-count")).toContainText("3 of 5");
    await picker.getByRole("checkbox", { name: "Visible room", exact: true }).uncheck();
    await picker.getByRole("button", { name: "Save", exact: true }).click();
    await expect(picker.locator(".billing-rooms-saved")).toHaveText("Saved");
    await page.reload();
    await picker.locator("button").first().click();
    await expect(picker.getByRole("checkbox", { name: "Visible room", exact: true })).not.toBeChecked();
    await expect(picker.locator(".billing-rooms-count")).toContainText("2 of 5");
    await peer.goto("/?room=" + hiddenId + "&lang=en");
    await expect(peer.locator(".save-state")).toHaveAttribute("data-state", "saved");
    await expect(peer.getByRole("button", { name: "Sticky note", exact: true })).toBeEnabled();
  } finally { await guest.close(); }
});

test("a real Free plan explains a PDF refusal and keeps a sixth room in the trash", async ({ page }) => {
  const owner = await register(page, "limit-surface");
  await openBoard(page, owner.boardId);
  await openBoardMenu(page);
  await page.getByRole("menuitem", { name: /^(?:Export|Экспорт)/ }).click();
  const pdf = page.getByRole("radio", { name: /^PDF/i });
  await expect(pdf.locator(".paid-feature-plan")).toHaveText(/pro/i);
  await pdf.click();
  const notice = page.locator(".plan-notice");
  await expect(notice).toContainText("PDF");
  await expect(notice.getByRole("button", { name: "See plans" })).toBeVisible();
  const create = async (title: string) => {
    const answer = await page.request.post(`/api/orgs/${owner.orgId}/boards`, { data: { title } });
    expect(answer.ok()).toBeTruthy();
    return (await answer.json()).board.id;
  };
  const archived = await create("Архив на апрель");
  expect((await page.request.delete("/api/boards/" + encodeURIComponent(archived))).ok()).toBeTruthy();
  for (let i = 0; i < 4; i++) await create("Active " + i);
  const organisations = (await (await page.request.get("/api/orgs")).json()).orgs;
  const org = organisations.find((entry: {id: string}) => entry.id === owner.orgId);
  await page.goto("/rooms?lang=en&trash=1&org=" + org.slug);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(notice).toContainText("5");
  await notice.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator(".home-tile")).toContainText("Архив на апрель");
});
