## What this is

A payment service is connected once per installation, not per organisation: the YooKassa shop belongs to the installation, and organisations do not bring their own merchant account. The shop keys are sealed with the installation's `REMO_KEK`; the commands show only a short fingerprint, and the secret cannot be recovered from it.

A test shop and a live shop are two separate connections with different keys. A test connection cannot be turned into a live one: create a second connection for real payments. A test connection serves only organisations whose payment test mode is on, and it never appears in the public plan catalogue.

The result of this page: a connection with the status `active`, a notification address in the YooKassa cabinet, a complete price list for the currency, and a check that a payment reaches the installation.

## Where to run the commands

The commands on this page run on the server from the installation directory, not in a development tree: the host needs no `pnpm`. `remo cli` takes the script from the current release image, reads the environment from `shared/production.env` and mounts `shared/` into the container read-only as `/shared`:

```sh
cd /srv/remo
./remo cli billing-providers list
```

A stand uses another directory: `/srv/stage-ru` or `/srv/stage-eu`.

## What you need first

| What | Why |
|---|---|
| A YooKassa test shop: `shopId` and secret key | the connection's keys; a live connection needs live keys |
| `REMO_KEK` — 32 bytes in base64 | seals the keys; `list` works without it, but `create` with a secret, `verify` and `secret` do not |
| `REMO_BILLING=on` | with `off`, the self-host default, the catalogue and payment answer 404 |
| `REMO_BILLING_CURRENCIES` with the currency, for example `RUB` | the catalogue offers only the currencies listed there |
| `REMO_YOOKASSA_WEBHOOK_IPS` — sender addresses or CIDR blocks from YooKassa's published list | an empty list rejects every notification |
| `REMO_TRUST_PROXY=1` when the service runs behind nginx | otherwise the sender looks like the proxy, and notifications are rejected |
| `REMO_APP_ORIGIN` — the installation's HTTPS address | the notification address is built from it, and `/api/` is public through it |
| A complete price list for the currency: month and year for Pro, Team and Business on sale | a currency without a complete list is not shown to a buyer |
| The installation operator role | creating a connection and setting prices take an author in `--as` |

## Create the secret file

Create the file in the installation's `shared/` directory: the container sees it as `/shared/...`, while on the host it lives outside the repository and the image. The command needs it once, and it is deleted after the connection or a rotation. Inside is one JSON object with the two fields from the YooKassa cabinet.

```sh
cd /srv/remo
umask 077
cat > shared/yookassa-test.json <<'JSON'
{ "shopId": "123456", "secretKey": "test_..." }
JSON
chmod 600 shared/yookassa-test.json
```

`shopId` is the shop number and `secretKey` is the secret key from the integration section. The command accepts no flag for the key itself: only a file or a hidden answer in the terminal, so the secret never reaches the shell history or the process list.

## Create the connection

```sh
./remo cli billing-providers create --provider yookassa --mode test --currency RUB \
  --groups ru_card --name "YooKassa test" \
  --secret-file /shared/yookassa-test.json --as ops@example.com
```

Mind the path: on the host the file is `shared/yookassa-test.json`, but the command gets `/shared/yookassa-test.json`, the path inside the container.

The command prints `[billing:providers] created <id> (draft)` and then a line with the id, `yookassa/test`, the status, priority, currency, method group and the secret's fingerprint. The secret itself is never printed. Right after validating the configuration the command calls the shop: on success it prints `yookassa: the shop is reachable`, on failure it prints the reason, the connection stays `draft` and the exit code is 1. Wrong keys are therefore visible before the first payment, not after it.

`--groups ru_card` covers Russian bank cards, SBP and the wallets enabled in the shop. `--name` is visible to operators only. `--priority` is optional: the lower number wins when two connections serve the same currency and method group.

## Verify the connection

```sh
./remo cli billing-providers verify <id>
```

The command opens the sealed secret, probes the shop and records the answer as the last health result; it does not change the lifecycle status. Success prints `[billing:providers] <id> ok: yookassa: the shop is reachable`; a failure prints the reason and exits 1. Repeat it after every change of keys, network or shop settings.

## Activate the connection

```sh
./remo cli billing-providers activate <id> --reason "the test shop is ready" --as ops@example.com
```

The command prints `[billing:providers] <id> is active`. While the connection is `draft`, notifications get `404`, so activate it before the first payment.

Later, `pause` stops new purchases while renewals and refunds continue; `resume` puts the connection back to work.

## Take the notification address

```sh
./remo cli billing-providers webhook-url <id>
```

