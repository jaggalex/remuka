# Changelog

Ремука (Remuka) is at **0.8.0**. The user-facing history, with dates and the decisions
behind each step, is maintained in the product guide:

- [Changelog (EN)](guide/support/changelog/en.md)
- [История изменений (RU)](guide/support/changelog/ru.md)

## [Unreleased]

**The product is now Ремука / Remuka (formerly remo), ADR-254.** The name changes wherever
a person sees it: interface, mail, exports, the in-app help and this guide. The code name
`remo` does not change: package names, the `REMO_*` variables, database roles, HTTP headers,
metrics, browser storage keys and the backup format stay as they are, so an existing
installation updates without editing its environment or database.

Self-hosters get two new settings:

- `REMO_PRODUCT_NAME` shows the installation's own name instead of the brand. The older
  `REMO_MAIL_PRODUCT_NAME` is still read as a synonym and logs a deprecation warning once.
- `REMO_APP_ORIGIN_ALIASES` and `REMO_APP_ORIGIN_MOVED` let an installation change its public
  address without breaking bookmarks, integration tokens, MCP clients or open tabs: old
  origins keep answering with `Deprecation: true`, pages redirect with the same path and
  query, and a socket on a retired origin closes with `4001 moved` so the browser reloads.

A backup still named `.remo-backup.json` imports; a new backup is written as
`.remuka-backup.json`. Both formats are recognised by `manifest.format`, which is unchanged.

## [0.2.0] - 2026-11-07

Hardening and tenant isolation: closed rooms without an owner, socket quotas and edit audit, RLS for every tenant table, camera and spatial performance, Biome and dependency audit.

## [0.2.1] - 2026-11-08

Dependency security update for the build and test toolchain; no product behaviour changes.

## [0.3.0] - 2026-11-09

Room agent: assign an agent to a room, drafts written in the room, a shared thread, delegation to selected editors, undo and history deletion. Fifteen skills: process, sprint, requirements, MVP, retrospective, decision, meeting actions, prioritisation, competitors, architecture decision, ideas, dependencies, user flow, architecture and problem map.

## [0.4.0] - 2026-11-17

Design system migration, one-subject properties panel, paper cards, zoom-aware small print, tooltips, background grid off by default, table header typography, and a release database preflight. Schema version stays 20.

## [0.4.1] - 2026-11-19

Line style is remembered per new line; frames nest and grow with their contents; cards can be reordered inside a cell and a column stripe recoloured; kanban titles can be renamed and reordered on the kanban; kanbans, frames and shapes lift off the board in three levels. Includes automatic e2e report retention and the release-check transport retry. Schema stays 20.

## [0.8.0] - 2026-11-22

The first release since 0.4.1 ships four modules together; the guide keeps their separate
records, and this entry is the single release they belong to.

**Mail.** Account mail through one outbox: password reset, address verification and invitations, with `disabled` as the safe default and `console`, `smtp` and `resend` drivers. Single-use links (60 minutes for a reset, 24 hours for verification) and no usable link stored at rest. Schema 21.

**Images.** Upload by the rail button, drag or paste; proportional resize, replacement, alt text and a lightbox; 256, 1024 and 2048 px variants, dominant-colour placeholders and a bitmap cache; reads only through the app with room access; an organisation storage quota with per-room usage; image assets in the room backup. Schema 24 and 25.

**Billing and payments.** Free, Pro, Team and Business plans with seats, rooms and agent-task limits; one entitlements function; frozen rooms above the limit; the plan and payment tab; an invoice for a legal entity; YooKassa; renewal through a saved card with retries on days 1, 3 and 6; a gated fake provider for the client path. Schema 22 and 23.

**Rich text v2.** Two heading levels, bulleted and numbered lists, checklists, inline code and links, line formats undone as one step, Markdown input rules, the format bar and a clipboard round-trip through one HTML and Markdown boundary; a `markdown` field for commands, agent plans and the projection. No schema change.

Release notes for a version are written from that page; the ADR records the reasons.
