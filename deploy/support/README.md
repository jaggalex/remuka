# Support widget page (`support.<domain>`)

This directory is the operator's side of Remuka's support surface (ADR-250,
`spec/support.md` §2.2–§2.4). It is **not** part of `apps/web` and it never runs on the
app origin:

- `widget.html` / `widget.js` — a static page that loads the Chatwoot SDK, opens the chat
  over the whole frame, and translates the app's `postMessage` protocol into Chatwoot SDK
  calls;
- `nginx.conf` — a server block that serves only those two files, allows framing by one
  app origin, and refuses everything else.

The app frames `https://support.<domain>/widget.html?lang=ru|en` inside `SupportPanel` with
a sandbox and `referrerpolicy="no-referrer"`. No third-party script is ever loaded on the
app origin; this page is the sandbox boundary.

## 1. Replace the placeholders

Three values in `widget.html` and one in `nginx.conf`:

| Placeholder | Where | Value |
|---|---|---|
| `__REMO_APP_ORIGIN__` | `widget.html` meta `remo-app-origin` | the app origin, exactly as in `REMO_APP_ORIGIN`, e.g. `https://boards.example.com` |
| `__REMO_APP_ORIGIN__` | `nginx.conf`, `frame-ancestors` | the same value, without a trailing slash |
| `__CHATWOOT_BASE_URL__` | `widget.html` meta `chatwoot-base-url` | the origin that serves Chatwoot, e.g. `https://support.example.com` |
| `__CHATWOOT_WEBSITE_TOKEN__` | `widget.html` meta `chatwoot-website-token` | the **website** inbox token from Chatwoot (Inbox → Configuration) |
| `support.example.com` | `nginx.conf` | your real host and certificate paths |

`widget.js` validates the origins and refuses to load the SDK while a placeholder remains.
Both origins must be bare `https://host[:port]` values; `http://localhost` and
`http://127.0.0.1` are accepted only for development.

Render everything at deploy time (never commit the filled file with a real token):

```sh
sed -e 's|__REMO_APP_ORIGIN__|https://boards.example.com|g' \
    -e 's|__CHATWOOT_BASE_URL__|https://support.example.com|g' \
    -e 's|__CHATWOOT_WEBSITE_TOKEN__|REPLACE_WITH_WEBSITE_TOKEN|g' \
    deploy/support/widget.html > /srv/remo-support/widget.html
cp deploy/support/widget.js /srv/remo-support/widget.js
```

## 2. Serve it next to Chatwoot

`support.<domain>` normally hosts both the static page and Chatwoot. Two arrangements work:

1. **One vhost.** Copy the `location ~ ^/(widget\.html|widget\.js)$` block and its headers
   from `nginx.conf` into Chatwoot's server block, with `root /srv/remo-support`. Keep
   Chatwoot's own `/widget`, `/packs/`, `/api/` and `/cable` locations. Do not copy the
   `location / { return 404; }` stub.
2. **Separate origins.** Keep this server block as it is and point
   `__CHATWOOT_BASE_URL__` at the Chatwoot origin. Then widen the page CSP to
   `script-src 'self' https://chat.example.com; frame-src https://chat.example.com` and add
   that origin to Chatwoot's allowed domains.

Required headers on the page, and why:

- `Content-Security-Policy: frame-ancestors https://boards.example.com` — exactly one
  origin. A wildcard would let any site frame the support chat.
- **No `X-Frame-Options: DENY` or `SAMEORIGIN`.** Either one blocks the app's iframe. The
  example omits the header entirely; do not inherit it from a server-level `add_header`.
- `X-Content-Type-Options: nosniff` — the two files are served with their real types.
- `Referrer-Policy: no-referrer` — the app already sends it on the iframe, and the page
  repeats it so the Chatwoot request cannot carry the room URL.
- `script-src 'self'` — `widget.js` and Chatwoot's `/packs/js/sdk.js` come from this origin.

Check the headers before opening the app:

```sh
curl -sI https://support.example.com/widget.html |
  grep -iE 'content-security-policy|x-frame-options|referrer-policy|content-type-options'
```

Expect `frame-ancestors https://boards.example.com` and **no** `X-Frame-Options` line.

## 3. Chatwoot settings

1. Create a **Website** inbox named for the product (spec §3.2). Copy its website token into
   `__CHATWOOT_WEBSITE_TOKEN__`; this is not an API access token.
2. **Identity Validation: on, mandatory.** Copy the HMAC key into the core's
   `REMO_SUPPORT_HMAC_SECRET`. Without it anyone can write as another person; with it the
   `identifier_hash` sent by the app is verified by Chatwoot.
3. **Pre-chat form: off.** The identity is already known.
4. Create these **contact custom attributes** (Settings → Custom attributes) before the
   first conversation; Chatwoot ignores an attribute that is not defined:

   | Attribute | Type | Source |
   |---|---|---|
   | `remo_user_id`, `plan`, `org_id`, `org_name`, `lang`, `app_version`, `region` | text | signed identity from `/api/support/identity` |
   | `remo_app` | text | `version+build` |
   | `remo_browser`, `remo_os`, `remo_lang`, `remo_connection` | text | technical context, only after consent |
   | `remo_viewport` | text | `1440x900` |
   | `remo_room`, `remo_room_role` | text | room id and role; never the title or content |
   | `remo_errors` | text (multiline) | last 20 client errors, one per line |

   The technical attributes arrive only when the person ticks "Attach technical
   information", and are deleted when they untick it (the panel sends `technical: null`).
   A page reload alone does not delete what an earlier, consented session stored.
