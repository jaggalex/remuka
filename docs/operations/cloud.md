# Cloud operations: two installations, addresses and releases

The cloud is two independent installations, one in the European Union and one in Russia
(ADR-254 §5.1, `spec/rebrand.md` §5.1). They share code and nothing else: no proxy, no
redirect and no database between them. The only link is a human one — pages link to pages.

This page is the operator's map. It contains no secrets: server addresses are public (they
are in DNS), passwords and keys stay in `/srv/remo/shared/production.env`.

| | EU installation | Russian installation |
|---|---|---|
| Server | `192.0.2.10` | `192.0.2.20` (temporary; moving the server keeps the addresses) |
| Application | `app.remuka.com` | `app.remuka.ru` |
| Site (apex) | `remuka.com` | `remuka.ru` |
| Guide | `docs.remuka.com` | `docs.remuka.ru` |
| Release configuration | `.config/remo/com.env.local` | `.config/remo/ru.env.local` |
| `REMO_COMPLIANCE_ZONE` | `eu` | `ru` |
| Default language | English | Russian |
| Currency (ADR-247) | USD, EUR | RUB |
| Mail | Resend, `mail.remuka.com` | provider not chosen yet (§5.3) |

The Russian installation does not accept registrations until its mail provider is decided:
without mail there is no address confirmation and no password reset.

## Address map

A code is the answer to `GET /` and to any path unless the table says otherwise.

| Address | Installation | Answer | What sits behind it |
|---|---|---|---|
| `remuka.com` | EU | `302` → `https://app.remuka.com$request_uri` | Temporary until the landing page exists; the path is kept |
| `www.remuka.com` | EU | `301` → `https://remuka.com$request_uri` | |
| `app.remuka.com` | EU | `200` | Application, `/api`, `/sync`, `/mcp`, `/help` |
| `docs.remuka.com` | EU | `/` → `302 /guide/`; `/guide/*` → `200` | Guide, `llms.txt`, `llms-full.txt` |
| `remuka.ru` | RU | `302` → `https://app.remuka.ru$request_uri` | Temporary until the landing page exists |
| `www.remuka.ru` | RU | `301` → `https://remuka.ru$request_uri` | |
| `app.remuka.ru` | RU | `200` | The Russian installation's own application and database |
| `docs.remuka.ru` | RU | as `docs.remuka.com` | Canonical pages name `docs.remuka.com` |
| `api.remuka.com`, `api.remuka.ru` | — | no DNS records | Reserved |
| `status.*`, `support.*` | — | no records yet | Reserved for their own specifications |
| `remuka.com/legal/*`, `app.remuka.com/legal/*` | EU | `200` | Legal documents of the EU zone, built into `legal-site/eu/` |
| `remuka.ru/legal/*`, `app.remuka.ru/legal/*` | RU | `200` | Legal documents of the Russian zone, built into `legal-site/ru/` |

`/legal/*` is served on the apex and on the application host of the same installation, from
`legal-site/<zone>/`; the nginx mapping is in `deploy/nginx-site.conf` (apex) and
`deploy/nginx-remo.conf` (application). One installation never serves the other zone's
documents. Run `pnpm legal:build` and place the zone directory at
`/srv/remo/legal-site/<zone>/` before reloading nginx; each server keeps only its own.

The old public host of the application, and the old documentation host, are the migration
map in the last section of `deploy/nginx-remo.conf`. That section is used on the EU server
only, answers pages with `301`, proxies `/api`, `/mcp` and `/sync`, and is kept for at least
twelve months. The new templates below never name an old host.

Why the apex answers `302` and not `301`: the application lives on the apex today, so room
links of the form `remuka.com/r/…` are already in the wild. A permanent redirect is
remembered by a browser and can only be undone one person at a time, so the temporary one
carries `$request_uri` until a landing page actually replaces the application there.

## DNS and TLS

| Name | Type | Value |
|---|---|---|
| `remuka.com`, `www`, `app`, `docs` | A | `192.0.2.10` |
| `remuka.ru`, `www`, `app`, `docs` | A | `192.0.2.20` |
| Old application and documentation hosts | A | `192.0.2.10` (EU server, unchanged) |
| `api.remuka.com`, `api.remuka.ru` | — | delete: a reserved address without a certificate looks broken |
| `remuka.com`, `remuka.ru` | CAA | `0 issue "letsencrypt.org"` |
| `mail.remuka.com` | TXT, CNAME, MX | per the mail provider: SPF, DKIM, return-path |
| `_dmarc.mail.remuka.com` | TXT | `v=DMARC1; p=quarantine; rua=mailto:dmarc@remuka.com` |

