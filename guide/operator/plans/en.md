## What this is

A plan decides what an organisation may do: how many seats and rooms it has, how many agent tasks it can run and how long the trash keeps deleted items. A price says what a month or a year of that plan costs in the installation's currency. The two change separately: a plan changes with the product, while the operator sets prices.

This page explains how to keep the price list, why a plan sometimes does not appear to a buyer, and how to grant or end a plan by hand.

## A plan and a price are different things

A plan is a set of permissions. It is the same on every installation: Free, Pro, Team and Business. A price is a separate record for one plan and one period in one currency. A plan has a monthly and a yearly price, and an installation with two currencies keeps independent prices in each: no exchange rate is used.

Amounts are always whole minor units: `29000` is 290.00 ₽ or 290.00 $, depending on the currency. The command takes no fractions and no decimal point.

Free is not for sale and has no price row. A live subscription keeps a snapshot of its price, so a new price never rewrites a period that is already paid for.

## What a plan allows

| Plan | Seats | Rooms | Agent tasks | Trash |
|---|---|---|---|---|
| Free | 5 | 5 | 10 a month | 7 days |
| Pro | 5 | no limit | no limit | 90 days |
| Team | 20 | no limit | no limit | 90 days |
| Business | 50 | no limit | no limit | 90 days |

Every paid plan opens the same set of features; the limits and the price differ. Free is the plan of an organisation without a subscription.

A seat is taken by an active member, and by a guest who holds editor or a higher role in at least one room. Viewers, commenters and visitors through a public link take no seat.

## What happens at a limit

The server checks the limit at the moment of the action and refuses before changing anything. The answer carries `PLAN_LIMIT`, the limit (`rooms`, `seats` or `agentTasksPerMonth`), the current value, the ceiling and the plan. The screen shows "Plan limit: …" with a "See plans" button.

| Action | Limit checked |
|---|---|
| Create a room, restore it from the trash, copy a room | rooms |
| Create an invitation, accept it, promote a guest to editor | seats |
| Start a new agent task | agent tasks per month |

When a downgrade or an unpaid period leaves more rooms than the plan allows, the most recently changed rooms stay active. The rest become read-only: their content is kept, and export and backup still work. The owner chooses which rooms stay active under "Plan & payment".

People over the seat limit are not removed: new invitations and role promotions are refused until seats free up. Seats already granted stay. Agent tasks above the monthly limit are not created; tasks that already exist are not cancelled.

## The price list

An installation sells the currencies in `REMO_BILLING_CURRENCIES`; when the variable is unset, it sells `RUB`. The first currency in the list is used when a command or a buyer names none.

The rule is all or nothing. A currency needs a month and a year for all three paid plans on sale. If one row is missing, the buyer sees none of that currency, not just the missing plan.

Prices are versioned. A new price starts as a draft and is published separately. Publishing a new regular version ends the previous one, while live subscriptions stay on their own price. A published amount is never edited: a correction is a new version. A `promo-only` version never reaches the public catalogue and is available only through a promo code.

`seed` creates drafts for a month and a year of Pro, Team and Business. A year defaults to twelve monthly amounts; a different annual price is set with `--year-pro`, `--year-team` or `--year-business`. Running `seed` again with the same numbers keeps the existing draft instead of piling up versions.

```sh
cd /srv/remo
./remo cli billing-prices list --currency RUB
./remo cli billing-prices seed --currency RUB --pro 29000 --team 59000 --business 119000 \
  --as ops@example.com
./remo cli billing-prices publish pro-rub-month-v1 --as ops@example.com
./remo cli billing-prices check
```

In a development tree the same commands run through `pnpm`:

```sh
pnpm billing:prices list --currency RUB
pnpm billing:prices add --plan pro --interval month --currency RUB --amount 34900 \
  --as ops@example.com
```

`add` creates the next version as a draft; publish it with a separate `publish <id>`. `list` and `check` only read and need no `--as`. `add`, `publish` and `seed` write a row and take their author in `--as`; without it, or without the operator role, the command refuses.

`check` prints `RUB: complete` or `RUB: incomplete, missing pro/month, …` and exits with code 1 while the list has a gap. Without `--currency` it checks every currency in `REMO_BILLING_CURRENCIES`.

## Why a plan is not visible in the interface

A buyer sees a currency only when three things agree:

1. The currency has a complete published price list: a month and a year for Pro, Team and Business.
2. The currency has a payment route: an active live connection to a payment service. On a test stand an active test connection is enough.
3. The currency is listed in `REMO_BILLING_CURRENCIES`.

The public showcase offers live connections only. There is one exception: a test stand with `REMO_STAGE=1`, where the showcase and checkout use test connections because live ones are refused there. A production installation never shows a test connection, even an active one.

When there is nothing to sell, "Change plan" does not draw an empty table. It names the reason: "Paid plans are not available on this installation yet: the operator has not published a complete price list and a payment route. The free plan keeps working in the meantime."

