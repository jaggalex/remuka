/**
 * One registry of everything the product puts in a browser (ADR-255, `spec/cookies.md` §2).
 *
 * The registry is the only description of browser storage: the policy page renders it, the
 * consent banner lists it and `scripts/consent-check.mjs` fails when code uses a key that is
 * not here (or lists a key that no code uses). A second place describing the same cookie is
 * the defect this module exists to prevent.
 *
 * `name` is the exact storage key or cookie name; a trailing `*` means a prefix pattern
 * (`remo.verifyBanner.*` is one key per account). `lifetime` mirrors the constant the code
 * sets, because the policy page shows it to a person.
 */

/**
 * The edition of the cookie policy and of this registry (§4).
 *
 * `remo_consent` carries it, `POST /consent` records it, and a change that alters what a
 * category means gets a new edition. It is part of a cookie value, so it never contains a
 * dot: `2026-11` is the first edition.
 */
export const POLICY_VERSION = "2026-11";

/** The four categories of §2. Only `necessary` is always on. */
export const CATEGORIES = Object.freeze(["necessary", "preferences", "analytics", "marketing"]);

/** Every kind of browser storage the product may use (§2). */
export const KINDS = Object.freeze([
  "cookie",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "third-party",
]);

/**
 * Where a record comes from. `sync` sets a server cookie, `web` is the application, `docs`
 * is the guide and landing build (§9 stage 5) and `support` is the Chatwoot frame (§7).
 */
export const OWNERS = Object.freeze(["sync", "web", "support", "docs"]);

/**
 * The rules of one category. `necessary` is the storage the requested service needs, so a
 * choice may never turn it off — `normalizeChoices` and the zone gate both rely on this.
 *
 * `preferences` keeps its own category in the registry, because the policy page groups it
 * apart from signing in, but it is not a question: a setting the person chose themselves is
 * necessary for the requested service in every zone (§2, §6), so no zone policy turns it
 * into a switch and `POST /consent` never receives it.
 */
export const CATEGORY_RULES = Object.freeze({
  necessary: Object.freeze({ optional: false, disabledByDefault: false }),
  // `optional: false` is the decision, not an oversight: the person's own language and
  // theme are necessary for the requested service, so no switch may turn them off (§2, §6).
  preferences: Object.freeze({ optional: false, disabledByDefault: false }),
  analytics: Object.freeze({ optional: true, disabledByDefault: true }),
  marketing: Object.freeze({ optional: true, disabledByDefault: true }),
});

/**
 * Every browser-side record of the 0.8.0 code. The list was reconciled with the code by
 * grepping `localStorage`, `sessionStorage`, `document.cookie` and the cookie builders in
 * `apps/sync`; a key found there is added with a category and a purpose, never deleted.
 *
 * `remo.board` and `remo.board.backup` are *format identifiers* in `backupFormat.ts`, not
 * storage keys, so they are not here: an entry no file uses would fail §8 rule 4.
 */