- `AAAA` records only when the server has IPv6 and nginx listens on `[::]:443`; otherwise
  half the clients would reach an address that does not answer.
- Set the TTL to 300 a day before any A-record change, and back afterwards.
- Certificates come from Let's Encrypt through certbot, one name each or one SAN per
  installation. EU: `remuka.com`, `www.remuka.com`, `app.remuka.com`, `docs.remuka.com`,
  plus the old hosts. RU: `remuka.ru`, `www.remuka.ru`, `app.remuka.ru`, `docs.remuka.ru`.
- `certbot renew --dry-run` must pass on both servers and the renewal timer must be enabled.
- HSTS is `max-age=31536000` for the host that sends it. Do not add `includeSubDomains` or
  `preload` while any subdomain lacks a certificate: a browser would refuse it for a year.

## nginx: which template goes where

Templates live in `deploy/` and contain no secrets. The server name in each file is an
example; substitute the installation's own names (the variables are named at the top of
each file). Take a snapshot before editing: `sudo tar czf ~/nginx-before-$(date +%F).tgz
/etc/nginx`, and remove every `return 308` that is already there.

EU server:

1. `app.remuka.com` — `deploy/nginx-remo.conf` (`server_name app.remuka.com;`).
2. `remuka.com` and `www.remuka.com` — `deploy/nginx-site.conf`, `SITE_HOST=remuka.com`,
   `APP_HOST=app.remuka.com`.
3. `docs.remuka.com` — `deploy/nginx-docs.conf`, `DOCS_HOST=docs.remuka.com`.
4. The old hosts — the last section of `deploy/nginx-remo.conf`.

Russian server:

1. `app.remuka.ru` — `deploy/nginx-remo.conf`.
2. `remuka.ru` and `www.remuka.ru` — `deploy/nginx-site.conf`, `SITE_HOST=remuka.ru`,
   `APP_HOST=app.remuka.ru`.
3. `docs.remuka.ru` — `deploy/nginx-docs.conf`, `DOCS_HOST=docs.remuka.ru`.

There is no old-host section on the Russian server. On each server: `sudo nginx -t && sudo
systemctl reload nginx`.

The security snippets are included from `/srv/remo/deploy/`; with a different tree, adjust
the `include` paths in all three templates.

A browser that visited `app.remuka.com` or `app.remuka.ru` while those hosts answered `308`
has that redirect cached. After the change the apex answers `302` back, so such a person
sees a loop until they clear site data for the domain. The addresses appeared only days
before this procedure, so few people are affected.

## Environment of each installation

`/srv/remo/shared/production.env` keeps the database, the KEK and the metrics settings as
they are. These keys differ:

| Key | EU | RU |
|---|---|---|
| `REMO_APP_ORIGIN` | `https://app.remuka.com` | `https://app.remuka.ru` |
| `REMO_CORS_ORIGIN` | same as `REMO_APP_ORIGIN` | same as `REMO_APP_ORIGIN` |
| `REMO_DOCS_ORIGIN` | `https://docs.remuka.com` | `https://docs.remuka.ru` |
| `REMO_APP_ORIGIN_ALIASES` | `https://remuka.com`, plus the old host — the aliases line in `deploy/production.env.example` shows both | — |
| `REMO_APP_ORIGIN_MOVED` | unset | — |
| `REMO_COMPLIANCE_ZONE` | `eu` | `ru` |
| `REMO_LEGAL_STORE_IP` | unset (`0`, no address digest) | unset (`1`, keyed digest kept) |
| `REMO_LEGAL_IP_RETENTION_DAYS` | unset (`0`, nothing to retain) | unset (`1095`, three years) |
| `REMO_MAIL_DRIVER` / `REMO_MAIL_FROM` | `resend` / `Remuka <no-reply@mail.remuka.com>` | per §5.3 |
| `REMO_BILLING`, `REMO_BILLING_CURRENCIES` | per `spec/billing.md`, `USD,EUR` | per `spec/billing.md`, `RUB` |
| `REMO_PULSE_TOKEN` | same value on both installations | same value on both installations |
| `REMO_PULSE_PEERS` | `https://app.remuka.ru` | unset — the Russian installation never initiates |
| `REMO_PRODUCT_NAME` | unset | unset |

