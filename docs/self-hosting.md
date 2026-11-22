# Self-hosting Ремука (Remuka)

Ремука (Remuka) is a Node 22 application, a static web client and PostgreSQL 16. You can run
it on a small VPS with Docker Compose. The repository ships the production pieces; this page
explains how they fit and which values you must supply.

The product name changed; the code name did not. **The `REMO_*` variables are not renamed**
and neither are the role names, the headers, the metrics or the paths under `/srv/remo`
(ADR-254, `spec/rebrand.md` §2). An existing installation updates without editing its
environment.

## What you need

- A Linux host with Docker and Docker Compose.
- A domain for the app and, optionally, a second domain for the documentation portal.
- PostgreSQL 16, either in Compose or on a managed host.
- TLS termination. The examples use Caddy; nginx works too.

## Configuration

Copy `deploy/production.env.example` to a private file (mode 600) and replace every
`REPLACE_WITH_…` value:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | service connection as `remo_app`; DML only, no ownership, no `BYPASSRLS` |
| `REMO_MIGRATION_DATABASE_URL` | owner connection for schema work, `db:check`, `db:orphans` and the `db:rls:*` tools |
| `REMO_APP_DB_PASSWORD` | password for `remo_app`; `db:rls:setup` makes the role able to log in |
| `REMO_DB_PASSWORD` | the owner password, for the database tools container |
| `REMO_KEK`, `REMO_KEK_ID` | encrypts provider keys and webhook secrets; back it up |
| `REMO_METRICS_TOKEN` | protects `/metrics` |
| `REMO_APP_ORIGIN`, `REMO_CORS_ORIGIN` | public origin of the app; mutations from any other origin are refused |
| `REMO_PRODUCT_NAME` | optional: the installation's own name in the interface, mail and exports instead of Ремука/Remuka. A fork shows its own brand with this one line (`TRADEMARKS.md`) |
| `REMO_APP_ORIGIN_ALIASES` | optional, comma-separated origins that must keep answering while the installation moves to a new address; they are accepted by the socket Origin check, CORS and invitation links, and their responses carry `Deprecation: true` |
| `REMO_APP_ORIGIN_MOVED` | optional: the new address a browser is sent to. Set together with the new canonical address; a socket on an old origin closes with `4001 moved` and the client reloads this origin with the same path and query |
| `REMO_APP_MOVE_TO`, `REMO_APP_MOVE_AT` | optional pair for the move notice: the new https origin and the day (`YYYY-MM-DD`). Both set shows a banner on the home and in every room for the last seven days, because a cookie does not follow the host and everyone signs in again after the move. Set both or neither; a lone or malformed value logs one warning and shows nothing |
| `REMO_COMPLIANCE_ZONE` | optional: `eu`, `ru` or `none` (the default). `eu` asks for consent before anything optional, `ru` shows a short cookie notice, `none` shows nothing; a typo stops the service (ADR-255) |
| `REMO_COOKIE_POLICY_URL` | optional: absolute `https` page of your cookie policy, linked from the notice. It is read only together with a zone; a value without one, or a malformed address, logs one warning and leaves the link empty |
| `REMO_PERSONAL_DATA_CONSENT_URL` | optional: absolute `https` address of the separate personal-data processing consent document. It is published as `compliance.personalDataConsentUrl` only in the `ru` zone, which is the only one that shows it; the notice and the cookie settings link it exactly when it is set. Unset, malformed, or set in another zone: no link and one warning at start |
| `REMO_LEGAL_STORE_IP` | optional `0` or `1`: keep an HMAC-SHA-256 digest of the client address in `legal_acceptances`. Default `0` in the `eu` zone and `1` in `ru`; the address itself is never stored, and without `REMO_KEK` the field stays `null` (ADR-256) |
| `REMO_LEGAL_IP_RETENTION_DAYS` | optional: days before the retention pass clears `ip_hash` from the acceptance journal. Default `1095` in `ru`, `0` in `eu`; `0` means do not keep the digest at all |
| `REMO_LEGAL_ROOT` | optional: directory that holds `content/legal/` when the service does not start from the repository root (the container image ships it beside `server.mjs`) |
| `REMO_TRUST_PROXY` | set to `1` behind the shipped proxy, so rate limits key on `X-Forwarded-For` |
| `REMO_LOGIN_LIMIT`, `REMO_LOGIN_IP_LIMIT`, `REMO_REGISTER_LIMIT` | optional rate-limit overrides (defaults: 10 per email+IP, 100 per IP, 20 registrations per IP; the first two per 15 minutes, registration per hour) |
| `REMO_EDGE_NETWORK`, `REMO_DB_NETWORK` | Docker networks shared with the proxy and the database |
| `REMO_DB_HOST` | host used by the `db-tools` container |
| `REMO_DOCS_ORIGIN`, `REMO_METRICS` | optional docs origin and metrics switch |
| `REMO_HASH_CONCURRENCY` | parallel password hashes (default 4) |
| `REMO_WS_RATE_BYTES`, `REMO_WS_BURST_BYTES` | optional write budget per socket (defaults: 256 KiB/s, 16 MiB burst; ADR-173) |
| `REMO_ORG_WS_RATE_BYTES`, `REMO_ORG_WS_BURST_BYTES` | optional write budget shared by an organisation's sockets (defaults: 2 MiB/s, 64 MiB burst) |
| `REMO_ROOM_MAX_BYTES`, `REMO_ROOM_FULL_FRAME_BYTES` | optional room size ceiling and the largest edit a full room still takes (defaults: 64 MiB, 16 KiB) |
| `REMO_ROOM_MAX_OBJECTS` | optional object ceiling for one room (default: 20 000; ADR-176) |
| `REMO_MAIL_DRIVER` | `disabled` (the default), `console` (development only), `smtp` or `resend`; the driver sends password reset, address confirmation and invitation letters |
| `REMO_MAIL_FROM`, `REMO_MAIL_REPLY_TO`, `REMO_MAIL_PRODUCT_NAME` | sender identity; the address must sit on a domain you send from. `REMO_MAIL_PRODUCT_NAME` is a deprecated synonym of `REMO_PRODUCT_NAME`: it is read when the new variable is absent and logs a warning once at start |
| `REMO_RESEND_API_KEY` | send-only key for the `resend` driver |
| `REMO_SMTP_URL` | `smtps://…` or `smtp://…:587`, where STARTTLS is required |
| `REMO_MAIL_BATCH`, `REMO_MAIL_CONSOLE_FILE` | optional drain batch size and the file the console driver appends to (end-to-end tests read it) |
| `REMO_BILLING` | `off` (the default) means no plan limits and no billing routes; `on` enforces the catalogue (ADR-247) |
| `REMO_YOOKASSA_WEBHOOK_IPS` | comma-separated source addresses for YooKassa webhooks; an empty list refuses every webhook (ADR-248) |
| `REMO_BILLING_CURRENCIES` | currencies the installation sells, first one is the default (for example `RUB` or `USD,EUR`); a currency without a complete price list is not offered |
| `REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES` | set to `0` to let an unverified address invite people; `1` by default |
| `REMO_FILES_DRIVER` | `disk` (the default) or `s3`; uploads are read only through the app, never from the bucket (ADR-249) |
| `REMO_FILES_DIR` | directory for the `disk` driver; defaults to `${REMO_DATA_DIR}/files` |
| `REMO_S3_ENDPOINT`, `REMO_S3_REGION`, `REMO_S3_BUCKET` | S3-compatible storage; the bucket must be private. Region defaults to `us-east-1`, which MinIO accepts |
| `REMO_S3_ACCESS_KEY_ID`, `REMO_S3_SECRET_ACCESS_KEY` | keys limited to that one bucket |
| `REMO_S3_FORCE_PATH_STYLE` | set to `1` for MinIO; virtual-hosted addressing is the default |
| `REMO_FILES_MAX_BYTES`, `REMO_FILES_MAX_PIXELS` | per-file size and source pixel limits (defaults: 20 MiB, 50 million) |
| `REMO_FILES_PER_ROOM`, `REMO_FILES_CONCURRENCY`, `REMO_FILES_QUEUE` | optional room image ceiling, parallel `sharp` jobs and waiting-room size (defaults: 500, 2, 16) |

