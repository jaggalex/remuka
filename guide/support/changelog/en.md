## How to read

The schema version is the number in the `schema_meta` table. The service applies `schema.sql`
at start and does not touch the database if the version is already current. Product changes
ship together with a schema version; there is no separate "documentation release".

## The product name

The product is called **Remuka** (Ремука); it used to be remo. The code name `remo` stays in
environment variables, database roles, headers, metrics, browser storage keys and the backup
format: existing installations depend on them, and renaming them would break those
installations (ADR-254). A backup made by an older version still restores, and a new file is
written as `.remuka-backup.json`. An installation's own name is set with
`REMO_PRODUCT_NAME`.

## Version 0.9.0

Version 0.9.0 is the redesign of the interface: paper and ink, one tool rail, one side panel, a command search and the run panel. Schema 42.

- **Paper and ink.** The chrome, the canvas and the objects share one look in the light and the dark theme. The colour of text, lines and icons follows the surface they lie on, so a room reads in both themes; a colour you chose yourself is kept and gets a thin halo when it is hard to read.
- **One rail and one side panel.** Seven tools and **More** (card, table, kanban, comment, templates) sit in one rail with undo and redo; a tool remembers its last colour or kind. Each selection has its own short bar ending with **…**, which opens the properties. Properties, comments and the agent share one side panel, and `Esc` closes it.
- **Shapes.** Rectangle, rounded rectangle, ellipse, diamond and triangle; the kind changes in place and keeps text, style and connectors. A drag draws a shape to size (`Shift` for a square or a circle, `Alt` from the centre).
- **Turning objects.** A shape, sticky note, text, image and frame turn with the round handle above the selection; `Shift` rounds to 15°, `⌘⇧←`/`⌘⇧→` turn by 15°.
- **Command search.** `⌘K` finds any action of the room; the canvas menu is built from the same list.
- **The run panel.** **Run** opens **Timer**, **Vote**, **Follow** and **Show** in one panel. The **Show** tab names every slide in words — an unnamed frame reads «Frame without a name» — and long names stay inside the panel.
- **Reactions.** A reaction stays readable for five seconds, floats straight up and then fades; with calm animations it holds in place and fades.
- **Comments.** Thread text is set for reading, the reply field is wide, `Enter` sends and `Shift+Enter` starts a new line. A new comment can be placed on a phone too.
- **Keys with a panel open.** Room shortcuts (`⌘D`, `⌘Z` and others) work while the run panel, the comments or the properties stay open; they pause only in a dialog, a menu or a field.
- **Calm animations and hints.** **Calm animations** is an account setting. A hint stops showing once you have used its action a few times, and **Show the hints again** brings them back.
- **Screens.** Sign-up, the home page, the empty room and the invitation follow the new mockups; long room and organisation names stay inside the page.

## Version 0.8.0

Everything listed under 0.5.0–0.8.0 shipped as one release, **0.8.0** (22 November 2026).

Version 0.8.0 added text formatting: headings, lists, checklists, links, inline code, Markdown and a paste from other applications.

- **Headings, lists and a checklist.** A sticky note, a text and a shape carry two heading levels, a bulleted and a numbered list and a checklist. A line format lives with the text and one `⌘Z` undoes it.
- **Format bar and keys.** The object panel gained H1, H2, lists, a checklist, inline code and a link. In the editor the bar follows the caret; outside the editor it changes every line of the object. The same actions have keys: `⌘K` for a link, `⌘E` for code, `⌘\` to clear formatting and the line format.
- **Links.** `example.com` is completed to `https://`, and an e-mail address to `mailto:`; only `http`, `https` and `mailto` are accepted. A link opens with `⌘Enter` in the editor and with `⌘`/`Ctrl`+click on the board, and **Remove link** keeps the text.
- **Markdown while typing.** `# `, `## `, `- `, `1. ` and `[ ] ` at the start of a line give a heading, a list or a checklist at once. The rules are switched on and off in the room settings.
- **Paste and copy.** Docs, Notion, Word, the web and Markdown bring headings, lists, checklists, marks, code and links; `⌘⇧V` pastes plain text. A copy puts HTML and Markdown on the clipboard, and an object pasted into an open note lands beside it.
- **Checklist on the board.** A box toggles with a click when you have edit permission in the room; one `⌘Z` undoes the change.
- **Markdown in the API and for the agent.** A command and an agent plan accept a `markdown` field, the server parses it into the same line format, and the projection writes `props.markdown` back. One package parses and writes it, so the browser and the server read the markup the same way.

