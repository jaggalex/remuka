import { expect, test } from "@playwright/test";
import { goAllRooms, openBoard, register, setAccountTheme } from "./helpers";

/**
 * One mark on every surface (ADR-272, `spec/character.md` §3.8).
 *
 * The landing's coloured sign is the product's sign too. The smile is the one part that
 * follows the theme — graphite on paper in the light theme, paper on graphite in the dark
 * one — while the coral circle and the blue square never change. A CSS filter would make
 * the whole picture flip, which is the defect this scenario pins down.
 */
const LIGHT = {
  circle: "rgb(255, 138, 87)",
  square: "rgb(120, 180, 255)",
  smile: "rgb(63, 66, 86)",
};
const DARK = { ...LIGHT, smile: "rgb(251, 243, 223)" };

async function fills(page: import("@playwright/test").Page, selector: string) {
  const parts = page.locator(`${selector} circle, ${selector} rect, ${selector} path`);
  await expect(parts).toHaveCount(3);
  return parts.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fill));
}

test("the room header, home, help and sign-in carry the landing mark in both themes", async ({
  page,
}) => {
  // Signed out: the home's one action opens the sign-in dialog, which carries the mark
  // and the wordmark above the form.
  await page.goto("/?lang=en");
  await page.locator(".home-empty").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".auth-brand .rm-brand-word")).toHaveText("Remuka");
  expect(await fills(page, ".auth-brand .rm-brand-mark")).toEqual([
    LIGHT.circle,
    LIGHT.square,
    LIGHT.smile,
  ]);
  await page.keyboard.press("Escape");

  const account = await register(page, "brand-mark");
  await openBoard(page, account.boardId, { lang: "en" });
  // The room header has the mark alone at 24 px (spec §3.8).
  expect(await fills(page, ".topbar .rm-brand-mark")).toEqual([
    LIGHT.circle,
    LIGHT.square,
    LIGHT.smile,
  ]);

  await goAllRooms(page);
  expect(await fills(page, ".home-mark .rm-brand-mark")).toEqual([
    LIGHT.circle,
    LIGHT.square,
    LIGHT.smile,
  ]);

  await page.goto("/help/en");
  expect(await fills(page, ".help-brand .rm-brand-mark")).toEqual([
    LIGHT.circle,
    LIGHT.square,
    LIGHT.smile,
  ]);

  // Dark: the same picture, except the smile becomes paper. Nothing is inverted.
  await openBoard(page, account.boardId, { lang: "en" });
  await setAccountTheme(page, "dark");
  expect(await fills(page, ".topbar .rm-brand-mark")).toEqual([
    DARK.circle,
    DARK.square,
    DARK.smile,
  ]);
  await page.goto("/help/en");
  expect(await fills(page, ".help-brand .rm-brand-mark")).toEqual([
    DARK.circle,
    DARK.square,
    DARK.smile,
  ]);
});

test("both mark paths serve the source drawing", async ({ request }) => {
  for (const path of ["/remuka-mark.svg", "/remo-logo.svg"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const body = await response.text();
    expect(body, path).toContain('fill="#ff8a57"');
    expect(body, path).toContain('fill="#78b4ff"');
    expect(body, path).toContain('fill="#3f4256"');
    expect(body, path).not.toContain("#1E2A44");
    expect(body, path).not.toContain("inkscape");
  }
});
