## What this is

Three money operations: mark an invoice paid, refund money and grant credit. Each requires a reason and an author, each asks for a second-factor code, and each leaves a journal row. The same actions exist in the console: the customer card → "Refund", "Mark paid", "Add credit", "Grant a plan".

Amounts are always in the currency's minor units: `150000` is 1500.00 ₽ or 1500.00 $, depending on the organisation's currency. The command takes no fractions and no decimal point.

Before you take a card payment, connect the payment service: that is a separate installation step — [Connecting a payment service](/guide/operator/payments).

## Mark an invoice paid

```sh
pnpm billing:mark-paid <invoice-id> --reason "bank transfer received" --ref "bank reference" --as ops@example.com
```

The command records the payment, applies the credit promised on the invoice and, when the invoice sells a subscription, gives the organisation the plan until the end of the period. A repeat on a paid invoice says "already paid" and changes nothing; it does not ask for a code. No letter goes to the customer: the payment appears in their billing section.

`--ref` is the bank's reference for the transfer; it becomes the payment's provider id. Without it the payment gets an internal id.

## Refund money

```sh
pnpm billing:refund <payment-id> --expect-refunded 0 --amount 150000 --reason "duplicate payment" --as ops@example.com
pnpm billing:refund <payment-id> --expect-refunded 150000 --reason "cancellation" --as ops@example.com
```

- **`--expect-refunded` is required**: it is the sum you believe has already gone back on this payment. Read it from the customer card or `pnpm customer:show`: if the payment line says "refunded 0.00 RUB", pass `--expect-refunded 0`.
- The command compares your expectation with the fact inside the transaction that locks the payment. If the sums differ it refuses **before the provider is called** and exits with code **3**: `already refunded 1 990 RUB, expected 0 RUB; check customer:show before repeating`. Code 1 stays for provider failures, so a script can tell them apart.
- Only a paid payment can be refunded. The refund cannot exceed what is left: the command refuses an amount above the remaining sum.
- Without `--amount`, the whole remaining sum is returned.
- A full refund of the current period ends the subscription at once.
- The payment provider confirms first, then the ledger gets its row. If the provider refuses, no money moves and no row is written.
- The customer receives a refund letter with the reason. If mail is off or the organisation has no billing address, the refund does not run: money does not leave without an explanation.
- If another operator refunded part of the payment between the check and the write, the command does **not** refuse: the provider already returned the money. The refund is recorded, the output carries a `refund.concurrent` warning, and the journal gets a row naming both operators.

How quickly the money appears depends on the bank; do not promise the customer a particular day.

## Refund in the console

The customer card shows "refunded" next to every payment and a **Refund** button. The button is inactive with a hint when the payment is not paid or everything is already refunded: that is a state, not an error after submission.

1. Press "Refund". The form states the consequences: the sum, the organisation, the subscription ending on a full refund, and the letter the client will receive.
2. Enter a reason of at least 10 characters. The amount is optional: an empty field refunds the whole remainder.
3. Confirm. The form is sent with a `requestId`: a double click and a repeated submission after a reload produce one refund.

If the payment was partially refunded while the form was open, the server answers `409 REFUND_STATE_CHANGED` and shows the new "refunded" number. Check the sum and confirm again — that is a new refund against the changed remainder.

A console refund's journal row carries the channel `console` and the second factor; a server command carries `cli`. The console's idempotency key is the form id, not the expected sum, so resubmitting the same form never calls the provider twice.

## Grant credit

```sh
pnpm billing:credit --org <organisation-id> --amount 50000 --reason "compensation for an outage" --as ops@example.com
```

Credit is a "goodwill" entry in the billing ledger. It moves no money and touches no payment; the next invoice is reduced by the remaining credit automatically. You may pass the currency explicitly (`--currency RUB`); otherwise the organisation's currency is used, then the installation's.

No credit letter is sent. The customer sees the credit in the billing section and on the next invoice.

## The second-factor code

Money commands act as the operator named by `--as`, and that operator must prove it is them. In a terminal the command asks for the code from the app; in a script pass it with `--code`:

```sh
pnpm billing:refund <payment-id> --expect-refunded 0 --reason "cancellation" --as ops@example.com --code 123456
```

A recovery code works too and is spent. Five wrong codes in a row close this operator's money commands for 15 minutes. Details: [Two-factor sign-in](/guide/operator/totp).

## The required reason and the limits

| What | Rule |
|---|---|
| Reason | `--reason` is required by all three commands; without it the command refuses |
| Author | `--as` or `REMO_OPERATOR`; the author must hold the operator role |
| Second factor | a code from the app: interactively in a terminal, or `--code` in a script |
| Amount | a whole number of minor units, greater than zero |
| Expected refund | `--expect-refunded` is required for a refund; a whole number, zero allowed |
| Refund | a paid payment only, and no more than what remains |
| Repeat | marking a payment is idempotent: on a paid invoice it changes nothing. A refund is protected by `--expect-refunded`: a repeat with the old expectation exits with code 3 without calling the provider |
| Mail | a refund requires configured mail and a recipient address |

## The letter and the journal trace

| Command | Journal row | Letter to the customer |
|---|---|---|
| `billing:mark-paid` | `billing.invoice_marked_paid` | no |
| `billing:refund` | `billing.refunded`; on a race also `refund.concurrent` | yes, with the reason |
| `billing:credit` | `billing.credit_granted` | no |

The journal row names the payment, invoice or organisation, the amount and the currency, the channel (`cli`) and the second factor. It shows who refunded the money and why.

## Check

- After a refund the customer card shows the refunded sum and the payment status becomes partially refunded or refunded.
- The journal has `billing.refunded` with the payment id, the amount, the `cli` channel and your reason.
- The customer received the refund letter; with mail off, the command refused before any money moved.
- A repeat with the same `--expect-refunded` exits with code 3, calls no provider and creates no refund.
- After `billing:mark-paid` the invoice on the customer card is paid and the subscription runs to the end of the period.
- After `billing:credit` the credit balance on the card grows while payments stay unchanged.

## If something goes wrong

| Message | Cause | What to do |
|---|---|---|
| `the payment id must be a uuid` | an invoice number was passed instead of a payment id | the payment id is on the customer card |
| `--expect-refunded is required` | the flag was forgotten | read "refunded" on the card and pass that number |
| `already refunded … expected …` (code 3) | the payment was already refunded; your expectation is stale | compare with `customer:show`; if a refund is still needed, run again with the new expectation |
| `only a paid payment can be refunded` | the payment did not succeed or is already refunded | check the payment state |
| `already fully refunded` | there is nothing left to return | compare with the card |
| `is more than the ... still refundable` | the amount exceeds the remainder | lower the amount or omit `--amount` |
| `mail is not configured` / `mail is disabled` | there is no way to send the refund letter | turn mail on; a refund without its letter does not run |
| `has no billing address` | the organisation has no billing address | ask an administrator to fill in the billing details |
| `its connection no longer exists` | the payment went through a deleted connection | the provider cannot refund it; handle it by hand |
| `provider ... refused the refund` | the provider declined | read the provider's answer; nothing was recorded |
| `is already paid` | the invoice is already paid | that is expected; the repeat changes nothing |
| `--code` / "that code did not work" | no code or a wrong one | enter the code from the app or a recovery code; after five failures wait 15 minutes |

## Where next

[Plans and the price list](/guide/operator/plans) — what a plan allows, how to set a price and how to grant a plan by hand.

[Journal](/guide/operator/journal) — how to find the row about a refund, credit or payment.
