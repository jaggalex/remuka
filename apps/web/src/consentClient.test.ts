import { describe, expect, it } from "vitest";
import { POLICY_VERSION, STORAGE_REGISTRY } from "@remo/consent";
import type { StorageEntry } from "@remo/consent";
import {
  ConsentOutdatedError,
  bulkChoices,
  categoryAllowed,
  categoryRows,
  consentSurface,
  globalPrivacyControl,
  hasTracking,
  policyRows,
  readConsentAnswer,
  saveConsent,
  unansweredChoices,
  type ConsentView,
} from "./consentClient";
import { ApiError } from "./apiCall";
import { LIFETIME_KEYS, lifetimeKey } from "./consentText";

const tracking: StorageEntry[] = [
  {
    name: "analytics.example",
    kind: "third-party",
    category: "analytics",
    owner: "support",
    purpose: { ru: "Аналитика", en: "Analytics" },
    lifetime: "1 year",
  },
];

/** The four categories the settings screen can show, in the registry's shape. */
const allKinds: StorageEntry[] = [
  ...STORAGE_REGISTRY,
  {
    name: "analytics.example",
    kind: "third-party",
    category: "analytics",
    owner: "support",
    purpose: { ru: "Аналитика", en: "Analytics" },
    lifetime: "1 year",
  },
  {
    name: "marketing.example",
    kind: "third-party",
    category: "marketing",
    owner: "support",
    purpose: { ru: "Реклама", en: "Marketing" },
    lifetime: "1 year",
  },
];

function view(overrides: Partial<ConsentView> = {}): ConsentView {
  return {
    zone: "ru",
    answered: false,
    choices: unansweredChoices("ru"),
    gpc: false,
    ...overrides,
  };
}

