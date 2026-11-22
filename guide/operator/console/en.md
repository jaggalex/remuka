## What this is

`/operator` is one page for the installation's operators. It has five tabs: **Pulse** with metrics, **Customers** with the support card, **Money**, **Complaints** and **Journal**. Room content is never opened here.

Only operators see the page. Every other account — signed in or not — gets the same answer as for a path that does not exist: 404. The console does not advertise itself.

Money and measures run here and in the CLI through the same commands. The operator role, the second factor and a reason are required in both places; only the input and the output differ.

## Signing in

1. Open `https://<installation address>/operator`. There is no link from the product menu: keep the address in your bookmarks.
2. Sign in as usual: address and password.
3. If the account has a second factor, enter the code from the app. Without a second factor the console sends you to enrol one.
4. The console opens when a code was entered within the last 12 hours. Reading within that window does not ask for a code again.

## Actions and confirmation

Every changing action asks for a code again and stays open for 15 minutes. Reading and changing are separate windows: you can watch Pulse all day, while a refund will demand a fresh code. If the code was entered more than 15 minutes ago, the code window appears over the form and the action runs after the code — the form is not lost.

Every action:

1. States the consequences in words: "Refund 1 990 ₽ to Romashka. The Pro subscription ends now. The client receives a letter."
2. Requires a reason of at least 10 characters. The confirm button becomes active only after it.
3. Is sent with a form id (`requestId`). A double click, a repeat after a timeout and a page reload with a repeated submission are one action: the server returns the first answer.
4. Returns the result, after which the console re-reads the card. Nothing is drawn optimistically: the screen shows only what the database recorded.

An action unavailable by state is an inactive button with a hint, not an error after submission: the payment is not paid, everything is already refunded, the invoice is closed.

If a refund form has been open for a while and the refunded sum changed, the server answers `409 REFUND_STATE_CHANGED` with the new number. The form shows it and asks you to confirm again.

## Tabs

| Tab | The question it answers | Details |
|---|---|---|
| **Pulse** | how the installation is doing: collaboration, money, activation, retention, health | [Pulse](/guide/operator/pulse) |
| **Customers** | who this person or organisation is, which plan, invoices, payments, measures; money and plan actions | [Customers](/guide/operator/customers) |
| **Money** | connections without secrets, dead events, refunds, credit and manual payments | [Money](/guide/operator/money) |
| **Complaints** | open measures, a new measure by link or organisation, lifting one | [Measures](/guide/operator/measures) |
| **Journal** | which operator did what, when, why and through which channel | [Journal](/guide/operator/journal) |

The tab is kept in the address: `?tab=money` opens Money directly. That makes a bookmark to one section easy.

## The channel in the journal

Every journal row has two fields a product action does not have: the **channel** (`console` or `cli`) and the **second factor** (`totp` or `recovery`). They show whether a person acted in the browser or on the server and what proved the person. A row without a channel is a product action: a webhook, the scheduler, a letter.

A measure's reason reaches both the administrators' letter and the participants' notice. Keep internal details and names in the reason only when you are ready to show them to the client; for money the reason stays in the journal and the refund letter.

## Indexing and headers

- The page is absent from the product menu and from the documentation search. The interface never links to it.
- `/operator` and `/operator/` are served with `X-Robots-Tag: noindex, nofollow`: search engines must not add the page to their index. That is a request to robots, not protection.
- The same addresses are served with `Cache-Control: no-cache`: after a release the tab receives the fresh build instead of an old one from cache.
- Access is decided by the service, not by headers. Every request to `/api/operator/...` checks the role again and answers 404 to everyone else, including signed-in accounts without the role.
- There are no routes for granting the operator role, resetting the second factor or deleting an account immediately: those actions remain CLI-only.

## Check

- Under an account without the role, `/operator` shows "Page not found" rather than a sign-in form or an explanation.
- `curl -sI https://<installation address>/operator` returns `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-cache`.
- After 12 hours without a code, Pulse asks for one; after the code it opens again.
- Twenty minutes after a code a refund asks for a code again, while reading does not.
- A double click on "Refund" and a repeated submission after a reload produce one refund.
- The journal row about a refund carries `console` and `totp` (or `recovery`).
- `/api/operator/operators`, `/api/operator/mfa/reset` and `/api/operator/account/delete` answer 404 even to an operator.

## If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| "Page not found" under your account | the role was revoked or the second factor is not enrolled | check `pnpm operator:list` and [enrol the second factor](/guide/operator/totp) |
| "Could not read the data" | the session expired or the service is unreachable | sign in again and retry; if it persists, check the service |
| The code is rejected | the phone's or the server's clock is off | turn on automatic time and try again; a [recovery code](/guide/operator/totp) works too |
| The console asks to enrol a second factor | the role is held but the factor is not | enrol it; without the factor the console does not open |
| "The refunded sum changed" | the payment was refunded in another tab or from the server | check the new "refunded" number and confirm again |
| "This form was already sent with a different action" | the form's `requestId` matched another route | close the form and open it again |
| A tab shows old data after a release | the browser keeps the old build | reload the page: `no-cache` stops stale cache, but an open tab lives its own life |
| You are on somebody else's computer | the session stays in the browser | end it under account menu → **Active sessions** and close the browser |

## Where next

[Pulse](/guide/operator/pulse) — what the tiles show and why some read "—".
