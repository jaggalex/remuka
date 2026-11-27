## Main

| Variable | What it sets | Without it |
|---|---|---|
| `DATABASE_URL` | Postgres with rooms, IAM and the journal; connection as the application role `remo_app` | the service refuses to start if a database is set but unreachable; without the variable disk mode works |
| `REMO_MIGRATION_DATABASE_URL` | Postgres for schema and maintenance: migrations, `db:check`, `db:orphans`, `db:rls`; connection as the owner role | the service uses `DATABASE_URL` for schema too; RLS needs two roles |
| `PORT` | port of the sync service | 1234 |
| `REMO_DATA_DIR` | directory for disk mode | `apps/sync/.data` |

The service connects as `remo_app`: DML only, no table ownership and no `BYPASSRLS`. Schema and maintenance use the owner role through `REMO_MIGRATION_DATABASE_URL`; the owner must be a superuser or have `BYPASSRLS`.

## Example

```bash
# /srv/remo/.env, mode 600, owned by the service user
DATABASE_URL=postgres://remo_app:<app password>@127.0.0.1:5432/remo
REMO_MIGRATION_DATABASE_URL=postgres://remo:<owner password>@127.0.0.1:5432/remo
NODE_ENV=production
PORT=1234
REMO_APP_ORIGIN=https://boards.example.com
REMO_CORS_ORIGIN=https://boards.example.com
REMO_METRICS_TOKEN=<32 random bytes>
REMO_DATA_DIR=/var/lib/remo
REMO_KEK=<openssl rand -base64 32>
REMO_KEK_ID=v1
```

## Security and keys

| Variable | What it sets |
|---|---|
| `REMO_KEK` | wrapping key for secrets: 32 bytes in base64 |
| `REMO_KEK_ID` | key version, `v1` by default |
| `REMO_APP_ORIGIN` | application address for links in emails and invitations |
| `REMO_APP_ORIGIN_ALIASES` | old addresses, comma-separated: the socket origin check, CORS and invitations accept them while the installation moves; the response is marked `Deprecation: true` |
| `REMO_APP_ORIGIN_MOVED` | the new address a browser is sent to: a socket on the old address closes with `4001`, and the tab reloads the same path and query on the new one |
| `REMO_CORS_ORIGIN` | allowed origin for the API; `*` by default |
| `REMO_PRODUCT_NAME` | the installation's own name in the interface, mail and exports instead of Remuka; this is how a fork runs under its own name |

Without `REMO_KEK` a provider key cannot be added and a webhook cannot be set up: the server answers `WEBHOOK_LOCKED` or `AI_CREDENTIALS_LOCKED`. Secrets already stored are not decrypted if the key is lost.

## Links to the guide

| Variable | What it sets | Without it |
|---|---|---|
| `REMO_DOCS_ORIGIN` | address of the public guide behind «Documentation» in the account menu, «Terms» on the payment screen and «About Remuka» in the help: an absolute `https` origin without a path or trailing `/` | by zone: `eu` → `https://docs.remuka.com`, `ru` → `https://docs.remuka.ru`; in the `none` zone (self-host) there are no guide links and the text stays without one |

The variable wins over the zone: that is how a stand and an installation with its own portal lead people to their own guide. The service reads it at start and publishes it in `GET /api/config` (`docs.origin`); a malformed address stops the start, so a typo cannot remove every link silently.

## Cookies and consent

| Variable | What it sets | Without it |
|---|---|---|
| `REMO_COMPLIANCE_ZONE` | the cookie rules zone: `eu` asks for consent before anything optional, `ru` shows a short notice, `none` shows nothing | `none`; a typo stops the service |
| `REMO_COOKIE_POLICY_URL` | address of the cookie policy page for the notice and the banner: absolute `https` only | there is no policy link; a value without a zone is ignored and logs one warning |
| `REMO_PERSONAL_DATA_CONSENT_URL` | address of the separate personal-data processing consent document: shown in the `ru` zone in the notice and the cookie settings, absolute `https` only | there is no document link; a value outside the `ru` zone and a malformed address each log one warning |