`REMO_DOCS_ORIGIN` is read by the sync service (`apps/sync/docs-origin.mjs`) and published
in `GET /api/config` as `docs.origin`; the interface and the in-app help build every guide
link from that answer (ADR-284). Unset, the zone picks the guide — `eu` the `.com`, `ru` the
`.ru`; an installation with no zone gets no guide link at all. A malformed address stops
the service instead of silently removing the links.

While the EU application still answers on the apex, `REMO_APP_ORIGIN_ALIASES` also holds
`https://remuka.com`: open tabs and bookmarks there must work until the move. The canonical
address in mail and new links is always `REMO_APP_ORIGIN`.

The KEK of the two installations must differ (`spec/cloud-zones.md` §6.4).

## The first operator on a new installation

The operator role is per installation and is granted only from that server's shell
(ADR-259, `spec/operator.md` §2). There is no API route that creates it, so a fresh
installation has no operator until this step:

1. Register in the application as a normal account and confirm the address from the letter.
2. On the server, run the operator script from the release image (the bridge is described
   under "Operator commands on the server" below):

   ```sh
   /srv/remo/remo cli operator-role grant --email <address> --as <address> --reason "bootstrap"
   /srv/remo/remo cli operator-role list
   ```

`--as` names the author of the act (ADR-259 amendment). The first operator names the account
being granted, because no operator exists yet; every later command must name an existing
operator or set `REMO_OPERATOR`.

The address must already be confirmed; an unconfirmed account is refused. Repeat on the
other installation with its own address: the two databases share no roles. Every later
change (`operator:grant`, `operator:revoke`) takes a reason and writes an audit row, and the
last operator cannot be revoked.

The console at `/operator` is never indexed and never reachable without an operator
session: the response carries `X-Robots-Tag: noindex, nofollow`, `robots.txt` disallows the
path, and every `/api/operator/*` request without the role answers `404` (ADR-259 §5,
ADR-260).

## Operator commands on the server

The server has no `pnpm` and no checkout. The scripts live in the release image at
`/app/scripts`, and `remo cli` runs one of them in a throw-away container of the current
release, with the installation's own `production.env` and a read-only mount of `shared/`.
The controller takes the instance from its own directory — `/srv/stage-ru/remo` always
means the stage, never whatever `REMO_ROOT` happens to be in the shell. A controller
installed outside an instance directory can still set `REMO_ROOT` explicitly; do not use
that as a habit, because running one instance's controller against another opens the wrong
database.

```sh
# The payment connections, their health and their keys.
/srv/remo/remo cli billing-providers list
/srv/remo/remo cli billing-providers verify <connection-id>
/srv/remo/remo cli billing-providers secret <connection-id> \
  --secret-file /shared/yookassa-test.json --reason "quarterly rotation" --as ops@example.com

# Any other script in scripts/, for example a test letter or the database check.
/srv/remo/remo cli mail-test --to you@example.com
/srv/remo/remo cli db-check
```

A file written on the host as `/srv/<instance>/shared/yookassa-test.json` is read inside
the container as `/shared/yookassa-test.json`: a key never goes into the image or into the
release directory. The terminal stays attached, so a command that prompts for a secret can
be answered; a script receives everything after its name as arguments. `pnpm billing:providers`
in a development tree is the same script as `remo cli billing-providers`; `pnpm operator:grant`
is `remo cli operator-role grant`, because one script serves the whole `operator:` group.
On a stand the controller is `/srv/stage-ru/remo` or `/srv/stage-eu/remo` instead.

A payment notification is recorded by the webhook and applied by the `billing-inbox` drain
in the same process: every 2 s, a batch of 10, eight attempts with the shared backoff, then
`dead_at` and a row on the console's **Money** tab. A dead event is not retried by itself
and the invoice stays open; if the money arrived, confirm the invoice with
`billing-mark-paid`, and if it did not, fix the connection before the next payment. A
payment in `pending` for more than 15 minutes is re-queried at the provider once an hour,
so a lost notification does not by itself leave a paid invoice open.

## Resetting an operator's second factor

A lost authenticator is reset only from the server (ADR-260, `spec/totp.md` §7). There is
no reset by mail: a stolen mailbox must not bypass the factor it protects.

```sh
pnpm mfa:reset --email <address> --reason "lost the phone" --as <operator>
```

The command removes the TOTP secret, every recovery code and every pending sign-in
challenge, ends all sessions of that account and writes the `mfa.reset` audit row. The
person signs in with the password again and enrols a new authenticator. `--as` names an
operator who already holds the role; `REMO_OPERATOR` is the fallback, as for the other
operator commands. The account receives the `mfa_reset` letter; a mail outage is reported
and never keeps the factor in place.