The command prints `https://<installation address>/api/billing/webhooks/<id>/<token>`. The `/api/` prefix is required: without it the request lands on the application page, which answers 200 and does nothing.

1. In the YooKassa cabinet, open HTTP notifications and paste the address.
2. Select `payment.succeeded` and `payment.canceled` only.
3. Do not enable refund notifications: the installation accepts payment events only, answers `401` to everything else, and the service keeps repeating the delivery.

YooKassa does not sign notifications. The installation trusts two facts: the sender address is in `REMO_YOOKASSA_WEBHOOK_IPS`, and a fresh payment request through the API with the shop's own keys confirms the status. The status in the notification body is not used, so a forged body without the keys changes nothing. A notification that says "pending" is acknowledged but moves no payment.

## Publish the price list

```sh
./remo cli billing-prices seed --currency RUB --pro 29000 --team 59000 --business 119000 \
  --as ops@example.com
```

The command creates drafts for a month and a year of every paid plan. A year defaults to twelve monthly amounts; a different annual price is set with `--year-<plan>`. Amounts are whole minor units: `29000` is 290.00 ₽.

Publish every draft separately, by the id from the output:

```sh
./remo cli billing-prices publish pro-rub-month-v1 --as ops@example.com
```

Then check that the list is complete:

```sh
./remo cli billing-prices check
```

The command prints `RUB: complete` or `RUB: incomplete, missing …` and exits with code 1 on a gap. A currency without a complete list is not shown to a buyer.

A single price is added with `billing-prices add`, which creates a new draft version, for example `./remo cli billing-prices add --plan pro --interval month --currency RUB --amount 34900 --as ops@example.com`. A published amount is never edited: a new price is a new version, and live subscriptions keep theirs.

## Check

- `./remo cli billing-providers list` shows the row as `active`, `yookassa/test`, the currency `RUB`, the group `ru_card` and the secret's fingerprint; the key itself appears neither in the output nor in a journal. The command works without `REMO_KEK`: the key is needed only to open a secret.
- `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<installation address>/api/billing/webhooks/<id>/wrong` answers `404`: the address reaches the service through the proxy. Any wrong token gets the same answer, so this proves the route, not the token.
- `curl -s https://<installation address>/api/billing/catalog` lists the currency with prices and payment methods when a live connection is `active` and the price list is complete. A test connection never appears in that answer.
- A test payment for the minimum amount: the payer reaches the YooKassa page, pays and comes back, and the console's **Money** → **Connections** tab shows a time in the **Last event** column. The payment is visible on the customer card.
- The organisation owner sees the plan, status, amount, renewal date, credit, invoices and the saved payment method — brand, last four digits and expiry — on the "Plan & payment" tab. With nothing to sell, the panel says the operator has not published a complete price list and a payment route yet.

A payment counts as received when the invoice on the customer card becomes paid. After a verified `payment.succeeded` the service applies the payment forward only, closes the invoice, opens the subscription period, writes a `billing_events` row and queues the `payment_succeeded` letter — usually within a couple of seconds. A repeated delivery of the same notification and a cancellation that arrives after a success change nothing.

If no notification arrives, every hour the service asks the provider about payments still pending for more than 15 minutes and applies the answer with the same code. A payment whose webhook stayed silent is therefore usually settled within the hour.

## When an event is dead

An event that could not be applied eight times in a row gets `dead_at` and appears in the console on the **Money** tab → **Dead events** with the last error code. It is not retried by itself.

1. Read the code. `PAYMENT_NOT_FOUND` means the event names a payment that is not in the database (another connection or a removed row); `AMOUNT_MISMATCH` / `CURRENCY_MISMATCH` mean the provider's sum or currency did not match the invoice; `INVOICE_NOT_FOUND` means the invoice is gone.
2. Check the payment in the provider's cabinet. If the money did arrive, confirm the invoice by hand with `billing-mark-paid` (it needs a reason, a second-factor code and `--as`). Such a payment is marked manual and is not linked to a YooKassa refund.
3. If the money did not arrive, do not confirm anything: the invoice stays open and the payer can pay it again. Fix the cause before the next payment — for example, check the notification address and the `REMO_YOOKASSA_WEBHOOK_IPS` list.

## Test stand

- With `REMO_STAGE=1`, `create --mode live` refuses before touching the database: `live payment connections are refused on a test stand: create a --mode test connection`.
- The `fake` provider is available only outside production and only with `REMO_PAY_FAKE=1`; otherwise the command answers `the fake provider is for development only`. A production process with that flag does not start.
- A test payment needs a YooKassa test shop and a `--mode test` connection: a test connection never reaches the public catalogue, so paid plans stay unavailable in the panel with the reason. That is expected, not a defect.
- Never use real money or live keys on a stand.