## Version 0.7.0

Version 0.7.0 added plans and payment: plans with seats and limits, the **Plan & payment** tab, an invoice for a legal entity, payment through YooKassa and subscription renewal.

- **Plans.** Free, Pro, Team and Business. Free gives 5 seats, 5 rooms, 10 agent tasks a month and a 7-day trash; paid plans lift the room and agent-task limits and open PDF without a watermark, protected links, advanced roles, integrations and agents without a limit. The installation decides what a plan costs: a published price never changes, and a new one ships as a new version.
- **Seats.** An active organisation member and a guest with the editor role or higher in at least one of its rooms each take a seat. Viewers, commenters and public-link visitors take none. A personal organisation is always on Free; a plan is bought by a shared organisation.
- **Limits.** A request over a limit gets `402` with `PLAN_LIMIT` or `PLAN_FEATURE` and names the limit, the current value and the maximum. The interface shows what is limited and why, with a **See plans** button; a member without payment rights sees **Ask the organisation owner**.
- **Frozen rooms.** Rooms above the plan limit become read-only: their content stays, editing is off, and export and backup keep working. The owner chooses which rooms stay active.
- **Past due and renewal.** Billing renews a subscription itself through the saved method; a failed charge is retried on day 1, 3 and 6, and on day 7 the subscription is suspended. A repeated provider notice or renewal job changes nothing: the invoice is tied to the period and the charge to the attempt number.
- **Invoice for a legal entity.** Paying by invoice creates an invoice and a pending payment; the plan starts only after the operator marks the invoice paid. No card is needed for such an invoice.
- **YooKassa.** The connection is configured at the installation level: a payment is created through the API with an idempotency key, Russian bank cards and SBP are accepted, and the 54-FZ receipt is formed with the payment. Card data stays with the provider; Remuka keeps the card brand, the last four digits and the expiry.
- **Replacing a card.** A new payment method is entered on the provider's page; after the replacement renewal uses the new method and the old one is detached.
- **Without billing.** `REMO_BILLING=off` is the self-host default: no limits and no **Plan & payment** tab.

## Version 0.6.0

Version 0.6.0 brought images to the board: upload, display, replacement, a storage quota and backup.

- **Upload.** The **Image** button on the tool rail, dragging files from Finder or Explorer and pasting from the clipboard. PNG, JPEG, WebP, GIF and AVIF; SVG and HEIC are refused. Until the upload finishes only the author sees the object.
- **Object and object bar.** An image resizes from the corners and keeps its proportions. The object bar has **Replace**, **Description**, **Open** and **More**: download the original (with export permission) and restore the natural size.
- **Description.** A screen reader and the room search read the alt text of up to 500 characters; when the object has no name, the description becomes its name.
- **Viewing.** A double click or `Enter` opens the lightbox: the wheel and a pinch zoom in and out, dragging pans, a double click fits the picture, and `Esc` closes it.
- **Display.** The server prepares 256, 1024 and 2048 px variants by the long side and never upscales a small file; the board picks a variant by on-screen size and pixel density, loads only visible pictures and keeps decoded ones in a cache. A dominant colour shows while the file loads; a missing file or missing access gives the **Image unavailable** placeholder.
- **Permissions.** A file is read only through the app and only with access to the room that uses it; otherwise `404`. PNG and PDF export paint the picture, so it lands in the result.
- **Limits.** One file is up to 20 MB, a room holds up to 500 images, and the organisation storage is limited by its plan. The organisation settings gained a **Storage** section: usage, the limit and the rooms that take the most space. Without billing there is no quota, only the technical limits.
- **Backup.** Pictures are included in a room backup of up to 200 MiB; above that the backup is made without images, and after a restore the pictures become placeholders. Import processes the files again in the receiving organisation.
- **Deletion and storage.** Deleting an object does not delete its file: a collector frees the space 30 days after the last reference goes away. Files live in a directory on disk or in an S3-compatible service; the installation chooses the store.