`none` is the safe default: on your own installation you are the data operator and choose the rules yourself. `eu` works as opt-in — anything optional loads only after consent; `ru` shows a short cookie notice.

## Documents and acceptance

| Variable | What it sets | Without it |
|---|---|---|
| `REMO_LEGAL_NOTICE_DAYS` | how many days before `effective` the daily pass queues the new-revision letter | 30 |
| `REMO_LEGAL_ALLOW_DRAFTS` | `1` lets a test stand start with a required document still a draft; it does not affect sending | production refuses to start with a required draft |
| `REMO_LEGAL_ROOT` | directory holding `content/legal/index.json` when the service does not run from the checkout | it is looked for beside the working directory |

A letter goes out once per person and revision: the idempotency key lives in the mail queue, so restarting the service does not send it again. The 30-day banner does not block the screen and closes for the rest of the browser session.

## Mail

| Variable | What it sets | Without it |
|---|---|---|
| `REMO_MAIL_DRIVER` | what sends letters: `disabled`, `console`, `smtp` or `resend` | `disabled` in production; outside production `console` when `REMO_KEK` is set, otherwise `disabled` |
| `REMO_MAIL_FROM` | sender address, for example `Remuka <no-reply@mail.example.com>` | the service does not start with `smtp` or `resend` |
| `REMO_MAIL_REPLY_TO` | address that receives replies | replies go to the address in `REMO_MAIL_FROM` |
| `REMO_MAIL_PRODUCT_NAME` | deprecated synonym of `REMO_PRODUCT_NAME`: read when the new variable is absent, and logs a warning once | the brand in the letter's language: "Remuka" |
| `REMO_RESEND_API_KEY` | Resend key with send permission only | the service does not start with `resend` |
| `REMO_SMTP_URL` | `smtps://user:password@host:465` or `smtp://user:password@host:587` | the service does not start with `smtp` |
| `REMO_MAIL_CONSOLE_FILE` | file the `console` driver appends each letter to, one JSON line per letter | letters are printed to stdout only |
| `REMO_MAIL_BATCH` | letters per sending pass, 1 to 100 | 10 |
| `REMO_REQUIRE_VERIFIED_EMAIL_FOR_INVITES` | `0` lets an unverified address invite people | `1`: only a person with a confirmed address can invite |

`console` prints the link to stdout and is refused when `NODE_ENV=production`. `smtp` accepts only ports 465 (immediate TLS) and 587 (STARTTLS): any other port or a query parameter is refused at start. Mail works with Postgres only; with disk storage the driver is always `disabled`.

With `disabled`, the “Forgot password” form and address confirmation are not shown, while an invitation still produces a link you can copy. Links in letters are built only from `REMO_APP_ORIGIN`: in production it is required, must be `https` and must not end with `/`.

## Support

The support layer is off until a provider is chosen; the service asks nothing of Chatwoot in the `none` mode.

| Variable | What it sets | Without it |
|---|---|---|
| `REMO_SUPPORT_PROVIDER` | `none`, `link` or `chatwoot` | `none`: no Help item, `/api/support/*` answers `404` |
| `REMO_SUPPORT_URL` | for `link`: the help page or a `mailto:` address | the service does not start with `link` |
| `REMO_SUPPORT_ORIGIN` | for `chatwoot`: the widget page origin without a path, for example `https://support.example.com` | the service does not start with `chatwoot`; `https` only in production |
| `REMO_SUPPORT_HMAC_SECRET` | the Identity Validation key of the Chatwoot incoming channel | the service does not start with `chatwoot` |
| `REMO_SUPPORT_CONTEXT_TOKEN` | the token the first-line agent uses to read `/api/support/context` | the context route answers `401` |
| `REMO_SUPPORT_HOURS` | the reply-time text, RU and EN separated by `\|` | “A person will reply within a working day” |