`REMO_COMPLIANCE_ZONE=none` is the safe default: as the operator of your own installation
you decide which rules apply to it. Set `eu` where consent must come before anything
optional, and `ru` where a short notice is enough. If you are the data operator of a Russian
installation, set `REMO_PERSONAL_DATA_CONSENT_URL` to your own consent document: without it the
interface shows no personal-data consent link, and the text does not promise a document that
does not exist.

Mail needs PostgreSQL for the outbox, `REMO_KEK` to seal links and an `https` `REMO_APP_ORIGIN` in production. With disk storage the driver is always `disabled`.

`REMO_KEK` is not stored in PostgreSQL. Losing it makes saved provider keys unreadable.
Keep a copy outside the server.

With one URL the service runs as the owner and row-level security cannot contain a missing
predicate. Keep the two roles separate; only `remo_app` serves requests.

## Address, domain and the move

`REMO_APP_ORIGIN` is the one canonical address: mail, invitations, password resets and
exports are written with it. `REMO_CORS_ORIGIN` names the browser origin allowed to make
mutations. Both are yours, not the cloud's: a self-host installation keeps its own hostname.

If the installation changes its public address, the change is three steps, not one, because
bookmarks, invitations, integration tokens and MCP clients still name the old host.

1. **Allow the old origins.** Put them in `REMO_APP_ORIGIN_ALIASES`, comma-separated, and
   restart the service. The socket Origin check, CORS and invitation links accept them; a
   response to a caller on an old origin carries `Deprecation: true` and
   `Link: <new>; rel="successor-version"`. Nothing in the browser moves yet.