Money and abuse commands ask the acting operator for a code (ADR-262): interactively in a
terminal, or with `--code` in a script. `operator:grant/revoke` and `mfa:reset` deliberately
do not. A refund also takes `--expect-refunded` — the sum the operator believes is already
returned, read from `customer:show`; a mismatch exits with code 3 before the provider is
called (see the operator money guide, `guide/operator/money`). Only a test stand (`REMO_STAGE=1`)
may set `REMO_OPERATOR_CLI_MFA=0`, and only for stand scripts.

## Pulse: aggregates and the zone exchange

The Pulse writes to its own database (`REMO_METRICS_DATABASE_URL`), never to the product
one (ADR-082, ADR-258, `spec/pulse.md` §4). The nightly writer runs at **03:10 UTC** and
recomputes the last three closed days; a longer outage is closed by the catch-up after
`listen`, one logged day at a time. The aggregates live 730 days and the raw events 400
days (ADR-263).

```sh
# Re-run a closed range after a fix (the same code and lock as the night).
pnpm pulse:recompute --from 2026-11-01 --to 2026-11-22

# The collector's state: origin, zone, last success, last day, rows, last error.
pnpm pulse:peer:list
```

Only the **EU** installation collects (`REMO_PULSE_PEERS=https://app.remuka.ru`). It asks
the Russian one for `GET /api/operator/pulse/export` with
`Authorization: Bearer $REMO_PULSE_TOKEN`; the answer is signed with HMAC-SHA256 over the
exact bytes, and the collector verifies it before parsing. Both installations must carry the
same token; without a token the export route does not exist. The Russian installation never
makes an outbound call and shows its own zone with the reason in the Pulse filter.

**Revoking the exchange takes both halves** (`spec/pulse.md` §5.4):

1. On the receiving (EU) side, remove the origin from `REMO_PULSE_PEERS` and restart sync.
2. On the sending (RU) side, replace `REMO_PULSE_TOKEN` with a new random value and restart.
   The old token stops working on the next request.
3. On the EU side, delete the collected aggregates and write the journal row:

   ```sh
   pnpm pulse:peer:revoke --origin https://app.remuka.ru --reason "zones split" --as ops@example.com
   ```

   This removes every `provenance = 'peer'` row of that zone and its `pulse_peers` row, and
   writes `pulse.peer_revoked` with the reason and the author. Check it with
   `pnpm pulse:peer:list` (no rows) and `select count(*) from metrics_daily where zone = 'ru'
   and provenance = 'peer'` (zero) in the metrics database.

Removing the origin from the env without the command leaves the rows and the panel keeps
drawing them; the command without the env change is undone by the next collection.

## Releases

Each installation has its own private release file with three keys — `REMO_DEPLOY_HOST`,
`REMO_APP_ORIGIN`, `REMO_DOCS_ORIGIN` — mode `600`, outside Git
(`deploy/deploy.env.example`). The origins carry the application host of the zone:
`https://app.remuka.com` for the EU installation and `https://app.remuka.ru` for the
Russian one, with `https://docs.remuka.com` / `https://docs.remuka.ru` beside them. One
installation, one command:

```sh
REMO_DEPLOY_ENV_FILE=.config/remo/com.env.local bash deploy/release.sh
REMO_DEPLOY_ENV_FILE=.config/remo/ru.env.local bash deploy/release.sh
```

`deploy/release.sh` checks the tree, runs `pnpm verify --e2e`, uploads the exact commit and
then, on the server, dumps the database, prepares the schema in one transaction and starts
the containers. It finishes by checking `/api/health` for the expected commit and schema
and fetching the app and the guide. The expected schema is read from
`apps/sync/schema-version.mjs` — **38** in 0.8.0.

### 0.8.0: what changes in the environment

The release keeps working without any new key while the new features stay off. The table
gives the values of the two cloud installations and, in the last column, what an absent key
means. The defaults are the behaviour of an installation that sets nothing new.

