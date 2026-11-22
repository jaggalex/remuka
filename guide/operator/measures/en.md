## When to apply a measure

A measure restricts access when content breaks the rules: spam, threats, illegal material, fraud. It is not a punishment of a member but an answer to a specific link, room or organisation. Every measure states a reason for the customer and a reason for the journal, and the organisation's administrators receive a letter.

| Action | When | What it restricts |
|---|---|---|
| Disable a link | a public link leads to unacceptable content | public access by link only; members keep working |
| Hide a room | the room's content breaks the rules, not just one link | everyone except the organisation's administrators |
| Suspend an organisation | the breach is systemic or repeated | the whole organisation's work in this installation |
| Revert | the complaint is resolved or the measure was a mistake | lifts the chosen measure |
| List | you need to see open measures | changes nothing |

## What people see

| Who | Disabled link | Hidden room | Suspended organisation |
|---|---|---|---|
| Visitor by link | 404, as for a page that does not exist | 404 | 404 |
| Room member | keeps working in the room and sees the notice "The link was disabled by the operator: reason" | 404 | cannot open a room; the API answers `ORG_SUSPENDED` |
| Organisation administrator | receives the letter; works as usual | sees the room and the notice "The room was hidden by the operator: reason" | receives the letter; export and backup remain available |

Nothing is deleted: a measure closes access, it does not erase the room. Reverting restores everything as it was.

## Complaints in the console

The **Complaints** tab lists open measures: kind, target (room, link or organisation), author, reason and date.

**A new measure.** Paste a room's address from the address bar (or its id), or find an organisation by name or administrator address. Then choose the kind and enter a reason of at least 10 characters. A room offers "Disable the link" and "Hide the room"; an organisation offers "Suspend the organisation".

The reason from the form reaches the administrators in an `operator_action` letter and is shown in the participants' notice: write it so the client understands what was violated and how to appeal. The complaint reference (`reportRef`) is optional in the console form and stays in the journal.

**Lift the measure** is a button on every row. It returns access and sends the administrators a restoration letter; the reason for lifting is required. A double click and a repeated submission do not create a second measure: the form carries a `requestId`, and the server returns the first answer.

In the journal a console measure carries the channel `console` and the second factor; a server command carries `cli`.

## Commands

```sh
pnpm abuse:link-disable --link <id>   --reason "internal reason" --public "what the customer sees" [--report <ref>] --as ops@example.com
pnpm abuse:board-hide   --board <id>  --reason "internal reason" --public "what the customer sees" [--report <ref>] --as ops@example.com
pnpm abuse:org-suspend  --org <id>    --reason "internal reason" --public "what the customer sees" [--report <ref>] --as ops@example.com
pnpm abuse:revert <measure-id> --reason "why we lift it" --as ops@example.com
pnpm abuse:list [--open] [--limit 100]
```

| Flag | Meaning |
|---|---|
| `--link`, `--board`, `--org` | the subject of the measure: a link, a room or an organisation |
| `--reason` | the internal reason; stored in the journal, required |
| `--public` | the text for administrators and the notice; required |
| `--report` | the letter or complaint number this measure answers; optional |
| `--as` | the author of the command; `REMO_OPERATOR` is the fallback |
| `--open` | open measures only |
| `--limit` | how many rows to show, from 1 to 500 |

Write `--public` so that a person understands what was broken and what to do. That text goes to the customer and onto the notice; keep internal details and names in `--reason`.

## The letter to administrators

A measure without its letter is not applied. Before writing anything, the command checks that the organisation has an active administrator and that mail is configured; if the letter cannot be queued, the measure is rolled back.

The letter says what was restricted, the public reason and the appeal address — a reply to the letter or `abuse@` in your zone. It goes to every administrator of the organisation in their language.

## Reverting

`abuse:revert` closes the measure and sends the administrators a letter that access is restored. A second call says the measure is already lifted and changes nothing. The journal gets `abuse.reverted` with the reason.

If the restoration letter cannot be queued, access is still restored, but the command exits with an error. In that case tell the administrators by hand.

## Check

- `abuse:list --open` shows the new measure with its public and internal reasons.
- A visitor by a disabled link gets 404; a member sees the notice with the public reason.
- A hidden room opens only under an organisation administrator; everyone else gets 404.
- Under suspension the API answers `ORG_SUSPENDED`, while export under an organisation administrator still works.
- The administrators received the letter with the reason and the appeal address.
- After `abuse:revert` the notice disappears, access returns, and the journal has a row about the reversal.

## If something goes wrong

| Message | Cause | What to do |
|---|---|---|
| `no room <id>` | the room is not in this installation | check the id on the customer card |
| `has no enabled public link` | the room has no enabled public link | there is nothing to disable; check whether another measure already hid the room |
| `no organisation <id>` | a wrong organisation id | find it by an administrator's address |
| `has no active administrator` | the organisation has no active administrator | there is nobody to write to, so the measure is not applied; restore an administrator first |
| `mail is disabled` | mail is off in this installation | turn mail on; a measure without an explanation is not created |
| `no complaint address` | the appeal address is not configured | set the abuse address in the installation settings |
| `already open` | the same measure is already in force | open `abuse:list --open`; a second row is not needed |
| `does not take --…` | an extra flag for this command | compare with the flag table |

## Where next

[Money](/guide/operator/money) — refunds, credit and manual payments with the same required reason.