export const STORAGE_REGISTRY = Object.freeze(
  [
    {
      name: "remo_session",
      kind: "cookie",
      category: "necessary",
      owner: "sync",
      purpose: {
        ru: "Вход в аккаунт: сессия, которая держит вас в системе",
        en: "Keeps you signed in",
      },
      // Mirrors `SESSION_DAYS` in apps/sync/iam-http.mjs.
      lifetime: "30 days",
      httpOnly: true,
    },
    {
      name: "remo_csrf",
      kind: "cookie",
      category: "necessary",
      owner: "sync",
      purpose: {
        ru: "Защита форм от подделки запросов с чужого сайта",
        en: "Protects forms from cross-site request forgery",
      },
      // Mirrors `CSRF_MAX_AGE` in apps/sync/csrf.mjs. The app's own script reads it.
      lifetime: "30 days",
      httpOnly: false,
    },
    {
      name: "remo_link_unlock",
      kind: "cookie",
      category: "necessary",
      owner: "sync",
      purpose: {
        ru: "Доступ к комнате по ссылке-приглашению",
        en: "Remembers access granted by an invite link",
      },
      // Mirrors the `maxAge` in `linkUnlockCookie` in apps/sync/iam-http.mjs.
      lifetime: "12 hours",
      httpOnly: true,
    },
    {
      name: "remo_visitor",
      kind: "cookie",
      category: "necessary",
      owner: "sync",
      purpose: {
        ru: "Один голос гостя в опросе комнаты",
        en: "One guest vote per room poll",
      },
      // Mirrors `Max-Age=31536000` in apps/sync/vote-api.mjs.
      lifetime: "1 year",
      httpOnly: true,
    },
    {
      name: "remo_consent",
      kind: "cookie",
      category: "necessary",
      owner: "sync",
      purpose: {
        ru: "Ваш выбор по cookie и когда он сделан",
        en: "Your cookie choice and when it was made",
      },
      // `Max-Age` follows the zone's `choiceTtlDays`: 180 days in the EU, 365 in Russia
      // (§3). The value is data, so the policy page and the cookie cannot drift.
      lifetime: "6 months (EU) / 12 months (Russia)",
      httpOnly: false,
    },
    {
      name: "remo.identity",
      kind: "localStorage",
      category: "necessary",
      owner: "web",
      purpose: {
        ru: "Имя и цвет гостя в комнате",
        en: "Your guest name and colour in a room",
      },
      lifetime: "until cleared",
    },
    {
      name: "remo.session",
      kind: "sessionStorage",
      category: "necessary",
      owner: "web",
      purpose: {
        ru: "Ключ присутствия этой вкладки",
        en: "This tab's presence key",
      },
      lifetime: "browser session",
    },
    {
      name: "remo.settings",
      kind: "localStorage",
      category: "preferences",
      owner: "web",
      purpose: {
        ru: "Настройки редактора: сетка, привязка, шрифты",
        en: "Editor settings: grid, snapping, fonts",
      },
      lifetime: "until cleared",
    },
    {
      name: "remo.lang",
      kind: "localStorage",
      category: "preferences",
      owner: "web",
      purpose: {
        ru: "Выбранный язык интерфейса",
        en: "Your interface language",
      },
      lifetime: "until cleared",
    },
    {
      name: "remo.theme",
      kind: "localStorage",
      category: "preferences",
      owner: "web",
      purpose: {
        ru: "Светлая или тёмная тема",
        en: "Light or dark theme",
      },
      lifetime: "until cleared",
    },
    {
      name: "remo.canvas.hint",
      kind: "localStorage",
      category: "preferences",
      owner: "web",
      purpose: {
        ru: "Подсказка о холсте уже показана",
        en: "The canvas hint has been shown",
      },
      lifetime: "until cleared",
    },
    {
      name: "remo.inspector",
      kind: "localStorage",
      category: "preferences",
      owner: "web",
      purpose: {
        ru: "Открыта ли панель инспектора",
        en: "Whether the inspector panel is open",
      },
      lifetime: "until cleared",
    },
    {
      name: "remo.moveBanner.dismissed",
      kind: "sessionStorage",
      category: "preferences",
      owner: "web",
      purpose: {
        ru: "Плашка о переезде закрыта до конца сеанса",
        en: "The move notice is dismissed for this session",
      },
      lifetime: "browser session",
    },
    {
      name: "remo.verifyBanner.*",
      kind: "sessionStorage",
      category: "preferences",
      owner: "web",
      purpose: {
        ru: "Напоминание подтвердить почту скрыто до конца сеанса",
        en: "The email confirmation reminder is hidden for this session",
      },
      lifetime: "browser session",
    },
    {
      name: "remo.legal.upcoming.*",
      kind: "sessionStorage",
      category: "preferences",
      owner: "web",
      purpose: {
        ru: "Баннер о новой редакции документа закрыт до конца сеанса",
        en: "The new-revision banner is dismissed for this session",
      },
      lifetime: "browser session",
    },
    {
      name: "guide.theme",
      kind: "localStorage",
      category: "preferences",
      owner: "docs",
      purpose: {
        ru: "Тема портала документации",
        en: "The documentation site theme",
      },
      lifetime: "until cleared",
    },
    {
      name: "support.remuka.com",
      kind: "third-party",
      category: "necessary",
      owner: "support",
      purpose: {
        ru: "Чат поддержки, который загружается, только когда вы его открыли",
        en: "The support chat, loaded only when you open it",
      },
      // §7 makes the frame a requested service. Its own storage is first-party to the
      // support host; the operator's Chatwoot instance verifies the exact keys.
      lifetime: "until cleared",
    },
  ].map((entry) => Object.freeze({ ...entry, purpose: Object.freeze(entry.purpose) })),
);

const NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9.*_-]*$/;

/**
 * The registry's own invariants, as text lines for a gate or a test.
 *
 * The checker refuses to run on a registry that describes an unknown kind or category, so a
 * typo in the data cannot quietly switch a category off.
 */
export function validateRegistry(registry = STORAGE_REGISTRY) {
  const problems = [];
  if (!Array.isArray(registry) || registry.length === 0) {
    return ["the registry must be a non-empty array"];
  }
  const seen = new Set();
  for (const [index, entry] of registry.entries()) {
    const at = `entry ${index + 1}`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${at}: not an object`);
      continue;
    }
    if (typeof entry.name !== "string" || !NAME_SHAPE.test(entry.name)) {
      problems.push(`${at}: name must be a storage key or a pattern with '*', got ${JSON.stringify(entry.name)}`);
    }
    if (!KINDS.includes(entry.kind)) {
      problems.push(`${at} (${entry.name}): unknown kind ${JSON.stringify(entry.kind)}`);
    }
    if (!CATEGORIES.includes(entry.category)) {
      problems.push(
        `${at} (${entry.name}): unknown category ${JSON.stringify(entry.category)}; one of ${CATEGORIES.join(", ")}`,
      );
    }
    if (!OWNERS.includes(entry.owner)) {
      problems.push(
        `${at} (${entry.name}): unknown owner ${JSON.stringify(entry.owner)}; one of ${OWNERS.join(", ")}`,
      );
    }
    for (const locale of ["ru", "en"]) {
      const text = entry.purpose?.[locale];
      if (typeof text !== "string" || !text.trim()) {
        problems.push(`${at} (${entry.name}): purpose.${locale} is missing`);
      }
    }
    if (typeof entry.lifetime !== "string" || !entry.lifetime.trim()) {
      problems.push(`${at} (${entry.name}): lifetime is missing`);
    }
    if (entry.httpOnly !== undefined) {
      if (entry.kind !== "cookie") {
        problems.push(`${at} (${entry.name}): httpOnly belongs to a cookie only`);
      } else if (typeof entry.httpOnly !== "boolean") {
        problems.push(`${at} (${entry.name}): httpOnly must be a boolean`);
      }
    }
    const identity = `${entry.kind}:${entry.name}`;
    if (seen.has(identity)) problems.push(`${at} (${entry.name}): duplicate ${entry.kind} record`);
    seen.add(identity);
  }
  return problems;
}

/**
 * Whether a pattern from the registry covers a name found in code. Both sides may carry a
 * `*` (the code builds `remo.verifyBanner.${id}` and cannot know the id), so the pattern is
 * tested against a stand-in for the code's wildcard.
 */
export function nameMatches(pattern, name) {
  if (typeof pattern !== "string" || typeof name !== "string") return false;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(name.replace(/\*/g, "probe"));
}

/**
 * Whether a category is a question at all. False for `necessary`, for `preferences` (the
 * person's own settings are necessary in every zone, §2) and for an unknown category,
 * which a caller must not guess at.
 */
export function categoryCanBeDisabled(category) {
  const rule = CATEGORY_RULES[category];
  return rule ? rule.optional : false;
}

/** Whether the registry contains a category that needs an explicit yes (§3). */
export function hasOptionalTracking(registry = STORAGE_REGISTRY) {
  return registry.some((entry) => entry.category === "analytics" || entry.category === "marketing");
}
