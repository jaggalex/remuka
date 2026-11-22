## What this is

The **Journal** is the history of operator actions: granting and revoking the role, refunds and credit, manual payments, measures against abuse, account deletion and second-factor events. It answers "who did what, when and why" when a dispute concerns money, access or a complaint.

The journal is read-only. The console cannot clear it, change a row or delete one.

## Filters

| Field | What it accepts |
|---|---|
| Action | the start of an action name, for example `billing.` or `abuse.` |
| Operator | an operator account id |
| Organisation | an organisation id |
| From | the start of the period |
| To | the end of the period |

The same set is available through a server request; in the console the **Show** button applies it. With no filters the console asks for the latest 200 rows, a request defaults to 100, and the maximum is 500.

Date boundaries in the console start at midnight UTC. To include the whole last day, put the following day in **To**: otherwise rows after midnight UTC fall outside the selection.

## What a row contains

| Column | Value |
|---|---|
| When | date and time in the browser's time zone |
| Who | the operator's address; "server" when a command ran without a person |
| What | the action name, for example `billing.refunded` |
| Where | the organisation, when the action belongs to one |
| Reason | the text the operator passed in `--reason`; without one, the subject of the action |

## Which actions appear

| Group | Actions |
|---|---|
| Role | `operator.granted`, `operator.revoked` |
| Second factor | `mfa.enabled`, `mfa.step_up`, `mfa.recovery_used`, `mfa.recovery_regenerated`, `mfa.reset`, `mfa.locked`, `mfa.disabled` |
| Money | `billing.refunded`, `billing.credit_granted`, `billing.invoice_marked_paid`, `billing.plan_granted`, `billing.plan_ended` |
| Abuse | `abuse.link_disabled`, `abuse.board_hidden`, `abuse.org_suspended`, `abuse.reverted` |
| Account | `account.delete_operator`, `account.purged` |

The list is not closed: other product actions that have an organisation or a subject appear too. Filtering by the start of the action name narrows the selection.

## What counts as evidence of an action

Evidence is a journal row with a time, an author, an action, a subject and a reason. Commands are built so that such a row appears for every change to rights, money, a measure or an account, and so that a command without an author refuses. A refund, a credit and a measure require a reason; a plan grant records its own reason.

- If there is no row, the action did not go through a command. That does not prove it never happened: emergency work in the database bypasses the journal, so its reason belongs in the ticket.
- The row names the subject: a payment id, a measure id, an account id. It shows what exactly changed.
- A measure has a public reason and an internal one. The journal keeps the internal one; the customer sees the public one in the letter and on the notice.
- An organisation administrator sees their organisation's journal in the app. The installation-wide journal is for operators only.

## Check

- Grant a test role and find the `operator.granted` row with your reason and your address.
- Filter by the action `billing.` — only money rows remain.
- Filter by an organisation id — only that organisation's rows remain.
- A row without a person says "server", not an empty cell.
- A repeated command that changed nothing adds no second change row.

## If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| "No records" | the filter is too narrow or the period is empty | clear the filters and widen the dates |
| Yesterday's rows are missing | the **To** boundary is midnight UTC | put the following day |
| The operator or organisation filter fails | the id must be a full uuid | copy the id from the customer card |
| More rows than fit | the console caps at 500 | narrow the period or the action |
| An action has no reason | the command was not run as an operator, or the row is old | check the subject and the time; new actions require a reason |

## Where next

[Measures against abuse](/guide/operator/measures) — what exactly is written to the journal when access is restricted.