## Grant or end a plan by hand

A manual grant is for acceptance, compensation and payment by a company invoice, when the money arrives outside the card flow. The command writes a subscription for the chosen plan; it creates no invoice and moves no money.

```sh
cd /srv/remo
./remo cli billing-grant --org <organisation-id> --plan team --until 2027-03-01 \
  --as ops@example.com
./remo cli billing-grant --org <organisation-id> --end --as ops@example.com
```

In a development tree use `pnpm billing:grant` with the same flags.

- `--until` is the last day, inclusive, at the end of that day in UTC. The date must be in the future.
- Without `--price` the command takes the plan's monthly price on sale. Name a currency with `--currency`, a particular price with `--price`.
- `--end` or `--plan free` cancels the live subscription and removes every room freeze; no price is read.
- `--as` is required, and the author must hold the operator role. The command asks for a second-factor code; in a script pass it with `--code`. Details: [Two-factor sign-in](/guide/operator/totp).

The journal gets `billing.plan_granted` with the organisation, plan, price, amount, currency, period and end date. With `--end` it gets `billing.plan_ended`. The row names the author, the `cli` channel and the second factor.

New permissions apply on the next access check. If the granted plan cannot hold the organisation's rooms, the extra rooms become read-only at once.

## What the owner sees

Under "Organisation settings" → "Plan & payment":

- the plan and the subscription status: "Trial", "Active", "Payment due" or "Suspended";
- the amount, the renewal or end date, and the credit when it is not zero;
- usage: seats and rooms against their ceiling, or "no limit";
- on a plan with a room ceiling, an "Active rooms" block and a choice of which rooms stay editable;
- the payment method: brand, last four digits and expiry;
- invoices: number, date, total, status and a receipt link when there is one;
- "Change plan" — plan and period, a promo code, a payment method, acceptance of the terms and a payment button;
- "Cancel subscription" — the plan runs to the end of the paid period and does not renew; "Resume subscription" takes the cancellation back before that date.

A member without admin rights sees the plan and limits but not the card, invoices or buttons: the screen asks them to contact the organisation owner. An administrator can buy a plan for a personal or shared organisation.

## Check

- `billing-prices list --currency RUB` shows `for_sale` rows for the month and the year of Pro, Team and Business, with amounts and versions.
- `billing-prices check` prints `RUB: complete` and exits with code 0; a gap prints `incomplete, missing …` and exits with code 1.
- After a manual grant, refresh the customer card to see the plan, amount, end date, status and new limits.
- On a test organisation without a subscription, a sixth room, an invitation beyond five seats or an eleventh agent task in a month is refused with `PLAN_LIMIT` and is not created.
- After a payment the billing address receives a payment letter with the amount, the period and a link to the invoice, when mail is on and the address is filled in.

## If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| `check` exits with code 1 and prints `RUB: incomplete, missing pro/month, …` | no published price for that plan and period | find the draft in `list`, publish it, or create one with `add`; an incomplete list sells nothing |
| The plan was paid for, but the limits are still Free | the subscription has ended or is suspended, or the payment is not confirmed | check the status and the invoice on the customer card; if the money arrived, confirm the payment; wait up to a minute |
| Free limits are shown after payment | the subscription has yet to be applied, or the page shows another organisation | check which organisation the invoice belongs to and verify the subscription status |
| The currency does not appear in the showcase | it is missing from `REMO_BILLING_CURRENCIES`, the price list is incomplete, or there is no live payment route | `billing-prices check` and `billing-providers list`; complete the price list and activate a live connection |
| "Change plan" shows a message instead of a table | no complete price list or payment route for the currency; the connection may be test-only | fix the cause named in the message: price list, connection, currency list |
| `--until must be a date in the form YYYY-MM-DD` | the date has the wrong shape | pass it as `2027-03-01` |
| `--until … must be in the future` | the date has passed | choose a future date, or end the plan with `--end` |
| `--plan free has no period and no price; use --end` | Free was given a date like a paid plan | use `--end` to end the plan |
| `no price for sale for team/month/RUB; seed prices first` | the plan has no published price in that currency | publish the price, or pass `--price` / `--currency` |
| `price … is draft, not for sale` or `is promo-only` | `--price` names an unpublished or promo price | choose a `for_sale` price without `promo-only` |
| A `PLAN_LIMIT` refusal when creating a room, an invitation or a task | the organisation has reached the plan limit | free a seat or change the plan; this is an expected limit, not a failure |
| No payment letter arrived | the billing address is empty or mail is off | check the organisation's billing details and the mail settings; the payment is still recorded |

## Where next

[Money](/guide/operator/money) — mark an invoice paid, refund money and grant credit.

[Connecting a payment service](/guide/operator/payments) — the live connection that makes a currency payable.

[The customer card](/guide/operator/customers) — where to find an organisation, its subscription and its invoices.