| Key | EU | RU | Absent or default |
|---|---|---|---|
| `REMO_MAIL_DRIVER` | `resend` | `smtp` once the provider is chosen (§5.3) | `disabled` in production; `console` only outside production and only with a KEK, and it is refused in production |
| `REMO_MAIL_FROM` | `Remuka <no-reply@mail.remuka.com>` | the provider's address | `smtp` and `resend` stop the start with `REMO_MAIL_FROM must be a valid address`; `disabled` ignores it |
| `REMO_SMTP_URL` | — | `smtp://<key id>:<secret>@postbox.cloud.yandex.net:587` | required for `smtp`; `smtps://…` uses 465 (implicit TLS), `smtp://…` uses 587 (STARTTLS), an explicit port must be one of the two, and query/fragment are refused. Any other port fails `REMO_SMTP_URL must use port 465 (implicit TLS) or 587 (STARTTLS)` |
| `REMO_RESEND_API_KEY` | set (send-only key) | — | `resend` stops the start with `REMO_RESEND_API_KEY is required for the resend driver` |
| `REMO_MAIL_REPLY_TO` | optional | optional | replies go to the address in `REMO_MAIL_FROM` |
| `REMO_BILLING` | `on` when selling | `on` when selling | `off`: unlimited entitlements and no billing routes — the 0.4.1 behaviour. The first `off` → `on` downgrades Free organisations above the free roles (`spec/billing.md` §2) |
| `REMO_BILLING_CURRENCIES` | `USD,EUR` | `RUB` | `RUB`; the first currency is the default, and only a currency with a complete price list is offered |
| `REMO_YOOKASSA_WEBHOOK_IPS` | the published YooKassa list | the published YooKassa list | empty means every YooKassa notification is refused; set it before creating a YooKassa connection |
| `REMO_COMPLIANCE_ZONE` | `eu` | `ru` | `none`: no cookie notice and no legal documents. A typo stops the start with `REMO_COMPLIANCE_ZONE must be one of eu, ru, none; got "…"` |
| `REMO_LEGAL_ROOT` | unset | unset | the service looks for `content/legal/index.json` in the working directory and two levels above it; the image carries it at `/app/content/legal`. With a zone set and no registry the start stops: `[legal] content/legal/index.json not found while REMO_COMPLIANCE_ZONE=eu; set REMO_LEGAL_ROOT to the checkout or ship content/legal with the service` |
| `REMO_LEGAL_STORE_IP` | unset (`0`) | unset (`1`) | the zone default: no address digest in `eu`, a keyed digest in `ru`. A value other than `0` or `1` stops the start with `[legal] REMO_LEGAL_STORE_IP must be 0 or 1` |
| `REMO_LEGAL_IP_RETENTION_DAYS` | unset (`0`) | unset (`1095`) | the zone default: nothing to keep in `eu`, three years in `ru`; `0` means do not store. A non-integer stops the start with `[legal] REMO_LEGAL_IP_RETENTION_DAYS must be a whole number of days` |
| `REMO_LEGAL_ALLOW_DRAFTS` | **remove** | **remove** | must be absent on production. `1` without `REMO_STAGE=1` stops the start with `[legal] REMO_LEGAL_ALLOW_DRAFTS=1 is allowed only together with REMO_STAGE=1 (a test stand): publish the required documents on production (ADR-261, spec/stage.md §5)` |
| `REMO_APP_ORIGIN` | `https://app.remuka.com` | `https://app.remuka.ru` | no production default: links fall back to `http://localhost:5173`. With mail on it must be `https` without a trailing slash, or the start stops with `REMO_APP_ORIGIN must use https in production: links go out in mail` |
| `REMO_KEK`, `REMO_KEK_ID` | required | required | without a KEK provider keys and webhooks stay locked (`WEBHOOK_LOCKED`, `AI_CREDENTIALS_LOCKED`) and mail refuses to start with `REMO_KEK is required when mail is enabled`. Generate 32 random bytes in base64; the two installations must not share it |
| `REMO_METRICS` | unset or `on` | unset or `on` | `off` disables product metrics and the Pulse even when the metrics database is set; unset with no `REMO_METRICS_DATABASE_URL` starts nothing |
| `REMO_METRICS_DATABASE_URL` | set | set | no metrics database means no Pulse and no product events |
| `REMO_METRICS_TOKEN` | set | set | the service answers `404` on `/metrics` in production without it |
| `REMO_PULSE_TOKEN` | same value on both | same value on both | without it `GET /api/operator/pulse/export` does not exist |
| `REMO_PULSE_PEERS` | `https://app.remuka.ru` | unset | only the EU installation collects. A malformed value stops the start; setting it outside `eu` logs one warning and collects nothing |
| `REMO_PULSE_BREAKEVEN` | optional | optional | `43` paid teams in the operator panel |
| `REMO_OPERATOR_CLI_MFA` | unset | unset | production ignores it; `0` is honoured only together with `REMO_STAGE=1` |