2. **Switch the canonical address.** Set `REMO_APP_ORIGIN`, `REMO_CORS_ORIGIN`,
   `REMO_DOCS_ORIGIN` and `REMO_SUPPORT_ORIGIN` to the new host and set
   `REMO_APP_ORIGIN_MOVED` to the same new origin. New mail and new links now use it.
3. **Answer on the old host.** `deploy/nginx-remo.conf` keeps the old host in three
   locations: pages answer `301` with the same path and query, `/api/`, `/mcp` and
   `/sync/` are proxied with the deprecation headers, and a socket that reaches the
   retired origin is closed with `4001 moved` so the client reloads on the new address.

### Move order

The steps are ordered because each one is safe only after the previous one. The nginx
file follows this order; do not enable the old-host map earlier.

1. **Deploy 0.8.0 or newer.** That build reads `REMO_APP_ORIGIN_ALIASES`,
   `REMO_APP_ORIGIN_MOVED` and `REMO_APP_MOVE_*`; an older one ignores them and keeps
   refusing the old origin at the socket check.
2. **Allow the old origins.** Put them in `REMO_APP_ORIGIN_ALIASES` and restart. A
   request with an old `Origin` must now answer and carry `Deprecation: true`.
3. **Switch the canonical address.** Point `REMO_APP_ORIGIN`, `REMO_CORS_ORIGIN`,
   `REMO_DOCS_ORIGIN`, `REMO_SUPPORT_ORIGIN` and `REMO_APP_ORIGIN_MOVED` at the new
   host. New mail and new links name it from now on.
4. **Enable the old-host map** in the proxy: pages `301`, `/api/`, `/mcp` and `/sync/`
   proxied with `Deprecation` and `Link`. Run `nginx -t` before the reload.
5. **Verify on the live hosts.** `node scripts/accept-rebrand.mjs` checks the map end to
   end; it fails on a redirect on the application host, a missing `/api/config`, a
   missing deprecation header, or a Russian application that leads into the EU cloud.

Never use `308` for a decision that can still change, and never redirect `/api/`,
`/mcp` or a socket. A `308` is cached by browsers without an expiry: the address keeps
moving after the configuration is fixed, and only each visitor can clear it. A
redirect to another host drops `Authorization`, which breaks integration tokens and
MCP clients, and an open socket cannot follow one at all. Upgrade `http` to `https`
on the same host and let the proxy answer.

Keep the old certificate and the proxy for at least twelve months. A cookie belongs to the
host that set it, so after the redirect each person signs in once on the new address; an
installed PWA does not migrate by itself and is installed again from the new origin.

