/**
 * The operator side of remo's support widget (ADR-250, `spec/support.md` §2.2–§2.4).
 *
 * This file runs on `support.<domain>` and never on the app origin. It has one job:
 * translate the messages `SupportPanel` posts into Chatwoot SDK calls, and report the two
 * facts the app may want back. The page is always framed, so every outbound message is
 * pinned to the configured app origin and every inbound message is checked against it.
 *
 * The protocol is exactly the one `apps/web/src/SupportPanel.tsx` already speaks:
 *
 *   in   { type: "remo:support:identity",  identity  }  signed identity, on every load
 *        { type: "remo:support:technical", technical }  opt-in context, null withdraws it
 *        { type: "remo:support:reset"                }  forget this person on sign-out
 *        { type: "remo:support:label",     label     }  a quick action's label (spec §2.4)
 *   out  { type: "remo:support:ready"                }  the SDK accepted a session
 *        { type: "remo:support:unread",    count     }  agent messages while chat is closed
 *
 * Every name carries the same prefix: a page that also hosts another chat widget cannot
 * mistake a short `reset` for its own. The payload shapes are the panel's, not a second
 * schema — `identity` and `technical` are objects, `technical: null` is a withdrawal.
 *
 * Chatwoot also posts its own messages to this window (`chatwoot-widget:…` strings from
 * the nested widget frame). They are ignored here: only the app origin is trusted.
 */
