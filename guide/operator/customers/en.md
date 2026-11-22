## What this is

The customer card answers a support question: "who is this person, which organisation are they in, what plan do they have, have they paid, and what have we already done about their request". It holds metadata only: no room names and no room content.

The card opens in two ways: in the console, on the **Customers** tab, and through a server command when no browser is at hand.

## Find a customer

**In the console.** **Customers** tab → the search field. Search by email address, organisation name or invoice number; a query shorter than two characters searches nothing. Matches appear on the left, the selected card on the right.

**On the server:**

```sh
pnpm customer:show --email person@example.com
pnpm customer:show --org studio
```

`--org` accepts an organisation id or its short name from the address. Pass one of them, not both.

## What the card shows

| Section | Fields |
|---|---|
| Account | id, address, state, creation date, whether the address is confirmed |
| Organisations | name, short name, kind, id, creation date, whether suspended |
| Membership | relation and member state, roles in the organisation |
| Subscription | plan, status, amount and billing interval, period end, trial, cancellation at period end |
| Billing details | invoice address, name, currency, whether this is test mode |
| Counts | members, guests, rooms |
| Administrators | the organisation administrators' addresses |
| Credit | balance per currency |
| Invoices | number, status, total, date, paid date |
| Payments | date, status, amount, invoice number |
| Accepted documents | zone, document, version, event, who accepted and when |
| Operator measures | kind, date, open or reverted, public and internal reason |

The billing address and the administrators tell you where a refund or a measure letter will go.

## Why there are no room names

An operator sees the number of rooms, not their names or content. That is how the role protects customers and you: less access means less responsibility for other people's data.

If a case needs the room itself, the complainant sends it: a link, a screenshot or an excerpt. An operator cannot open a room, and should not. A room name may appear only in the measures list, which names the room a measure applies to; that is part of the explanation, not a look at the content.

## The Chatwoot conversation

When support runs through Chatwoot, the card has a **Conversation in Chatwoot** link. It leads to the support address, not to a specific conversation: find the person by the same email address.

With another support mode there is no link. The conversation then runs by mail or on an external page configured by the installation administrator.

## Check

- Searching by address finds an account, by short name an organisation, by number an invoice.
- The card shows member and room counts but no room names.
- Invoice and payment amounts match what the customer sees in the billing section.
- A suspended organisation carries a suspension marker.
- `customer:show --email` prints the same blocks in the same order on a repeat run: the card is for reading, not parsing.

## If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| `no account with the address` | the address is unknown in this installation | check the spelling and domain; a customer of the other installation is not here |
| `no organisation <id>` | a wrong id or short name | find the organisation by an administrator's address |
| `choose one of --email or --org` | both flags were passed | keep one |
| Invoices and payments are empty | the organisation has not paid yet, or pays in the other installation | check the subscription and currency on the card |
| There is no Chatwoot link | support does not run in Chatwoot mode | ask the installation administrator which channel is on |
| Too many matches | the query is too short | add the email domain or the invoice number |

## Where next

[Journal](/guide/operator/journal) — how to check what an operator did for this customer.
