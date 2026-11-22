/**
 * The gate for optional scripts (§5 of `spec/cookies.md`, ADR-255).
 *
 * Optional code — analytics, marketing — is loaded through `loadOptional` and nowhere
 * else. The function runs only when the category is granted for this zone and this
 * browser: an unanswered visitor, the `none` zone and Global Privacy Control all mean no.
 * Calls made before `/consent` answers are remembered and run on a later grant, which is
 * the normal order — page code starts before the server's answer arrives.
 *
 * A withdrawal purges the category's registry records and reloads the page when something
 * of that category already ran, because a script cannot be unloaded in place. Nothing is
 * removed for a category that never ran: removing records the code did not write would be
 * a destructive guess.
 */
import { STORAGE_REGISTRY } from "@remo/consent";
import type { ConsentCategory, StorageEntry } from "@remo/consent";
import { categoryAllowed, type ConsentView } from "./consentClient";
import type { ComplianceZone } from "./compliance";

/** One optional loader, remembered so a later grant can still run it. */
interface Registration {
  readonly category: ConsentCategory;
  readonly load: () => void;
  ran: boolean;
}

/** The browser side effects, injectable so the gate is testable without a DOM. */
export interface GateEnvironment {
  /** Remove one record of a withdrawn category, by the registry's own name. */
  remove(kind: StorageEntry["kind"], name: string): void;
  /** Reload the page after a script of the withdrawn category ran (§5). */
  reload(): void;
}

/** What the app tells the gate whenever the choice or the zone changes. */
export interface GateState {
  readonly zone: ComplianceZone;
  readonly choices: ConsentView["choices"];
  readonly gpc: boolean;
}

const registrations = new Set<Registration>();
let state: GateState = {
  zone: "none",
  choices: { necessary: true, preferences: true, analytics: false, marketing: false },
  gpc: false,
};
let environment: GateEnvironment = defaultEnvironment();
let registry: readonly StorageEntry[] = STORAGE_REGISTRY;
let reloaded = false;

/** A no-op outside a browser: a server render or a unit test must not touch the DOM. */
function defaultEnvironment(): GateEnvironment {
  const browser = typeof document !== "undefined" || typeof localStorage !== "undefined";
  return {
    remove(kind, name) {
      if (!browser) return;
      try {
        if (kind === "cookie") {
          document.cookie = `${name}=; Max-Age=0; Path=/`;
        } else if (kind === "localStorage") {
          localStorage.removeItem(name);
        } else if (kind === "sessionStorage") {
          sessionStorage.removeItem(name);
        } else if (kind === "indexedDB" && typeof indexedDB !== "undefined") {
          indexedDB.deleteDatabase(name);
        }
      } catch {
        // A browser that refuses storage has nothing of this category to remove.
      }
    },
    reload() {
      if (!browser) return;
      window.location.reload();
    },
  };
}

/** Whether this category may run under the last state the app published. */
export function optionalAllowed(category: ConsentCategory): boolean {
  return categoryAllowed(state, category);
}

function run(registration: Registration): void {
  if (registration.ran) return;
  registration.ran = true;
  try {
    registration.load();
  } catch (error) {
    // A third-party tag must never take the page down with it.
    console.error("[consent] optional script failed:", error);
  }
}

/** Remove every registry record of one category; the registry is the only list. */
function purge(category: ConsentCategory): void {
  for (const entry of registry) {
    if (entry.category === category) environment.remove(entry.kind, entry.name);
  }
}

/**
 * Publish the current choice.
 *
 * A category that stops being allowed after its script ran is withdrawn: its storage is
 * purged and the page reloads once. A grant runs the loaders that waited for it. The
 * registry is a parameter for the same reason as the zone: the test can prove the purge
 * with a fake tracking record the shipped registry does not have yet.
 */
export function configureConsentGate(
  next: GateState,
  nextEnvironment: GateEnvironment = environment,
  nextRegistry: readonly StorageEntry[] = registry,
): void {
  const previous = state;
  environment = nextEnvironment;
  registry = nextRegistry;
  state = next;
  for (const registration of registrations) {
    const allowed = categoryAllowed(next, registration.category);
    const wasAllowed = categoryAllowed(previous, registration.category);
    if (allowed && !registration.ran) run(registration);
    if (!allowed && (registration.ran || wasAllowed)) {
      purge(registration.category);
      registration.ran = false;
      if (!reloaded) {
        reloaded = true;
        environment.reload();
      }
    }
  }
}

/**
 * Run `load` only with consent for `category`; return whether it ran now.
 *
 * `false` is not an error: the loader stays registered, so a person who grants the
 * category in the settings screen loads it without a reload of the page code.
 */
export function loadOptional(category: ConsentCategory, load: () => void): boolean {
  const registration = { category, load, ran: false };
  registrations.add(registration);
  if (!categoryAllowed(state, category)) return false;
  run(registration);
  return true;
}

/** Forget every registration and the last state. Tests start from here. */
export function resetConsentGate(): void {
  registrations.clear();
  state = {
    zone: "none",
    choices: { necessary: true, preferences: true, analytics: false, marketing: false },
    gpc: false,
  };
  reloaded = false;
  environment = defaultEnvironment();
  registry = STORAGE_REGISTRY;
}