Billing providers are not environment keys: an operator creates a connection with the
operator command (`billing:providers` on the server as `remo cli billing-providers`),
checks it with `verify`, and its keys are sealed with `REMO_KEK`. YooKassa is the first
adapter (`spec/payment-providers.md`); `REMO_YOOKASSA_WEBHOOK_IPS` is the only
provider-specific environment value.

There is no `REMO_LEGAL_ZONE`: the legal registry follows `REMO_COMPLIANCE_ZONE`
(`resolveLegal` in `apps/sync/legal.mjs` calls `resolveCompliance`). `REMO_LEGAL_ROOT` is
the only separate legal key.

`REMO_APP_ORIGIN` is the application host (`https://app.remuka.com` or
`https://app.remuka.ru`), not the apex. It is the origin written into mail, invitations and
legal links, and the canonical origin of the request checks; naming the apex there produces
links to the wrong host, and requests from the application host no longer match the
canonical origin.

Two legal facts must be settled before the first production start:

1. **The stand keys are removed.** `REMO_STAGE`, `REMO_LEGAL_ALLOW_DRAFTS`,
   `REMO_OPERATOR_CLI_MFA`, `REMO_MAIL_ALLOW_RECIPIENTS` and `REMO_STAGE_*` belong to a
   stand. The legal flag is the one whose presence stops a production start by itself.
2. **The required documents are published.** In `content/legal/index.json` the required
   documents are `eu/terms`, `ru/offer` and `ru/consent`; all three are `draft` today. A
   production start with `REMO_COMPLIANCE_ZONE=eu` or `ru` refuses a draft:
   `[legal] required document(s) still drafts: <zone>/<doc>; publish them, or set REMO_STAGE=1 and REMO_LEGAL_ALLOW_DRAFTS=1 on a test stand`.
   Removing the flag is not enough: the texts themselves must be published first.

Everything else in the table has a safe default: a self-host that sets only
`REMO_APP_ORIGIN` keeps mail off, billing off and the `none` compliance zone.

### Order for 0.8.0 (schema 20 → 38)

0. **Publish the legal texts of each zone** (see above). Without this the new `sync`
   container exits at start-up and the release cannot become active, even though the
   migration and the backup succeeded.
1. **Rehearsal.** Restore the latest EU dump on a test machine and release 0.8.0 there with
   a third private file. Expect: the preflight prints `Database preflight: schema 20 to 38`,
   the migration passes, `/api/health` reports `version 0.8.0`, `schema 38` and the released
   commit, old rooms open, and a 0.4.1 backup imports. If the rehearsal has unpublished
   drafts, mark that machine as a stand (`REMO_STAGE=1` plus `REMO_LEGAL_ALLOW_DRAFTS=1`)
   instead of publishing test texts. Record the time from `compose stop web sync` to
   `Active release`: that is the downtime window on production.
2. **Backup both installations and download the dumps.** The daily timer is
   `remo-backup@remo`; a manual dump is `bash /srv/remo/remo backup`, which writes
   `/srv/remo/backups/<UTC>-<revision>-<random>.dump` and proves it readable with
   `pg_restore --file=/dev/null` before keeping it. `scp` the archive and run
   `pg_restore --list` on it locally. A dump that stays on the same server is not a backup.
3. **Release the EU installation** with `com.env.local`.
4. **Check independence of the Russian installation** (below), then release it with
   `ru.env.local` after the mail and legal decisions of its zone.

### Migration and the downtime window

The local script uploads the archive and runs `bash /srv/remo/remo deploy <commit>` on the
server. The order inside that controller, in the order the code runs it:

1. Build the `sync` and `web` images and pull `db-tools`. The build happens while the old
   release still answers, so it is not part of the downtime.
2. Check that the application, migration and backup connections point to one database and
   that the application role is subject to RLS. A mismatch stops before anything is stopped.
3. `compose stop web sync`, then dump with `pg_dump -Fc` and validate the archive with
   `pg_restore --file=/dev/null`. **The dump is taken before the migration** and after the
   writers stop, so it is a consistent pre-migration state.
4. `sync node release-db.mjs`: apply `schema.sql` and the RLS policies **in one
   transaction**. It also refuses a database whose schema is newer than the release. If any
   statement fails, the transaction rolls back and the service stays stopped; the dump and
   the previous release remain on disk.
5. Start `sync`, wait for its health check, start `web`, wait for it, then run the in-container
   smoke check (`/api/health` and the Russian overview page). Only then write `current` and
   print `Active release: <commit>`.