(() => {
  "use strict";

  const MESSAGE = {
    identity: "remo:support:identity",
    technical: "remo:support:technical",
    reset: "remo:support:reset",
    label: "remo:support:label",
    ready: "remo:support:ready",
    unread: "remo:support:unread",
  };

  /** The labels Chatwoot knows for support (spec §3.2). Anything else is dropped. */
  const LABELS = new Set([
    "question",
    "bug",
    "idea",
    "billing",
    "account",
    "ai-resolved",
    "ai-handoff",
    "needs-docs",
  ]);

  /** Identity attributes the core sends; a page cannot smuggle extra fields through. */
  const IDENTITY_ATTRIBUTE_KEYS = [
    "remo_user_id",
    "plan",
    "org_id",
    "org_name",
    "lang",
    "app_version",
    "region",
  ];

  /**
   * Technical context as Chatwoot custom attributes. The operator creates these names in
   * the Chatwoot dashboard first; an undefined attribute is silently ignored by Chatwoot.
   */
  const TECHNICAL_ATTRIBUTE_KEYS = [
    "remo_app",
    "remo_browser",
    "remo_os",
    "remo_lang",
    "remo_viewport",
    "remo_room",
    "remo_room_role",
    "remo_connection",
    "remo_errors",
  ];

  const TEXT_LIMIT = 200;
  const ERROR_LIMIT = 300;
  const ERRORS_LIMIT = 4000;
  const ERROR_COUNT = 20;
  const UNREAD_LIMIT = 99;

  const status = document.getElementById("support-status");

  function fail(reason) {
    console.error("[remo-support]", reason);
    if (!status) return;
    status.textContent =
      "Support is not configured. The operator must check deploy/support/README.md.";
    status.hidden = false;
  }

  function warn(reason) {
    console.warn("[remo-support]", reason);
  }

  /** A value from `widget.html`; a placeholder means the operator skipped a step. */
  function setting(name) {
    const meta = document.querySelector(`meta[name="${name}"]`);
    return meta?.getAttribute("content")?.trim() ?? "";
  }

  /**
   * `https://host[:port]` and nothing else. Loopback over http is the one development
   * exception, because a local widget page cannot get a certificate.
   */
  function origin(value, label) {
    if (!value || value.includes("__")) {
      fail(`${label} is still a placeholder`);
      return null;
    }
    let url;
    try {
      url = new URL(value);
    } catch {
      fail(`${label} is not a URL: ${value}`);
      return null;
    }
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    const schemeAllowed = url.protocol === "https:" || (loopback && url.protocol === "http:");
    if (url.origin !== value || !schemeAllowed) {
      fail(`${label} must be a bare https origin: ${value}`);
      return null;
    }
    return url.origin;
  }

  const APP_ORIGIN = origin(setting("remo-app-origin"), "remo-app-origin");
  const CHATWOOT_BASE_URL = origin(setting("chatwoot-base-url"), "chatwoot-base-url");
  const CHATWOOT_WEBSITE_TOKEN = setting("chatwoot-website-token");

  if (!APP_ORIGIN || !CHATWOOT_BASE_URL) return;
  if (!CHATWOOT_WEBSITE_TOKEN || CHATWOOT_WEBSITE_TOKEN.includes("__")) {
    fail("chatwoot-website-token is still a placeholder");
    return;
  }

  /** ru/en from the panel; Chatwoot falls back to its own default for anything else. */
  function localeFromUrl() {
    const requested = new URLSearchParams(window.location.search).get("lang");
    return requested === "ru" || requested === "en" ? requested : "en";
  }

  const locale = localeFromUrl();
  document.documentElement.lang = locale;

  window.chatwootSettings = {
    hideMessageBubble: true,
    position: "left",
    locale,
    widgetStyle: "flat",
    darkMode: "auto",
  };

  const state = {
    ready: false,
    pending: [],
    resetting: false,
    unread: 0,
  };

  /** Only the app origin can hear anything; `*` would leak the conversation id. */
  function post(message) {
    if (window.parent === window) return;
    window.parent.postMessage(message, APP_ORIGIN);
  }

  function reportUnread() {
    post({ type: MESSAGE.unread, count: state.unread });
  }

  /** Chatwoot needs its session before `setUser`; messages before that wait in order. */
  function whenReady(action) {
    if (state.ready) {
      run(action);
      return;
    }
    state.pending.push(action);
  }

  function run(action) {
    try {
      action();
    } catch (error) {
      warn(error instanceof Error ? error.message : String(error));
    }
  }

  function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function text(value, limit = TEXT_LIMIT) {
    return typeof value === "string" && value.length > 0 ? value.slice(0, limit) : "";
  }

  function cleanIdentity(raw) {
    if (!object(raw)) return null;
    const identifier = text(raw.identifier, 128);
    const hash = text(raw.identifierHash, 128);
    if (!identifier || !/^[a-f0-9]{64}$/i.test(hash)) return null;
    const name = text(raw.name);
    const email = text(raw.email);
    // `setUser` throws without one of name, email or avatar_url.
    if (!name && !email) return null;

    const attributes = {};
    const source = object(raw.attributes) ? raw.attributes : {};
    for (const key of IDENTITY_ATTRIBUTE_KEYS) {
      const value = source[key];
      if (typeof value === "string") attributes[key] = value.slice(0, TEXT_LIMIT);
      else if (typeof value === "number" && Number.isFinite(value)) attributes[key] = value;
      else if (typeof value === "boolean") attributes[key] = value;
      // Null plan/org mean "unknown"; Chatwoot already treats a missing key that way.
    }
    return { identifier, hash, name, email, attributes };
  }

  function applyIdentity(raw) {
    const identity = cleanIdentity(raw);
    if (!identity) {
      warn("dropped an identity without a valid identifier, hash, name or email");
      return;
    }
    whenReady(() => {
      const sdk = window.$chatwoot;
      sdk.setUser(identity.identifier, {
        ...(identity.name ? { name: identity.name } : {}),
        ...(identity.email ? { email: identity.email } : {}),
        identifier_hash: identity.hash,
      });
      if (Object.keys(identity.attributes).length > 0) {
        sdk.setCustomAttributes(identity.attributes);
      }
    });
  }

  function cleanTechnical(raw) {
    if (raw === null) return null;
    if (!object(raw)) return undefined;

    const attributes = {};
    for (const [key, attribute] of [
      ["app", "remo_app"],
      ["browser", "remo_browser"],
      ["os", "remo_os"],
      ["lang", "remo_lang"],
      ["connection", "remo_connection"],
    ]) {
      const value = text(raw[key]);
      if (value) attributes[attribute] = value;
    }

    const viewport = object(raw.viewport) ? raw.viewport : null;
    if (viewport) {
      const width = Math.round(Number(viewport.width));
      const height = Math.round(Number(viewport.height));
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        attributes.remo_viewport = `${width}x${height}`;
      }
    }

    const room = object(raw.room) ? raw.room : null;
    if (room) {
      const id = text(room.id, 128);
      const role = text(room.role, 64);
      if (id) attributes.remo_room = id;
      if (role) attributes.remo_room_role = role;
    }

    if (Array.isArray(raw.errors) && raw.errors.length > 0) {
      const lines = raw.errors
        .slice(-ERROR_COUNT)
        .map((entry) => {
          if (!object(entry)) return "";
          const message = text(entry.message, ERROR_LIMIT);
          if (!message) return "";
          const at = Number(entry.at);
          // `toISOString` throws outside the Date range; an app timestamp is still data.
          const time =
            Number.isFinite(at) && Math.abs(at) <= 8.64e15
              ? new Date(at).toISOString()
              : "unknown time";
          return `${time} ${message}`;
        })
        .filter(Boolean);
      if (lines.length > 0) attributes.remo_errors = lines.join("\n").slice(0, ERRORS_LIMIT);
    }

    return Object.keys(attributes).length > 0 ? attributes : null;
  }

  function applyTechnical(raw) {
    const attributes = cleanTechnical(raw);
    if (attributes === undefined) {
      warn("dropped technical context that is neither an object nor null");
      return;
    }
    whenReady(() => {
      const sdk = window.$chatwoot;
      if (attributes === null) {
        // Withdrawal is explicit: the operator sees the attributes disappear.
        for (const key of TECHNICAL_ATTRIBUTE_KEYS) sdk.deleteCustomAttribute(key);
        return;
      }
      sdk.setCustomAttributes(attributes);
    });
  }

  function applyLabel(label) {
    if (typeof label !== "string" || !LABELS.has(label)) {
      warn(`dropped unknown label: ${String(label).slice(0, 40)}`);
      return;
    }
    whenReady(() => window.$chatwoot.setLabel(label));
  }

  function applyReset() {
    whenReady(() => {
      const sdk = window.$chatwoot;
      state.resetting = true;
      try {
        sdk.reset();
      } finally {
        state.resetting = false;
      }
      state.unread = 0;
      // `reset` closes the widget and reloads its frame; the page is the chat, so reopen.
      sdk.toggle("open");
      reportUnread();
    });
  }

  window.addEventListener("message", (event) => {
    // Two checks, because `origin` alone does not prove who sent the message.
    if (event.origin !== APP_ORIGIN) return;
    if (event.source !== window.parent) return;
    if (!object(event.data)) return;

    switch (event.data.type) {
      case MESSAGE.identity:
        applyIdentity(event.data.identity);
        break;
      case MESSAGE.technical:
        applyTechnical(event.data.technical);
        break;
      case MESSAGE.reset:
        applyReset();
        break;
      case MESSAGE.label:
        applyLabel(event.data.label);
        break;
      default:
      // The nested Chatwoot frame posts its own strings; anything else is not ours.
    }
  });

  /**
   * Chatwoot CE has no public "unread count" event. `chatwoot:on-message` fires for agent
   * messages that are not already on screen, and `chatwoot:opened` means the person is
   * reading, so the page can count honestly. A message in the open conversation is never
   * unread and never arrives here.
   */
  window.addEventListener("chatwoot:on-message", (event) => {
    const message = event.detail;
    // Message type 1 is the agent's message as the widget sees it.
    if (!object(message) || message.message_type !== 1) return;
    if (window.$chatwoot?.isOpen) return;
    state.unread = Math.min(state.unread + 1, UNREAD_LIMIT);
    reportUnread();
  });

  window.addEventListener("chatwoot:opened", () => {
    state.unread = 0;
    reportUnread();
  });

  // Without the bubble there is nothing to reopen the chat with; the frame stays filled.
  window.addEventListener("chatwoot:closed", () => {
    if (!state.ready || state.resetting) return;
    window.$chatwoot.toggle("open");
  });

  window.addEventListener("chatwoot:ready", () => {
    if (state.ready) return;
    state.ready = true;
    if (status) status.hidden = true;

    for (const action of state.pending.splice(0)) run(action);
    window.$chatwoot.toggle("open");
    post({ type: MESSAGE.ready });
    reportUnread();
  });

  window.addEventListener("chatwoot:error", (event) => {
    warn(`chatwoot error: ${String(event.detail ?? "unknown")}`);
  });

  const script = document.createElement("script");
  script.src = `${CHATWOOT_BASE_URL}/packs/js/sdk.js`;
  script.async = true;
  script.onload = () => {
    window.chatwootSDK.run({
      websiteToken: CHATWOOT_WEBSITE_TOKEN,
      baseUrl: CHATWOOT_BASE_URL,
    });
  };
  script.onerror = () => fail(`cannot load the Chatwoot SDK from ${CHATWOOT_BASE_URL}`);
  document.head.appendChild(script);
})();