With `chatwoot` the app frames a static page at `REMO_SUPPORT_ORIGIN`; the page loads the Chatwoot SDK and receives the signed identity through `postMessage`. The app's CSP carries `frame-src` with exactly that origin, rendered at deploy time. A half-set configuration is refused at start: a widget that never loads is harder to notice than a crash.

## Metrics

| Variable | What it sets |
|---|---|
| `REMO_METRICS_DATABASE_URL` | separate database for product metrics |
| `REMO_METRICS` | `off` disables instrumentation explicitly |
| `REMO_METRICS_TOKEN` | token for `/metrics`; required in production |

Metrics are never written to the rooms database.

## Agents

| Variable | What it sets |
|---|---|
| `REMO_AI_API_KEY`, `REMO_AI_BASE_URL`, `REMO_AI_MODEL` | default provider |
| `REMO_AI_TIMEOUT_MS` | timeout of a model call |
| `REMO_AGENT_MAX_TOKENS`, `REMO_AGENT_MAX_COST_USD`, `REMO_AGENT_MAX_ACTIONS` | upper bounds of the budget |
| `REMO_AGENT_MAX_QUEUED` | how many tasks can wait at once |

Without a key tasks finish with `AI_NOT_CONFIGURED`; the rest of the product works.

## AI gateway

The gateway is a separate service: sync talks to it, and only it reaches providers. The sync variables:

| Variable | What it sets | Without it |
|---|---|---|
| `REMO_AI_GATEWAY_URL` | gateway address; setting it turns gateway mode on | direct provider calls |
| `REMO_AI_GATEWAY_TOKEN` | shared secret of sync and the gateway, 32 bytes | agents report that AI is not configured; there is no direct bypass |
| `REMO_AI_GATEWAY_CA` | PEM of the gateway certificate | the certificate is checked against the usual trust store; a self-signed one fails |
| `REMO_AI_GATEWAY_TIMEOUT_MS` | timeout of a gateway request | `REMO_AI_TIMEOUT_MS + 5000` |
| `REMO_AI_REGION` | `ru` or `eu`; the value travels in `X-Remo-Region` | the header is not sent and region rules come from the gateway configuration |

Gateway mode fails closed: when the gateway is down, a task never goes to the provider directly. `REMO_AI_API_KEY` is not needed in this mode when the installation key lives in the gateway.

`REMO_AI_GATEWAY_CA` is a multi-line PEM. In Compose put it in a quoted `env_file` value; a systemd `EnvironmentFile` does not support multi-line values, so start sync through a wrapper that reads the certificate file and exports the variable before `exec`.

The gateway's own variables:

| Variable | What it sets | Without it |
|---|---|---|
| `GATEWAY_TOKEN` | shared secret with sync | the service does not start |
| `GATEWAY_ADMIN_TOKEN_FILE` | file with the management token for `remo-gw` | `/etc/remo-ai-gateway/admin.token` |
| `GATEWAY_CONFIG` | provider registry file | `/etc/remo-ai-gateway/config.json` |
| `GATEWAY_STATE_DIR` | state and log directory | `/var/lib/remo-ai-gateway` |
| `GATEWAY_METRICS_TOKEN` | token for `/metrics` | `/metrics` answers 404 |
| `GATEWAY_TLS_CERT`, `GATEWAY_TLS_KEY` | certificate and key PEM | plain HTTP inside the tunnel |
| names from `keyEnv` | installation provider keys, for example `OPENROUTER_KEY` | a provider without a user key refuses the call |

Sync pins the gateway certificate through `REMO_AI_GATEWAY_CA`. If the certificate is issued by a public CA, the variable can be omitted.

## Files and images

