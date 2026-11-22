import { beforeEach, describe, expect, it } from "vitest";
import type { StorageEntry } from "@remo/consent";
import {
  configureConsentGate,
  loadOptional,
  optionalAllowed,
  resetConsentGate,
  type GateEnvironment,
} from "./consentGate";

const ANALYTICS: StorageEntry = {
  name: "analytics.example",
  kind: "third-party",
  category: "analytics",
  owner: "support",
  purpose: { ru: "Аналитика", en: "Analytics" },
  lifetime: "1 year",
};

const REGISTRY: StorageEntry[] = [
  {
    name: "remo.lang",
    kind: "localStorage",
    category: "preferences",
    owner: "web",
    purpose: { ru: "Язык", en: "Language" },
    lifetime: "until cleared",
  },
  ANALYTICS,
];

function fakeEnvironment(): GateEnvironment & { removed: string[]; reloads: number } {
  const removed: string[] = [];
  return {
    removed,
    reloads: 0,
    remove(kind, name) {
      removed.push(`${kind}:${name}`);
    },
    reload() {
      this.reloads += 1;
    },
  };
}

const deny = {
  zone: "eu" as const,
  choices: { necessary: true, preferences: true, analytics: false, marketing: false },
  gpc: false,
};
const grant = {
  ...deny,
  choices: { necessary: true, preferences: true, analytics: true, marketing: true },
};

describe("the optional-script gate (§5)", () => {
  beforeEach(() => resetConsentGate());

  it("does not call the loader without consent", () => {
    const env = fakeEnvironment();
    configureConsentGate(deny, env, REGISTRY);
    let calls = 0;
    expect(loadOptional("analytics", () => (calls += 1))).toBe(false);
    expect(calls).toBe(0);
    expect(optionalAllowed("analytics")).toBe(false);
  });

  it("calls the loader once with an explicit yes", () => {
    configureConsentGate(grant, fakeEnvironment(), REGISTRY);
    let calls = 0;
    expect(loadOptional("analytics", () => (calls += 1))).toBe(true);
    expect(calls).toBe(1);
    expect(optionalAllowed("analytics")).toBe(true);
  });

  it("runs a loader that waited for the answer when the answer arrives", () => {
    configureConsentGate(deny, fakeEnvironment(), REGISTRY);
    let calls = 0;
    loadOptional("analytics", () => (calls += 1));
    expect(calls).toBe(0);
    configureConsentGate(grant, fakeEnvironment(), REGISTRY);
    expect(calls).toBe(1);
    // A second publish of the same state must not load it twice.
    configureConsentGate(grant, fakeEnvironment(), REGISTRY);
    expect(calls).toBe(1);
  });

  it("keeps the loader off under Global Privacy Control, even with a yes", () => {
    configureConsentGate({ ...grant, gpc: true }, fakeEnvironment(), REGISTRY);
    let calls = 0;
    expect(loadOptional("analytics", () => (calls += 1))).toBe(false);
    expect(calls).toBe(0);
  });

  it("never loads optional tracking in the none zone", () => {
    configureConsentGate({ ...grant, zone: "none" }, fakeEnvironment(), REGISTRY);
    let calls = 0;
    loadOptional("analytics", () => (calls += 1));
    expect(calls).toBe(0);
  });

  it("purges the category and reloads once when consent is withdrawn", () => {
    const env = fakeEnvironment();
    configureConsentGate(grant, env, REGISTRY);
    let calls = 0;
    loadOptional("analytics", () => (calls += 1));
    configureConsentGate(deny, env, REGISTRY);
    expect(calls).toBe(1);
    expect(env.removed).toEqual(["third-party:analytics.example"]);
    expect(env.reloads).toBe(1);
    // The same refusal published again is not a second withdrawal.
    configureConsentGate(deny, env, REGISTRY);
    expect(env.reloads).toBe(1);
    // And a loader registered after the withdrawal stays off.
    expect(loadOptional("analytics", () => (calls += 1))).toBe(false);
    expect(calls).toBe(1);
  });

  it("does not purge a category that never ran", () => {
    const env = fakeEnvironment();
    configureConsentGate(grant, env, REGISTRY);
    configureConsentGate(deny, env, REGISTRY);
    expect(env.removed).toEqual([]);
    expect(env.reloads).toBe(0);
  });
});