describe("the cookie surface of a zone (§3, §6)", () => {
  it("shows the short notice in Russia while only necessary storage exists", () => {
    expect(consentSurface(view())).toBe("notice");
    expect(consentSurface(view({ answered: true }))).toBe("none");
  });

  it("shows nothing in the EU before a tracking category exists", () => {
    expect(consentSurface(view({ zone: "eu" }))).toBe("none");
    expect(consentSurface(view({ zone: "eu", answered: true }))).toBe("none");
  });

  it("shows nothing at all in the none zone", () => {
    expect(consentSurface(view({ zone: "none" }))).toBe("none");
    expect(consentSurface(view({ zone: "none", answered: true }))).toBe("none");
  });

  it("shows the banner in both zones as soon as tracking is in the registry", () => {
    expect(consentSurface(view({ zone: "eu" }), tracking)).toBe("banner");
    expect(consentSurface(view(), tracking)).toBe("banner");
    expect(consentSurface(view({ zone: "none" }), tracking)).toBe("none");
    expect(consentSurface(view({ answered: true }), tracking)).toBe("none");
  });

  it("treats Global Privacy Control as a refusal, so the banner is not shown again", () => {
    expect(consentSurface(view({ zone: "eu", gpc: true }), tracking)).toBe("none");
    expect(consentSurface(view({ gpc: true }), tracking)).toBe("none");
  });

  it("reads the browser signal defensively", () => {
    expect(globalPrivacyControl({ globalPrivacyControl: true })).toBe(true);
    for (const value of [
      undefined,
      null,
      {},
      { globalPrivacyControl: false },
      { globalPrivacyControl: "1" },
      "navigator",
    ]) {
      expect(globalPrivacyControl(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("what a category may do (§1 rule 2, §5)", () => {
  it("always allows necessary storage and never optional tracking by default", () => {
    expect(categoryAllowed(view({ zone: "none" }), "necessary")).toBe(true);
    for (const zone of ["eu", "ru", "none"] as const) {
      expect(categoryAllowed(view({ zone }), "analytics"), zone).toBe(false);
      expect(categoryAllowed(view({ zone }), "marketing"), zone).toBe(false);
    }
  });

  it("allows tracking only with an explicit yes", () => {
    const granted = unansweredChoices("eu");
    expect(categoryAllowed(view({ zone: "eu", choices: granted }), "analytics")).toBe(false);
    expect(
      categoryAllowed(
        view({ zone: "eu", choices: { ...granted, analytics: true, marketing: true } }),
        "analytics",
      ),
    ).toBe(true);
  });

  it("ignores a yes under Global Privacy Control and in the none zone", () => {
    const granted = {
      necessary: true,
      preferences: true,
      analytics: true,
      marketing: true,
    } as const;
    expect(categoryAllowed(view({ zone: "eu", choices: granted, gpc: true }), "analytics")).toBe(
      false,
    );
    expect(categoryAllowed(view({ zone: "none", choices: granted }), "marketing")).toBe(false);
  });

  it("treats the person's own settings as necessary in both zones", () => {
    expect(categoryAllowed(view({ zone: "eu" }), "preferences")).toBe(true);
    expect(categoryAllowed(view({ zone: "ru" }), "preferences")).toBe(true);
  });

  it("saves both tracking categories together from the banner", () => {
    expect(bulkChoices(true)).toEqual({ analytics: true, marketing: true });
    expect(bulkChoices(false)).toEqual({ analytics: false, marketing: false });
  });
});

describe("the server's answer and the request (§4)", () => {
  const answer = {
    zone: "eu",
    policyVersion: POLICY_VERSION,
    choices: { necessary: true, preferences: true, analytics: true, marketing: false },
  };

  it("accepts an answer for this zone and normalizes it", () => {
    expect(readConsentAnswer(answer, "eu")).toEqual({
      zone: "eu",
      policyVersion: POLICY_VERSION,
      choices: { necessary: true, preferences: true, analytics: true, marketing: false },
    });
  });

  it("treats a missing cookie, a foreign zone and a malformed body as no answer", () => {
    for (const value of [
      null,
      undefined,
      {},
      { ...answer, zone: "ru" },
      { ...answer, policyVersion: "" },
      { ...answer, policyVersion: 42 },
      { ...answer, choices: null },
    ]) {
      expect(readConsentAnswer(value, "eu"), JSON.stringify(value)).toBeNull();
    }
    expect(readConsentAnswer(answer, "none")).toBeNull();
  });

  it("posts the zone, the policy edition and the two optional categories", async () => {
    const sent: Record<string, unknown>[] = [];
    const stored = await saveConsent("eu", bulkChoices(true), async (payload) => {
      sent.push(payload);
      return { ...answer, zone: payload.zone, policyVersion: payload.policyVersion };
    });
    expect(sent).toEqual([
      {
        zone: "eu",
        policyVersion: POLICY_VERSION,
        choices: { analytics: true, marketing: true },
      },
    ]);
    expect(stored?.choices.analytics).toBe(true);
  });

  it("never asks the service about necessary or preferences", async () => {
    const sent: Record<string, unknown>[] = [];
    await saveConsent(
      "ru",
      { necessary: false, preferences: false, analytics: true } as never,
      async (payload) => {
        sent.push(payload);
        return { ...answer, zone: payload.zone, policyVersion: payload.policyVersion };
      },
    );
    const choices = (sent[0]?.choices ?? {}) as Record<string, unknown>;
    expect(Object.keys(choices).sort()).toEqual(["analytics", "marketing"]);
    expect(choices).not.toHaveProperty("preferences");
    expect(choices).not.toHaveProperty("necessary");
  });

  it("does not post in the none zone", async () => {
    let called = false;
    const stored = await saveConsent("none", bulkChoices(true), async () => {
      called = true;
      return answer;
    });
    expect(stored).toBeNull();
    expect(called).toBe(false);
  });

  it("reads the policy edition of the POST answer, like GET", async () => {
    const stored = await saveConsent("eu", bulkChoices(false), async () => ({
      zone: "eu",
      policyVersion: POLICY_VERSION,
      choices: { necessary: true, preferences: true, analytics: false, marketing: false },
      expiresAt: "2027-05-21T00:00:00.000Z",
    }));
    expect(stored).toMatchObject({ zone: "eu", policyVersion: POLICY_VERSION });
    expect(stored?.choices.analytics).toBe(false);
  });

  it("reads an older POST answer without the field under the edition of the request", async () => {
    const stored = await saveConsent("eu", bulkChoices(false), async () => ({
      zone: "eu",
      choices: { necessary: true, preferences: true, analytics: false, marketing: false },
      expiresAt: "2027-05-21T00:00:00.000Z",
    }));
    expect(stored?.policyVersion).toBe(POLICY_VERSION);
  });

  it("turns 409 POLICY_OUTDATED into an error that names the current edition", async () => {
    await expect(
      saveConsent("eu", bulkChoices(true), async () => {
        throw new ApiError(409, "POLICY_OUTDATED", "the cookie policy changed", {
          current: "2027-01",
        });
      }),
    ).rejects.toMatchObject({ name: "ConsentOutdatedError", current: "2027-01" });

    // A 409 for another reason is not the same thing and keeps its own error.
    await expect(
      saveConsent("eu", bulkChoices(true), async () => {
        throw new ApiError(409, "ZONE_MISMATCH", "another zone", { zone: "ru" });
      }),
    ).rejects.not.toBeInstanceOf(ConsentOutdatedError);
  });

  it("throws when the service does not confirm the choice, or answers for another zone", async () => {
    await expect(saveConsent("eu", bulkChoices(false), async () => null)).rejects.toThrow();
    await expect(
      saveConsent("eu", bulkChoices(false), async () => ({ ...answer, zone: "ru" })),
    ).rejects.toThrow();
  });
});
describe("the settings rows and the policy table (§6.2, §6.4)", () => {
  it("keeps necessary on and immovable, and locks preferences while it is necessary", () => {
    const rows = categoryRows(view());
    const necessary = rows.find((row) => row.category === "necessary");
    expect(necessary).toMatchObject({ enabled: true, locked: true, lock: "necessary" });
    expect(necessary?.entries.length).toBeGreaterThan(0);
    const preferences = rows.find((row) => row.category === "preferences");
    expect(preferences).toMatchObject({ enabled: true, locked: true });
  });

  it("adds a tracking row only when the registry has one, and locks it under GPC", () => {
    expect(categoryRows(view()).some((row) => row.category === "analytics")).toBe(false);
    const rows = categoryRows(view({ zone: "eu" }), allKinds);
    expect(rows.map((row) => row.category)).toEqual([
      "necessary",
      "preferences",
      "analytics",
      "marketing",
    ]);
    const analytics = rows.find((row) => row.category === "analytics");
    expect(analytics).toMatchObject({ enabled: false, locked: false, lock: null });
    const locked = categoryRows(view({ zone: "eu", gpc: true }), allKinds).find(
      (row) => row.category === "analytics",
    );
    expect(locked).toMatchObject({ enabled: false, locked: true, lock: "gpc" });
  });

  it("lists every registry record exactly once, grouped by category", () => {
    const rows = policyRows();
    expect(rows).toHaveLength(STORAGE_REGISTRY.length);
    expect(new Set(rows.map((row) => `${row.kind}:${row.name}`)).size).toBe(STORAGE_REGISTRY.length);
    const order = ["necessary", "preferences", "analytics", "marketing"];
    const positions = rows.map((row) => order.indexOf(row.category));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("translates every lifetime the registry uses", () => {
    for (const entry of STORAGE_REGISTRY) {
      expect(lifetimeKey(entry.lifetime), entry.name).toBeTruthy();
      expect(LIFETIME_KEYS[entry.lifetime], entry.name).toBeTruthy();
    }
  });

  it("has tracking only when the registry says so", () => {
    expect(hasTracking()).toBe(false);
    expect(hasTracking(tracking)).toBe(true);
  });
});
