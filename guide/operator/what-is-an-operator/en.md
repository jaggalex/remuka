## What this is

An installation operator is the person who runs the Remuka server. The role gives them customer metadata, money, measures against abuse and the journal of what operators did. It does not open room content: no text, images or comments. Room names are absent from the customer card as well.

The role exists separately in each installation. On the EU server and on the Russian server these are different people with different accounts: one installation never shows the other's customers.

## Two levels of management

| Level | Who | What they do | Where |
|---|---|---|---|
| Organisation administrator | the customer: a team, school or family owner | invites people, grants roles, blocks members, reads the organisation's journal, pays | the organisation dialog in the app |
| Installation operator | the person who runs the server | reads metrics, finds a customer, marks a payment, refunds money, applies measures against abuse, reads the journal | the `/operator` console and server commands |

An organisation administrator is responsible for their organisation. An operator is responsible for the whole installation but sees metadata only: the organisation, plan, subscription, invoices and payments, member and room counts, dates, accepted documents and the operator's own measures.

## What the role does not give

- **No access to rooms.** The customer card has the number of rooms, not their names. If a complaint needs the content, the complainant sends it: a link, a screenshot or an excerpt.
- **No "see and change everything" mode.** There is no route that bypasses a room's access check and no way to edit somebody else's document.
- **No role changes from the interface.** The operator role changes only through a command on the server. That keeps a hijacked browser from becoming a way to gain rights.
- **No silent plan or money changes.** Every such command carries an author and leaves a journal row; refunds, credit and manual payments also require a reason.
- **No customers from the other installation.** The EU and Russian installations have separate databases; only metric aggregates may be shared, and only later.

## How it differs from an organisation administrator

| | Organisation administrator | Installation operator |
|---|---|---|
| What they see | content of their rooms, members, their organisation's journal | metadata of every organisation in this installation |
| Whom they change | members and their roles in their own organisation | no roles; an account is deleted only at the person's request or by a court order |
| Money | pays invoices | marks payments, refunds money, grants credit |
| Abuse | answers the letter | applies a measure and explains the reason |
| Sign-in | password, second factor optional | password and a mandatory second factor |

## What an operator does

- [The first operator](/guide/operator/first-operator) — grant the role on a new installation.
- [Console](/guide/operator/console) — sign in to `/operator` and understand the screen.
- [Pulse](/guide/operator/pulse) — read the installation's metrics.
- [Customers](/guide/operator/customers) — find a customer and answer a request.
- [Journal](/guide/operator/journal) — check who did what.
- [Measures against abuse](/guide/operator/measures) — disable a link, hide a room, suspend an organisation.
- [Money](/guide/operator/money) — mark a payment, refund money, grant credit.
- [Two-factor sign-in](/guide/operator/totp) — protect your account.
- [Account deletion](/guide/operator/account-deletion) — act on a person's request or a court order.
- [Limits of the role](/guide/operator/limits) — what is out of reach and where to escalate.

## Check

- `pnpm operator:list` shows your address among this installation's operators.
- `/operator` opens under your account and answers "Page not found" under an account without the role.
- `pnpm customer:show --email <address>` shows the number of rooms but not their names.
- A direct link to a customer's room follows the ordinary access check: the operator role does not bypass it.

## If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| `/operator` answers 404 although the role is held | the second factor is not enrolled yet, or the role was revoked | [Enrol the second factor](/guide/operator/totp) or check `pnpm operator:list` |
| Your address is not in the operator list | the role was not granted in this installation | [Grant it](/guide/operator/first-operator); it does not carry over from another installation |
| The customer card has no room names | that is how the role works | ask the complainant for a link or screenshot; see [Limits of the role](/guide/operator/limits) |
| You need to change room content | the role does not allow it | a member with edit rights does that |

## Where next

[The first operator](/guide/operator/first-operator) — how to grant the role on an installation that has none yet.