## Version 0.5.0

Version 0.5.0 shipped on 20 November 2026. It added account mail: password reset, address confirmation and invitations.

- **Password reset.** The sign-in form has **Forgot password?**; the letter carries a single-use link that works for 60 minutes. After the change every session ends and a notice goes to the address.
- **Address confirmation.** A letter with a 24-hour link arrives after registration. The address can be confirmed in any browser, and the letter can be requested again.
- **Invitations by mail.** An invitation to an organisation or a room goes to the address; the link can still be copied. Until the address is confirmed, invitations are refused unless the administrator turned the requirement off.
- **Without mail.** `disabled` is the safe default: mail forms are not shown, and work and link invitations remain.

There is no billing or image work in this version.

## Schema versions

| Version | What it added |
|---|---|
| 4 | the event queue `event_outbox` |
| 5 | the organisation webhook `org_webhooks` and retry fields on events |
| 6 | integration tokens `integration_tokens` |
| 7 | the event deduplication key `dedupe_key` |
| 8 | organisation apps `org_apps` |
| 9 | comments: `comment_threads`, `comments`, `comment_reads` |
| 10 | an agent plan: `agent_task_plans`, statuses `proposed`/`approved`/`applied`/`rejected` |
| 11 | task input: `agent_task_inputs` with the `selection` source |
| 12 | account interface preferences: `users.theme`, `users.lang` |
| 13 | audit linked to the session: `audit_events.session_id` |
| 14 | idempotency indexes for commands and tasks |
| 15 | the mandatory unique `@handle`: `users.handle` |
| 16 | personal organisations and the home: `orgs.kind`, `boards.icon`, `boards.created_at`, `boards.created_by` |
| 17 | `org_id` on the tables tied to a room: existing rows filled from their rooms, and a trigger for new rows |
| 18 | organisation row-level isolation (RLS): policies on every table that holds tenant data, the `remo_app` application role, functions for the organisation lookup, agent tasks and the event queue |
| 20 | the room agent: `board_agents`, `agent_threads`, `agent_thread_messages`, `agent_tasks.thread_id` |
| 21 | the mail queue `mail_outbox`, account tokens `auth_tokens`, address confirmation `users.email_verified_at` |
| 22 | billing: price books, provider connections and events, subscriptions, invoices, payments, refunds, organisation credit, `boards.frozen_at` |
| 23 | billing mail: payment, renewal and subscription templates in `mail_outbox` |
| 24 | images: the `files` table |
| 25 | the owner-side organisation lookup for a file: `remo_file_org`, so reads work under RLS |
| 26 | support identity: `users.support_id` |
| 27 | the model gateway: `ai_runs.gateway_provider` |
| 28 | the cookie consent journal: `consent_events` |

Version 19 was never released. Versions 1–3 are the early line: rooms, access and the command journal. Databases created
earlier are upgraded by the same `schema.sql` at start.

## What changed in the product and documentation