| Variable | What it sets | When unset |
|---|---|---|
| `REMO_FILES_DRIVER` | where files live: `disk` or `s3` | `disk` |
| `REMO_FILES_DIR` | directory of the disk store | `REMO_DATA_DIR/files` |
| `REMO_FILES_MAX_BYTES` | limit of one file in bytes | 20 MB |
| `REMO_FILES_MAX_PIXELS` | limit of decoded pixels in one image | 50,000,000 |
| `REMO_FILES_PER_ROOM` | images in one room | 500 |
| `REMO_FILES_CONCURRENCY` | images processed at the same time | 2 |
| `REMO_FILES_QUEUE` | waiting jobs; beyond it the answer is `503 SERVER_BUSY` | 16 |
| `REMO_S3_ENDPOINT` | address of the S3-compatible service, `http://` or `https://` | the service does not start with `REMO_FILES_DRIVER=s3` |
| `REMO_S3_BUCKET` | the private bucket | the service does not start with `s3` |
| `REMO_S3_REGION` | bucket region | `us-east-1` |
| `REMO_S3_ACCESS_KEY_ID`, `REMO_S3_SECRET_ACCESS_KEY` | bucket access key | the service does not start with `s3` |
| `REMO_S3_FORCE_PATH_STYLE` | `1` for MinIO and services without subdomains | off |

Keys in the bucket are built only from identifiers: `orgs/{org}/files/{file}/{variant}`. A user's file name never reaches a key. The bucket must be private: only sync serves the files through `/files/...` after checking access to the room, and there are no public object URLs. For Yandex Object Storage set `REMO_S3_ENDPOINT=https://storage.yandexcloud.net`, the region and a service account key. Without S3, images work on disk.

## Proxy and limits

| Variable | What it sets |
|---|---|
| `REMO_TRUST_PROXY` | `1` trusts `X-Forwarded-For` behind a reverse proxy |
| `REMO_LOGIN_LIMIT` | sign-in attempts per email + IP in 15 minutes; 10 by default |
| `REMO_LOGIN_IP_LIMIT` | sign-in attempts from one IP in 15 minutes; 100 by default |
| `REMO_REGISTER_LIMIT` | registrations from one IP per hour; 20 by default |
| `REMO_HASH_CONCURRENCY` | parallel password hashes; 4 by default |
| `REMO_AI_ALLOW_PRIVATE` | `1` allows AI outbound to a private network; off by default |

## Saving quotas

| Variable | What it sets |
|---|---|
| `REMO_WS_RATE_BYTES` | bytes per second per connection; 256 KiB/s by default |
| `REMO_WS_BURST_BYTES` | burst per connection; 16 MiB by default |
| `REMO_ORG_WS_RATE_BYTES` | bytes per second per organisation; 2 MiB/s by default |
| `REMO_ORG_WS_BURST_BYTES` | burst per organisation; 64 MiB by default |
| `REMO_ROOM_MAX_BYTES` | encoded room size; 64 MiB by default |
| `REMO_ROOM_FULL_FRAME_BYTES` | largest edit a full room still accepts; 16 KiB by default |
| `REMO_ROOM_MAX_OBJECTS` | objects in a room; 20 000 by default |

One frame cannot exceed 16 MiB. An invalid variable value is ignored and the default stays.

## Webhook and debugging

| Variable | What it sets |
|---|---|
| `REMO_WEBHOOK_ALLOW_PRIVATE` | `1` allows an endpoint on the internal network |
| `REMO_DEBUG` | verbose messages about save acknowledgements |
| `REMO_VISITOR_SECRET` | signs the visitor identity in voting; without it the identity changes after a restart |
| `REMO_AI_PRICE_INPUT_PER_MTOK`, `REMO_AI_PRICE_OUTPUT_PER_MTOK` | token prices used to cost a task |
| `REMO_AI_ANCHOR_DIR`, `REMO_AI_ANCHOR_URL`, `REMO_AI_ANCHOR_TOKEN` | where the service writes the journal hash-chain head |

## Where to go next

[Limits](/guide/reference/limits) — default values for these settings.