The downtime therefore covers the dump, the schema transaction and the two container starts;
the image build does not. The document deliberately gives no duration: measure it on the
rehearsal from the `compose stop` line to `Active release` and use that number for the
maintenance notice. The release log also prints `Backup: …`, `Database schema 38, RLS
verified on … tables.` and `Active release: …` — if the local script fails after that, the
release is already active and only the public check failed.

### Checks after the release

Run these against each installation after `deploy/release.sh` prints `Published <commit>`.
The release script already checks the build and fetches the app and the guide; the
redirects and the old host are hand checks.

```sh
# 1. The build: version, schema and the commit that was uploaded.
curl -s https://app.remuka.com/api/health
# {"ok":true,"version":"0.8.0","build":"…","commit":"<40 hex>","schema":38,"name":"Remuka"}
test "$(curl -s https://app.remuka.com/api/health | jq -r .commit)" = "$(git rev-parse HEAD)"

# 2. The apex is temporary, www is permanent, neither is 308.
curl -sI https://remuka.com | grep -iE '^(HTTP|location)'
# 302 ; location: https://app.remuka.com/
curl -sI https://www.remuka.com | grep -iE '^(HTTP|location)'
# 301 ; location: https://remuka.com/
curl -sI https://remuka.ru | grep -iE '^(HTTP|location)'
# 302 ; location: https://app.remuka.ru/
curl -sI https://www.remuka.ru | grep -iE '^(HTTP|location)'
# 301 ; location: https://remuka.ru/

# 3. The public configuration carries all three blocks.
curl -s https://app.remuka.com/api/config |
  jq -e 'has("productName") and (.compliance | has("zone")) and (.legal | has("documents"))'
# true ; .compliance.zone is "eu"; .legal.documents has one entry per published document
```

`productName` is `null` unless `REMO_PRODUCT_NAME` is set; that is the normal cloud value.
An empty `legal.documents` means the zone has no published registry, not a broken API.

The old host keeps its three kinds of traffic (`deploy/nginx-remo.conf`, last section):

```sh
# Pages: 301 with the same path and query.
curl -sI 'https://remo.letii.ru/r/probe?x=1' | grep -iE '^(HTTP|location)'
# 301 ; location: https://app.remuka.com/r/probe?x=1

# API: proxied, not redirected, and marked deprecated.
curl -s -D - -o /dev/null https://remo.letii.ru/api/health | grep -iE '^(HTTP|deprecation|link)'
# 200 ; deprecation: true ; link: <https://app.remuka.com/api/health>; rel="successor-version"

# MCP: same rule. Any service answer (200 or 404) is fine; 301/308 is not.
curl -s -D - -o /dev/null https://remo.letii.ru/mcp | grep -iE '^(HTTP|deprecation|link)'

# The socket path is proxied to the same service; /sync/health proves it without a socket.
curl -s -D - -o /dev/null https://remo.letii.ru/sync/health | grep -iE '^(HTTP|deprecation|link)'
# 200 with the same Deprecation and Link headers
```

`node scripts/accept-rebrand.mjs` reads the same addresses and exits non-zero on any
`FAIL`. With `EXPECT_VERSION=0.8.0` and a complete release it has 34 result lines: **31
PASS, 1 WARN, 2 MANUAL, 0 FAIL**. The PASS set is:

- `tls:remuka.com`, `tls:remuka.ru`, `tls:app.remuka.com`, `tls:app.remuka.ru`,
  `tls:docs.remuka.com`, `tls:docs.remuka.ru`, `tls:www.remuka.com`, `tls:www.remuka.ru`,
  `tls:remo.letii.ru`, `tls:docs.remo.letii.ru`;
- `app.title:EU`, `app.title:RU`, `app.version:EU`, `app.version:RU`, `app.config:EU`,
  `app.config:RU`;
- `reserved:api.remuka.com`, `reserved:api.remuka.ru` — only after the DNS records are
  deleted; while they still resolve the script prints `WARN`, not `FAIL`;
- `app.icon`, `app.oldicon`, `app.hsts`;
- `old.page`, `old.api`, `old.mcp`;
- `docs.old`, `docs.title`, `docs.llms`;
- `site:remuka.com`, `www:remuka.com`, `site:remuka.ru`, `www:remuka.ru`.