Set `REMO_APP_MOVE_TO` and `REMO_APP_MOVE_AT` a week before step 2. `GET /config` then
carries the address and the day, and the browser shows one notice on the home and in every
room during the last seven days: cookies do not travel between hosts, so each person needs
to know that signing in again is expected. `REMO_APP_ORIGIN_MOVED` is still the switch that
moves an open socket; the two pairs answer different questions.

While the Russian region is being prepared, `deploy/ru-stub/` answers `app.remuka.ru` with a
static page and code 200. Include `deploy/ru-stub/nginx.conf` in the host's proxy and copy
the directory with the other deploy files; it has no application, no redirect into the EU
cloud and `noindex` for every crawler.

The `aliases → switch → 301 and 4001` order matters: switching the canonical address first
would write the new host into mail while the service still refuses the old origin's sockets,
and enabling the redirects first would break the open tabs before the new origin is allowed.

## AI gateway

Agents can send every model call through a separate host instead of leaving from the server
that holds the rooms. The gateway keeps one provider registry, kill switches, per-organisation
limits and metadata-only logs; sync reaches it over WireGuard and fails closed when it is
down. It is optional: without `REMO_AI_GATEWAY_URL` the service calls providers directly, as
before, and a self-hosted installation can leave it out.

The two-host setup — tunnel, firewall, Compose or systemd, `remo-gw`, alerts and the separate
`agents.<domain>` address — is in the deployment guide:
[AI gateway](https://docs.remuka.com/guide/en/admin/deploy.html#ai-gateway). The variable
names are in [Settings](https://docs.remuka.com/guide/en/reference/env.html#ai-gateway).

## First start

```sh
docker compose -f deploy/compose.production.yml build
docker compose -f deploy/compose.production.yml up -d
```

The `web` container serves the app and the guide; `sync` serves the API and websockets.
The guide is built from `guide/` by `pnpm guide:build`; the production image does this
during the build.

On a fresh database, apply the schema first (`pnpm db:check` with
`REMO_MIGRATION_DATABASE_URL`), then create the `remo_app` role and apply the policies before
`sync` serves traffic; see [Tenant isolation](#tenant-isolation-rls).

Put the reverse proxy in front of `remo-web:8080` (app) and `remo-web:8081` (guide).
`deploy/Caddyfile.snippet` and `deploy/nginx-remo.conf` are starting points.

## Version and build

`GET /api/health` answers with the product identity as well as the probe bit:

```json
{ "ok": true, "version": "0.2.0", "build": "1247", "commit": "a1b2c3d", "schema": 18 }
```

The account menu and the help footer show the same product version and build; `/metrics`
exposes `remo_build_info{version,build,commit,schema} 1`. The deploy passes `REMO_VERSION`,
`REMO_BUILD` and `REMO_COMMIT` as build args and runtime variables, so an image can always
be traced to a commit. `schema` comes from the service code and is not a release number.

## Rooms without an owner

Every room gets an owner when it is created. A row without one is closed (ADR-174): write
routes answer `403 UNCLAIMED`, the access route reports `allowed: false` with reason
`UNCLAIMED`, the socket refuses the upgrade, and the room is not listed in a catalog or a
trash. Before upgrading an older database, list what is affected and archive
it:

```sh
pnpm db:orphans --list
pnpm db:orphans --archive --yes
```

`--assign <roomId> --user <email>` adopts one room when the owner is actually known. It uses
the person's personal organisation, or their earliest active one, and the earliest team in it;
it creates a team when there is none and writes an audit row. A person with the link can also
claim an archived room from the room screen; claiming clears the archive flag and assigns the
room to their organisation. If the room has a claim token, the token is required.

Rooms painted before the paper palette (ADR-182) keep their saturated fills. To move them to
the paper tones at once, stop the service, back up, list and then apply (ADR-183):

```sh
pnpm db:repaint
pnpm db:repaint --apply --yes
```

## Tenant isolation (RLS)

The production service connects as `remo_app` (ADR-178),
a role with data privileges only: it owns no table and cannot bypass a policy. Every request
that touches tenant data sets `app.org_id` on its own connection and the pool resets it
before reuse; a query without the setting returns zero rows, not every tenant's rows. Schema
work, `db:check`, the room repair and the RLS tools use the owner. The connection settings
make that explicit:

| Variable | Used by |
|---|---|
| `DATABASE_URL` | the sync service as `remo_app`: no table ownership, no `BYPASSRLS` |
| `REMO_MIGRATION_DATABASE_URL` | schema work, `db:check`, `db:orphans`, `db:rls:setup`, `db:rls:enable` (owner) |
| `REMO_APP_DB_PASSWORD` | optional: lets `db:rls:setup` give `remo_app` a login password |

Create the role once per database, then apply the policies:

```sh
REMO_MIGRATION_DATABASE_URL=postgres://owner:... \
REMO_APP_DB_PASSWORD=... \
pnpm db:rls:setup

REMO_MIGRATION_DATABASE_URL=postgres://owner:... pnpm db:rls:enable
REMO_MIGRATION_DATABASE_URL=postgres://owner:... pnpm db:rls --check   # inventory; exits 1 on a gap
REMO_MIGRATION_DATABASE_URL=postgres://owner:... pnpm db:rls:enable --check
```

`db:rls:setup` creates `remo_app` if it is missing, removes `SUPERUSER` and `BYPASSRLS`, and
grants DML on the tables, usage on the sequences and execute on the functions in the public
schema. It never gives ownership. `db:rls:enable` applies `apps/sync/rls.sql`; `--check`
only reports. The owner role must be a superuser or have `BYPASSRLS`: the security-definer
lookups run as that role and return no rows otherwise.

All tenant tables are protected: the room's content and access tables, organisations and
seats, teams, invitations, integration tokens, agents, AI logs and anchors, audit, webhooks
and the event outbox. `pnpm db:rls --check` inventories tenant tables. `pnpm db:rls:enable --check`
verifies RLS and policies on all 48 protected tables in schema 22. The production release
controller applies and verifies the policies before it starts the updated service.

`users`, `sessions`, `agent_tokens`, `ai_credentials`, `auth_tokens`, `mail_outbox` and
`schema_meta` are global identity/secrets and stay outside tenant RLS: they are read before
an organisation exists, and sign-in cannot depend on a tenant policy. They keep their own
token hashing, rate limits and secret encryption.

If `REMO_MIGRATION_DATABASE_URL` is not set, the service uses `DATABASE_URL` for everything.
That single-role mode cannot enforce RLS; do not apply `rls.sql` in it.

## Security headers

The web container sends the security headers itself (ADR-172): a Content-Security-Policy,
HSTS, `X-Frame-Options`, `nosniff`, a referrer policy and a permissions policy. They live in
`deploy/nginx-security-headers.conf` (app) and `deploy/nginx-security-headers-docs.conf`
(guide), and Caddy passes them through. Do not set the same headers in Caddy as well.

With `deploy/nginx-remo.conf` on the host, the configuration includes the same two files
from `/srv/remo/deploy/`; adjust the path if the tree lives elsewhere.

Things to change for your setup:

- If `VITE_SYNC_URL` points the live socket at another origin, add that origin to
  `connect-src` in the app snippet.
- HSTS is sent for this host only. Add `includeSubDomains` or `preload` only when every
  subdomain of your domain serves HTTPS.

Check a running deployment with `curl -sI https://<your-host>/ | grep -i -E 'content-security|strict-transport'`.

## Releases

`deploy/release.sh` verifies the tree, uploads the exact commit and switches the
containers on the host. Create the local release configuration from the repository root.

```sh
mkdir -p .config/remo
cp -n deploy/deploy.env.example .config/remo/deploy.env
chmod 600 .config/remo/deploy.env
# Edit the SSH destination and both HTTPS origins, then commit the release source.
bash deploy/release.sh
```

The local file is ignored by Git and Docker. Keep database credentials and the KEK
in the server's `/srv/remo/shared/production.env`. The script reads the local file as
data: plain `KEY=VALUE` lines, comments allowed, no shell. It must be owned by you,
mode `600`, and not a symlink. To select another private file, set
`REMO_DEPLOY_ENV_FILE` to its path. If the default file is absent, you can supply the
three variables through the environment, for example in CI. A host behind basic auth —
the test stand — also sets `REMO_DEPLOY_HTTP_AUTH=user:password` there; the public checks
after the release then send it.

The script checks SSH access before running the full test suite. On the server it builds
the new images, then checks that the application, migration and backup connections point
to the same database. It stops the app, verifies a PostgreSQL dump, and prepares the
target schema and RLS in one transaction. The new containers start after the transaction
commits. The script prints the public health response and verifies the expected commit,
schema and guide URL. Public checks retry failed requests up to four times, with a
two-second delay and a twenty-second timeout per attempt. If the final check fails
after `Active release`, inspect `/api/health` for the expected commit and schema and
open the app and guide URLs. Revisions, images and verified dumps stay on the server
for recovery.

### Two independent installations

Keep one private configuration per installation, for example
`.config/remo/com.env.local` and `.config/remo/ru.env.local`. Each contains the same
three keys as `deploy/deploy.env.example`, with its own SSH destination, app origin
and documentation origin. A second instance on one machine also names its
`REMO_DEPLOY_ROOT`, `REMO_COMPOSE_PROJECT` and `REMO_WEB_ALIAS` there. Use mode `600`;
the `.local` suffix excludes these files from Git and Docker's build context.

Select the destination explicitly when releasing:

```sh
REMO_DEPLOY_ENV_FILE=.config/remo/com.env.local bash deploy/release.sh
REMO_DEPLOY_ENV_FILE=.config/remo/ru.env.local bash deploy/release.sh
```

These are separate commands: run the one for the installation you intend to update.
Without `REMO_DEPLOY_ENV_FILE`, the script continues to use
`.config/remo/deploy.env`. The local configuration selects a destination and checks
its public endpoints; it does not rewrite the server's `production.env` or proxy.
Each VPS keeps its own database, state volume, secrets, backups and release history.
Changing an installation's domain also requires updating its server origins and TLS
proxy as described in [Address, domain and the move](#address-domain-and-the-move).

The complete map — both installations' addresses, DNS, which nginx template belongs on
which server, the release order and the rollback procedure — is
[operations/cloud.md](operations/cloud.md). 0.8.0 is schema 38 (an installation coming from
0.4.1 goes 20 → 38) and adds a start-up check for the legal registry; its order,
environment table and post-release checks are in
[the Releases section](operations/cloud.md#releases).

Several installations on one machine are supported only through Docker Compose: each has
its own `REMO_DEPLOY_ROOT`, compose project and edge alias (ADR-261). `deploy/remo-sync.service`
— systemd without Docker, reading `/srv/remo/.env` — is the legacy single-host path and
does not take those parameters.

The test stand for interface acceptance, with both zones on one machine and basic auth, is
[operations/stage.md](operations/stage.md).

## Backups and upgrades

- Back up PostgreSQL before a schema change; `scripts/db-backup.mjs` writes a
  custom-format dump and a manifest with its size, SHA-256 and row counts. Validate the
  dump with `pg_restore --list` separately if your runbook requires it.
- `pnpm db:restore` restores into an empty database; it is a deliberate operator
  action, not part of a release.
- The schema version is in `apps/sync/schema-version.mjs` (38 in 0.8.0). A newer build may
  require a newer schema; a rollback to older code must be checked against it.
- `REMO_LEGAL_ALLOW_DRAFTS=1` is a test-stand permission, not a production shortcut. Remove
  it from a production environment: with `REMO_COMPLIANCE_ZONE=eu` or `ru`, the service
  refuses to start while a required legal document is a draft, and the flag without
  `REMO_STAGE=1` stops the start by itself.
- `REMO_BACKUP_KEEP_DAYS` (optional) deletes dumps older than that many days after a good
  backup. Production leaves it unset and keeps every dump until an operator removes it.
- Keep `REMO_KEK` and `production.env` off the server as well.

## Security checklist

- PostgreSQL is not reachable from the internet; bind it to loopback or a private network.
- `NODE_ENV=production` so the session cookie is `Secure`.
- TLS is terminated before the app; the app and sync are not published directly.
- `/metrics` is protected by `REMO_METRICS_TOKEN` or closed by the proxy.
- Outbound provider and webhook requests are HTTPS-only and refuse private addresses by
  default; `REMO_WEBHOOK_ALLOW_PRIVATE=1` is an explicit exception.
- Back up `REMO_KEK` separately from the database.

## Development

See the root `README.md`. The development stack uses `.env.example` and the Compose file
in the repository root; it is not the production configuration.