| Date | What |
|---|---|
| 19.11.2026 | New lines remember the last style; frames nest and grow with their contents; cards can be reordered inside a cell and a column stripe recoloured; kanban titles can be renamed and reordered on the kanban itself; kanbans, frames and shapes lift off the board in three levels. |
| 17.11.2026 | One design system for buttons, fields, dialogs, type, spacing and colour. The properties panel shows one subject — the room, a kanban or the selection; cards look like paper, dates no longer clip, and vote counters and small print follow the zoom. Tooltips wait and close on Escape, the background grid is off by default, and table headers have size, weight, italic, colour and alignment. A release prepares the schema and RLS before the service starts. |
| 09.11.2026 | Room agent: assign an agent to a room, a draft appears in the room immediately, a shared thread, delegation to selected editors, undo of the latest draft and history deletion. Fifteen scenarios: process, sprint, requirements, MVP, retrospective, decision, meeting actions, prioritisation, competitors, architecture decision, ideas, dependencies, user flow, architecture and problem map. |
| 06.11.2026 | Rooms without an owner are closed: the API and the socket refuse, and the room is not in the room list; a claim returns the room and clears the archive. Organisation row-level isolation (RLS). Write quotas: `4429` when the rate is exceeded, `4413` when the room is full. Edits over the socket are audited as one row per session per 60 s window. |
| 04.11.2026 | Templates arrive in the profile language: Russian names, copy and kanban columns for a Russian account. The plus in an empty kanban cell creates a card and opens its editor immediately. |
| 04.11.2026 | The product says “room”: one noun in the interface and documentation; the technical `board.*` names remain identifiers. |
| 04.11.2026 | Every account has a personal organisation; the home shows room tiles with name search, sorting, 24-per-page, trash and emoji; switching organisation leaves the room. |
| 04.11.2026 | Presentation accepts any object, not only a frame; an object has a name, a read-only ID and **Copy ID**; search reads the name. |
| 04.11.2026 | A unique `@handle` beside the name: the account menu, presence and comments show `Name @handle`. |
| 04.11.2026 | An organisation and a team can be renamed, a team deleted and its members managed; the account display name is editable. |
| 03.11.2026 | Security and reliability pass: CSRF/Origin, sign-in limits, comment permissions, backup, webhooks, idempotency and crash recovery. |
| 02.11.2026 | An agent proposes a plan from text, a file or a selection: a preview with a map and warnings, Apply in one transaction, one ⌘Z; a plan above 300 objects is refused before it is stored. |
| 02.11.2026 | Tidy up lays a selection out by Auto, By prefix, By type, Grid and By meaning; blocks are frames, up to 50 objects, one ⌘Z. |
| 02.11.2026 | One palette for the rail and the object window: seven tones at three levels, with white, black and transparent in a separate column and keys 1–7. |
| 02.11.2026 | A new room screen: a header with menus, a creation rail, a bottom zoom bar; a frame and a shape resize with the corner handles. |
| 02.11.2026 | A connector joins a selection and an export only with both ends; an object has four ports, and a port click joins or creates a copy. |
| 02.11.2026 | An open voting session names who voted for what after it ends; the published result is ordinary text without markup. |
| 29.10.2026 | Voting happens in the room: a "+1"/"−1" counter on every object, a bar with the remaining votes and the clock; a session ends with the timer or its own deadline and closes by itself. |
| 29.10.2026 | "Delete?" and "replace?" questions belong to the app: no browser windows remain, and the link is shown in a normal field when the clipboard is refused. |
| 29.10.2026 | Security pass: the read-only socket decodes varints, co-owner requires `board.manage`, the invitation email is checked in the transaction, network boundaries answer 400/500, AI outbound checks every address and refuses redirects, `/access` returns no metadata. |
| 29.10.2026 | Current-slide comments in presentation; PNG/PDF with pins and a thread list |
| 29.10.2026 | A card can be a connector endpoint; the line follows its cell |
| 29.10.2026 | A card filter by assignee and due state selects cards without hiding the room |
| 29.10.2026 | A frame adopts an object whose centre lands inside and releases it on exit; one transaction with the move |
| 29.10.2026 | Documentation brought up to M0–M5: roles with `board.comment`, backup v2, new error codes, capability map, security and changelog |
| 28.10.2026 | M5: author lock, `Unlock all`, copies without a lock |
| 28.10.2026 | M4: server comments, pins, reactions, live frame, restore from backup |
| 28.10.2026 | M3: frame presentation, presenter/followers, late viewer |
| 28.10.2026 | M2: tag vocabulary, selection by tag, external and internal links |
| 28.10.2026 | M1: card status, assignee, date range, WIP |
| 28.10.2026 | M0: room creation, sticky focus, group name, object link |
| 28.10.2026 | Product Guide portal: RU/EN, `pnpm guide:check` in `pnpm verify` |
| 27.10.2026 | Integration tokens, webhook, events, apps — documentation for extensions |

## Where to look for behaviour, not a version

The schema version answers "what is in the database". What that means for a user is in
[Capability map](/guide/overview/map) and [Product model](/guide/concepts/board).

## Where to go next

[Upgrades and migrations](/guide/support/migrations) — how to move to a new version.