`WARN` is `app.securitytxt`: the tree ships no `.well-known/security.txt`, so the check
cannot pass and does not fail the run. `MANUAL` is `app.move` (the move banner is off until
`REMO_APP_MOVE_TO`/`REMO_APP_MOVE_AT` are set) and `old.ws` (the `4001 moved` socket needs a
browser, not curl). `app.zone:EU`/`app.zone:RU` appear only when the zone is wrong; with
`REMO_COMPLIANCE_ZONE=none` they turn the run red.

A `308` or a redirect in the wrong direction means:

- `app.remuka.com` or `app.remuka.ru` redirecting to the apex — `app.root:EU`/`app.root:RU`
  `FAIL`; a browser that saw the 308 remembers it after the fix.
- the apex answering `301`/`308` instead of `302` — `site:*` `FAIL`; a permanent redirect
  on the apex is exactly what the temporary `302` avoids.
- `www` going to the application instead of the apex — `www:*` `FAIL`; `www` is the one
  permanent (`301`) redirect and it points at the apex.
- `/api`, `/mcp` or `/sync` redirected instead of proxied — `old.api`/`old.mcp` `FAIL`;
  `Authorization` does not survive a cross-host redirect.
- the old pages or the old guide answering `308` — `old.page`/`docs.old` print `WARN`,
  because the path is right, but the spec asks for `301`; fix it while the old host is still
  under our control.

These checks depend on DNS and certificates, not on the release: `tls:www.*`,
`tls:docs.remuka.ru`, `tls:docs.remo.letii.ru`, `docs.old`, `site:*` and `www:*`.
`reserved:api.*` depends on deleting the DNS records. Without the certificate for a name,
its `tls:*` and `site:*`/`www:*` line fails before any redirect is read.

The remaining operator checks:

```sh
# One real letter through the configured driver: driver, KEK seal, template and outcome.
pnpm mail:test --to you@example.com
# [mail:test] sent <id> via smtp as Remuka <no-reply@mail.remuka.com>
# A failure prints [mail:test] not sent <id>: <reason> and exits 1.

# The database the release wrote: connect, apply the schema (idempotent), write and read.
pnpm db:check
# DB CHECK OK

# The instance names on the host.
docker compose ls
# NAME   STATUS   CONFIG FILES
# remo   running  /srv/remo/releases/<commit>/deploy/compose.production.yml
```

`pnpm mail:test` and `pnpm db:check` need a tree with `pnpm` and dependencies; on the
server the same scripts run through `remo cli mail-test` and `remo cli db-check`, with the
installation's environment (`DATABASE_URL`, `REMO_MIGRATION_DATABASE_URL`, the mail keys).
`docker compose ls` on a stand shows `stage-ru` and `stage-eu` instead of `remo`.

### Rollback

Revisions, images and verified dumps stay on the server. Rollback is two questions, in this
order:

1. **Is the old code compatible with the new schema?** If yes, the previous revision is one
   command on the server: `bash /srv/remo/remo rollback --schema-compatible`. It takes a
   fresh dump, starts the previous release's existing images, smoke-checks them and makes
   that revision current. It never restores data and never rebuilds an old image.
2. **Is it not schema-compatible?** Then the code cannot go back alone: restore the dump
   taken before the release into an empty database with
   `pnpm db:restore <file>.dump --yes` (the tool refuses to overwrite a database with
   rooms unless `--force` says the loss is intended) and roll the release back as above.

The 0.8.0 jump is schema 20 → 38. A 0.4.1 build knows schema 20, and nothing in this tree
tests that build against a schema-38 database. Treat the rollback as case 2 — restore the
dump taken before the migration — unless the rehearsal proved that the old build starts and
reads the new schema. `rollback --schema-compatible` only reuses existing images; it never
restores data.

`bash /srv/remo/remo status` shows the running containers, `logs` the last hundred lines.
The local `com.env.local` or `ru.env.local` decides which server a command reaches; there is
no default that could hit the wrong installation.

## Independence and cleanliness of the Russian installation

Both installations answered one commit for a while, so prove they are separate before the
first release:

1. On the Russian server, `docker ps` and
   `grep -E 'DB_HOST|DATABASE_URL' /srv/remo/shared/production.env`: the database must be
   local (a container or PostgreSQL on that server), never the EU server's address.
2. Count accounts and rooms in both databases (`apps/sync/schema.sql` has the table names).
3. If the Russian database holds accounts copied from the EU one: download a dump, recreate
   an empty database (`pnpm db:rls:setup`, then the migrations through a release) and write
   in the operations journal that the copy was removed.
4. Generate a new `REMO_KEK` for the Russian installation before its first registration if
   the current one was copied. A copied KEK with a copied database would decrypt the EU
   provider keys there.