5. Labels used by quick actions: `question`, `bug`, `idea`, `billing`, `account`,
   `ai-resolved`, `ai-handoff`, `needs-docs`. The page rejects any other label.

## 4. Core settings

On the Remuka side (see `docs/self-hosting.md`):

```sh
REMO_SUPPORT_PROVIDER=chatwoot
REMO_SUPPORT_ORIGIN=https://support.example.com   # origin only, no path, no trailing slash
REMO_SUPPORT_HMAC_SECRET=...                      # same key as Identity Validation
```

`REMO_SUPPORT_ORIGIN` is rendered into the app CSP by `render_support_headers` in
`deploy/config.sh`; restart the app and confirm the response has
`frame-src https://support.example.com` and one origin only.

## 5. Message protocol

The names and payload shapes are the ones `apps/web/src/SupportPanel.tsx` already sends.
Messages from the app are accepted only when **both** `event.origin` is the configured app
origin and `event.source` is the parent window. Messages to the app always use
`targetOrigin = REMO_APP_ORIGIN`; the page never posts to `*`.

| Direction | `type` | Payload | Effect |
|---|---|---|---|
| app → page | `remo:support:identity` | `{ identity: { identifier, identifierHash, name, email, attributes } }` | `$chatwoot.setUser(identifier, { name, email, identifier_hash })`, then `setCustomAttributes` for `remo_user_id`, `plan`, `org_id`, `org_name`, `lang`, `app_version`, `region` |
| app → page | `remo:support:technical` | `{ technical: { app, browser, os, lang, viewport, room, connection, errors } }` | `setCustomAttributes` with the `remo_*` names above |
| app → page | `remo:support:technical` | `{ technical: null }` | deletes every technical attribute (consent withdrawn) |
| app → page | `remo:support:reset` | `{}` | `$chatwoot.reset()`, clears the local identity/technical state, reopens the chat |
| app → page | `remo:support:label` | `{ label: "question" \| "bug" \| "idea" \| … }` | `$chatwoot.setLabel(label)`; only labels from the list above |
| page → app | `remo:support:ready` | `{}` | the SDK finished loading and the chat was opened |
| page → app | `remo:support:unread` | `{ count }` | agent messages received while the chat was closed, capped at 99; reset to `0` on open |

Payloads that fail validation are dropped with a `console.warn`, never partially applied:
an identity needs a non-empty `identifier`, a 64-hex `identifierHash`, and a name or email;
technical context must be an object or `null`.

The page opens the chat on `chatwoot:ready` and keeps it open: with
`hideMessageBubble: true` there is no launcher to reopen it, so the panel's own close button
is the only way out.

### Quick actions and the unread counter

The page accepts the `label` message and reports `unread`, but the app side of both is not
finished yet. `SupportPanel` currently sends only `identity`, `technical` and `reset`; it
draws no "Ask a question / Report a bug / Idea" row (spec §2.4) and does not listen for
`unread` or `ready`. This page is ready for those messages when the panel adds them.

The unread count itself is honest but usually `0` in the current embedding: the panel
mounts the frame only while the panel is open, and the page opens the chat immediately, so
the app never hears about a message that arrives while the panel is closed. A real menu
badge needs the frame (or at least its `unread` value) to survive the panel closing.

## 6. Verify

```sh
# 1. The script parses and the config surface is intact.
node --check deploy/support/widget.js
node -e '
  const fs = require("fs");
  const html = fs.readFileSync("deploy/support/widget.html", "utf8");
  for (const p of ["__REMO_APP_ORIGIN__", "__CHATWOOT_BASE_URL__", "__CHATWOOT_WEBSITE_TOKEN__"]) {
    if (!html.includes(p)) throw new Error("missing " + p);
  }
  console.log("html ok");
'

# 2. The page is served and only the app may frame it.
curl -sI https://support.example.com/widget.html | grep -i frame

# 3. In the app: Help and support → the chat fills the panel.
#    In Chatwoot: the contact shows the person's name, email and remo_* attributes.
#    Tick "Attach technical information" → remo_app/remo_browser/… appear.
#    Untick → they disappear. Sign out → the Chatwoot conversation is reset.
```

Directly opening `https://support.example.com/widget.html` in a browser is a valid smoke
test for Chatwoot and the SDK, but not for the protocol: without the app's frame there is
no parent window to exchange messages with.

## 7. Troubleshooting

- **Blank frame, console "frame-ancestors".** The app origin in `nginx.conf` and in the
  `remo-app-origin` meta tag differ, or `X-Frame-Options` is still inherited.
- **Chat loads but the person is anonymous.** Identity Validation rejected the hash: the
  core's `REMO_SUPPORT_HMAC_SECRET` and the inbox key differ, or the token is an API token
  instead of the website token.
- **Attributes do not appear.** Chatwoot custom attributes were not created, or were
  created with different names (they are case-sensitive).
- **The page says "Support is not configured".** A placeholder was left in `widget.html`;
  the browser console names the exact meta tag.