## If something goes wrong

| Symptom | Cause | What to do |
|---|---|---|
| `[billing:providers] health check failed: YOOKASSA_401` | the shop rejected the keys, or they belong to another shop | check `shopId` and `secretKey` in the cabinet, run `secret`, then `verify` |
| `[billing:providers] health check failed: YOOKASSA_NETWORK` | the installation could not reach `api.yookassa.ru` | check outbound HTTPS and repeat `verify`; the connection status does not change |
| `REMO_KEK is required (32 bytes, base64)` | the installation key is missing or has the wrong length | set `REMO_KEK` in the service environment; `list` works without it, but a secret can be neither opened nor sealed |
| `--secret-file must contain one JSON object` | the file does not hold a single JSON object | keep only `shopId` and `secretKey` in the file |
| `--secret-file: cannot read …` | the file is missing or unreadable inside the container | check that it is in the installation's `shared/` and that the command names `/shared/...`, with 600 permissions |
| `secret needs a terminal` | the command ran without a terminal and without a file | pass `--secret-file /shared/...`: a pipeline cannot type a secret |
| a notification gets `404` | a wrong id or token, or the connection is `draft` | take the address again with `webhook-url` and activate the connection |
| a notification gets `401`, the service log says `not verified` | the address list is empty, the sender is in none of the listed addresses or blocks, or `REMO_TRUST_PROXY=1` is missing behind a proxy | list the addresses and blocks from YooKassa's published list (for example `185.71.76.0/27`) and trust the proxy |
| `webhook-url` prints `localhost` | `REMO_APP_ORIGIN` is not set | set the installation's HTTPS address and take the address again |
| the catalogue is empty, the panel mentions an incomplete price list | no complete price list, no live active connection, or the currency is missing from `REMO_BILLING_CURRENCIES` | `./remo cli billing-prices check` and `./remo cli billing-providers list`; selling needs a live connection |
| after paying, the invoice still waits for payment | the notification did not arrive, failed, or is dead | check "Last event" and the **Dead events** table on the **Money** tab; a payment older than 15 minutes is re-queried by the service within the hour. If the money arrived and the event is dead, confirm the invoice with `./remo cli billing-mark-paid`; such a payment is not tied to the connection, and YooKassa cannot refund it |
| `a connection cannot go from … to …` | the command does not fit the current status | read the status in `list` and choose an allowed step |
| `refusing to disable … live subscription(s)` | subscriptions still renew through the connection | `retire` first, wait for payers to move to another connection, then `disable` |

## Security and switching off

- The secret travels as a file or a hidden answer in the terminal only. The command accepts no flag for a key, so the secret stays out of the shell history, the process list and the output.
- The file lives in the installation's `shared/`, outside the repository and the image, with 600 permissions; delete it right after the connection is created or rotated.
- Only the fingerprint is shown. Neither the journal nor the console carries the secret.
- Losing `REMO_KEK` makes the stored keys unreadable: keep it off the server and keep a backup.
- The keys of an existing connection are changed with `secret`: the new secret is sealed, an audit row records its fingerprint, and then the shop is probed. If the probe fails, the connection already carries the new secret, so keep the old file until `verify` succeeds. A saved card cannot move between connections: the payer enters it once more.

```sh
./remo cli billing-providers secret <id> --secret-file /shared/yookassa-new.json \
  --reason "scheduled rotation" --as ops@example.com
```

On `manual` the command refuses: a manual connection has no secret.

| Command | What stops | What continues |
|---|---|---|
| `pause` | new purchases | renewals on saved cards, refunds, notifications |
| `resume` | — | everything as before the pause |
| `retire` | new purchases through this connection | renewals on saved cards, refunds |
| `disable` | new purchases and renewals | refunds and notifications; the row stays forever |

`disable` refuses while at least one subscription renews through the connection, and lists those subscriptions. A connection cannot be deleted: one with payment history stays in the status `disabled`.

## Where next

[Money](/guide/operator/money) — mark an invoice paid, refund money and grant credit once the connection works.

[Plans and the price list](/guide/operator/plans) — what a plan allows, how the price list works and why the showcase stays empty until prices and a payment route are ready.

[The customer card](/guide/operator/customers) — where a payment, an invoice and the saved payment method are shown.

[The operator console](/guide/operator/console) — the **Money** tab: connections, dead events, refunds.
