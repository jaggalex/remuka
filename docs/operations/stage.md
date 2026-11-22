# The test stand: two zones on one machine

For the current two-VPS deployment, access credentials, readiness limits and the acceptance
procedure, see [Как войти на stage и провести приёмку](stage-testing.md).

The stand is where interface acceptance (`spec/ui-acceptance.md`) runs: it creates accounts,
payments and deletions, so it must not be production. It repeats the cloud as two independent
installations, `stage-ru` and `stage-eu`, on one VPS, behind one login (ADR-261,
`spec/stage.md`). The production servers and the stand share no machine, database or network.

Parts A and B are in place. The deployment scripts, the stand server files and the nginx
template come from part A; part B is `REMO_STAGE=1` in the service, `stage:seed` and
`stage:reset`. A stand therefore announces itself on every screen, marks mail and exports,
refuses live payments and real recipients, and returns to its fixtures with one command
(`spec/stage.md` §5–§8).

## What runs where

| | `stage-ru` | `stage-eu` |
|---|---|---|
| Root | `/srv/stage-ru` | `/srv/stage-eu` |
| Compose project | `stage-ru` | `stage-eu` |
| Web alias in `edge` | `stage-ru-web` | `stage-eu-web` |
| PostgreSQL container | `stage-ru-postgres` | `stage-eu-postgres` |
| Database network | `stage-ru-db` | `stage-eu-db` |
| Database volume | `stage-ru-pg` | `stage-eu-pg` |
| Mailpit container | `stage-ru-mail` | `stage-eu-mail` |
| Apex | `stage.remuka.ru` | `stage.remuka.com` |
| Application | `app.stage.remuka.ru` | `app.stage.remuka.com` |
| Guide | `docs.stage.remuka.ru` | `docs.stage.remuka.com` |
| Inbox | `mail.stage.remuka.ru` | `mail.stage.remuka.com` |
| Release file (local) | `.config/remo/stage-ru.env.local` | `.config/remo/stage-eu.env.local` |

One external nginx serves both zones. Everything else is per instance: directory, compose
project, database container, network, volume, mail catcher and the `shared/production.env`.
The two databases are separate PostgreSQL clusters on purpose: the `remo_app` role is named
in the schema and roles are cluster-wide, so one cluster would let one instance open the
other's database (`spec/stage.md` §1.2).

## The VPS

- Debian 12 or Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB disk. Both instances build their images
  on the machine, so disk is the constraint, not CPU.
- Install Docker with the Compose plugin. Node and pnpm are not needed on the host.
- Nothing else may listen on 80 and 443: stop or remove a host nginx. TLS for the stand is
  terminated by the edge container below.
- Create the shared edge network once, and the directories the edge container mounts. They
  belong to the deploy user so the release user can render the templates and copy the legal
  pages:

  ```sh
  docker network create edge
  sudo install -d -o deploy -g deploy /srv/stage-nginx/conf.d /srv/stage-legal/ru /srv/stage-legal/eu
  ```

## DNS

Add `A` records for the stand's address in **both** zones:

| Name | Type | Value |
|---|---|---|
| `stage.remuka.ru`, `*.stage.remuka.ru` | A | stand IP |
| `stage.remuka.com`, `*.stage.remuka.com` | A | stand IP |

The wildcard covers `app.`, `docs.` and `mail.`; the apex needs its own record because
`*` does not match it. `AAAA` only if the stand has IPv6 and nginx listens on `[::]:443`
(`spec/cloud-zones.md` §3.1). There are no old-host, `api.` or `www.` records on the stand.

Check from a laptop before issuing certificates:

```sh
dig +short stage.remuka.ru app.stage.remuka.ru docs.stage.remuka.ru mail.stage.remuka.ru
```

## One login for the stand

Basic auth is decided by the edge nginx, with one `htpasswd` file for both zones. Every
tester gets their own line; nobody shares an account, because the access log then names who
did what.

```sh
sudo apt-get install -y apache2-utils          # or use the httpd:alpine image
sudo htpasswd -m -c /srv/stage-nginx/stage.htpasswd tester1
sudo htpasswd -m /srv/stage-nginx/stage.htpasswd tester2
sudo chmod 640 /srv/stage-nginx/stage.htpasswd
```

**Use `-m` (apr1), never `-B` (bcrypt).** The edge runs on Alpine, where the system
`crypt()` has no bcrypt: nginx answers `401` to every password in a `$2y$` line, so the
browser asks again and again. apr1 is verified by nginx itself, independent of libc.

Check the file before starting the container — the hash must begin with `$apr1$`:

```sh
sudo cut -d: -f2 /srv/stage-nginx/stage.htpasswd | cut -c1-6    # $apr1$
curl -s -o /dev/null -w '%{http_code}\n' -u 'tester1:THE_PASSWORD' https://app.stage.remuka.ru/
```

The file never enters Git and is mounted into the edge container. Removing a person is
one line: `sudo htpasswd -D /srv/stage-nginx/stage.htpasswd tester2`.

## Certificates

One SAN certificate per zone, named after the apex. Four names each. The first issuance
runs certbot standalone, because the edge nginx cannot start before the certificate files
exist; after that, renewals are answered from `/srv/stage-nginx/acme`, which the edge
container serves on port 80, so nothing has to stop.

```sh
sudo mkdir -p /srv/stage-nginx/acme
docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly --standalone --agree-tos -m ops@example.com \
  --cert-name stage.remuka.ru \
  -d stage.remuka.ru -d app.stage.remuka.ru -d docs.stage.remuka.ru -d mail.stage.remuka.ru

# The same for the other zone, while the edge is still not running.
docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly --standalone --agree-tos -m ops@example.com \
  --cert-name stage.remuka.com \
  -d stage.remuka.com -d app.stage.remuka.com -d docs.stage.remuka.com -d mail.stage.remuka.com
```

Renewal is a host cron entry; certbot exits non-zero when nothing was due and the reload is
skipped:

```cron
17 4 * * * root docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /srv/stage-nginx/acme:/var/www/certbot certbot/certbot renew --webroot -w /var/www/certbot --quiet && docker exec stage-nginx nginx -s reload
```

## The edge nginx

`deploy/stage/nginx-stage.conf` is one zone. Render it twice, once per instance, into the
container's `conf.d/`. Four values are substituted: `STAGE_SUFFIX`, `WEB_ALIAS`,
`MAIL_ALIAS` and `LEGAL_ZONE` (named at the top of the template).

```sh
# on your machine, in the repository
render() {
  sed -e "s|STAGE_SUFFIX|$1|g" -e "s|WEB_ALIAS|$2|g" -e "s|MAIL_ALIAS|$3|g" \
      -e "s|LEGAL_ZONE|$4|g" \
    deploy/stage/nginx-stage.conf > "/tmp/$5.conf"
}
render stage.remuka.ru stage-ru-web stage-ru-mail ru stage-ru
render stage.remuka.com stage-eu-web stage-eu-mail eu stage-eu
scp /tmp/stage-ru.conf /tmp/stage-eu.conf deploy@<stand-ip>:/srv/stage-nginx/conf.d/
```

Start the container. It joins `edge` (where the web aliases live) and publishes only 80 and
443; the application containers publish nothing. The stand's legal directory is mounted
read-only at `/srv/legal`.

```sh
docker run -d --name stage-nginx --restart unless-stopped \
  --network edge -p 80:80 -p 443:443 \
  -v /srv/stage-nginx/conf.d:/etc/nginx/conf.d:ro \
  -v /srv/stage-nginx/stage.htpasswd:/etc/nginx/stage.htpasswd:ro \
  -v /srv/stage-nginx/acme:/var/www/certbot:ro \
  -v /srv/stage-legal:/srv/legal:ro \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  nginx:1.28-alpine

docker exec stage-nginx nginx -t
```

After every rendered-file change: `docker exec stage-nginx nginx -t && docker exec
stage-nginx nginx -s reload`. The template uses `http2 on;` (nginx 1.25.1+); an older
distribution nginx needs `listen 443 ssl http2` instead.

What the template guarantees (`spec/stage.md` §4.1):

- `auth_basic` on all four hosts of both zones, one shared `htpasswd`.
- No basic auth on exactly two application paths: `/api/billing/webhooks/` (the provider
  cannot send a password; the handler verifies the signature) and `/api/health` (the release
  script's check). `/mcp` and the agent routes stay behind it. The ACME challenge paths are
  also open: a certificate authority does not log in.
- `X-Robots-Tag: noindex, nofollow` on every host and a `robots.txt` with `Disallow: /`.
- `/sync/` passes through with the upgrade headers; the credentials the browser used for the
  page are sent on the socket request as well (checked in Chrome, Firefox and Safari,
  `spec/stage.md` §8). If one browser does not, only that location loses basic auth — the
  socket still needs a session.

## Production.env of an instance

Store `/srv/stage-ru/shared/production.env` (and the `stage-eu` twin) mode `600`, owned by
the deploy user. Start from `deploy/production.env.example`; never copy production's file —
the KEK must differ, and so must every password. The keys that differ from production:

| Key | `stage-ru` | `stage-eu` |
|---|---|---|
| `REMO_DEPLOY_ROOT` | `/srv/stage-ru` | `/srv/stage-eu` |
| `REMO_COMPOSE_PROJECT` | `stage-ru` | `stage-eu` |
| `REMO_WEB_ALIAS` | `stage-ru-web` | `stage-eu-web` |
| `REMO_DB_HOST` | `stage-ru-postgres` | `stage-eu-postgres` |
| `REMO_DB_NETWORK` | `stage-ru-db` | `stage-eu-db` |
| `REMO_EDGE_NETWORK` | `edge` | `edge` |
| `DATABASE_URL` | `postgres://remo_app:…@stage-ru-postgres:5432/remo` | `…@stage-eu-postgres:5432/remo` |
| `REMO_MIGRATION_DATABASE_URL` | `postgres://remo:…@stage-ru-postgres:5432/remo` | `…@stage-eu-postgres:5432/remo` |
| `REMO_APP_ORIGIN` / `REMO_CORS_ORIGIN` | `https://app.stage.remuka.ru` | `https://app.stage.remuka.com` |
| `REMO_DOCS_ORIGIN` | `https://docs.stage.remuka.ru` | `https://docs.stage.remuka.com` |
| `REMO_COMPLIANCE_ZONE` | `ru` | `eu` |
| `REMO_BILLING` / `REMO_BILLING_CURRENCIES` | `on` / `RUB` | `on` / `USD` |
| `REMO_MAIL_DRIVER` / `REMO_SMTP_URL` | `smtp` / `smtp://mail:1025` | the same |
| `REMO_BACKUP_KEEP_DAYS` | `3` | `3` |
| `REMO_STAGE` | `1` | `1` |

`REMO_KEK`, `REMO_DB_PASSWORD`, `REMO_APP_DB_PASSWORD` and `REMO_METRICS_TOKEN` are generated
per instance (`openssl rand`). `REMO_MAIL_FROM` uses the stand's own domain.

`REMO_STAGE=1` is the stand flag and must never appear on production. It turns on the
banner, `noindex`, the `[Стенд]` / `[Stage]` mail subject, the export watermark, the mail
allow-list, the refusal of live payments and the `stage:*` commands. `/api/health` then
answers `"stage": true`; on production the field is absent (`spec/stage.md` §5).

The rest of the stand-only keys belong in the same file. They are secrets or instance
addresses and follow the same rule: mode `600`, never in Git.

| Key | What it sets |
|---|---|
| `REMO_STAGE_SEED_DOMAIN` | the address domain of the fixtures (`owner@<domain>`, `pro@<domain>`, …), e.g. `stage.remuka.ru` |
| `REMO_STAGE_SEED_PASSWORD` | password of all five fixture accounts; at least 8 characters |
| `REMO_MAIL_ALLOW_RECIPIENTS` | comma-separated addresses and domains a real mail driver may write to on the stand, e.g. `tester@example.com,@example.test`. Empty is allowed only while every letter goes to Mailpit |
| `REMO_STAGE_MAILPIT_URL` | base URL of the Mailpit API for `stage:reset`, default `http://mail:8025`. The reset runs on the stand host, so point it at an address reachable from there; the backend alias `mail` resolves only inside the instance's network |
| `REMO_STAGE_RESET_LOG` | file that receives the `who + when` line of every `stage:reset`, in addition to the service log |
| `REMO_STAGE_RESET_ACTOR` | the name written as “who”; defaults to the operating-system user running the command |
| `REMO_STAGE_COMPOSE_FILE` | compose file used to stop and start `sync` during a reset, default `deploy/compose.production.yml` |

`REMO_COMPOSE_PROJECT` is required for `stage:reset` to stop and start the service: the
command runs `docker compose -p <project> … stop sync` before the drop and `start sync`
after the seed. Without it the database is still reset, but the command says that this host
does not manage the service, and the operator must stop it by hand.

`REMO_LEGAL_ALLOW_DRAFTS=1` is accepted only together with `REMO_STAGE=1`. Production with
the drafts flag does not start at all: the error is raised before the port opens
(`spec/stage.md` §5). The stand may publish drafts, but a draft is still not sent to people
through the legal-notice loop.

The mail driver on the stand is `smtp` to Mailpit. `REMO_SMTP_URL=smtp://mail:1025` is the
documented exception to the “465 or 587 only” rule: port 1025 is accepted only for an
internal mail host on a stand. `resend`, and SMTP to any host outside the instance, need a
non-empty `REMO_MAIL_ALLOW_RECIPIENTS`; a letter to anyone else is written to
`mail_outbox.status = 'suppressed'` with a reason instead of being sent.

## First deploy of one instance

The release itself runs on your machine; the provisioning steps run on the stand, and each
command says where. Copy four files from the release: `deploy/remo`, `deploy/bootstrap.sh`,
`deploy/stage/compose.db.yml` and `scripts/db-rls-setup.mjs`.

```sh
scp deploy/remo deploy/bootstrap.sh deploy/stage/compose.db.yml \
  deploy@<stand-ip>:/tmp/
scp scripts/db-rls-setup.mjs deploy@<stand-ip>:/tmp/
```

1. **Directories and the first environment file.** The root is owned by the deploy user,
   `shared/` is mode 700, `production.env` mode 600:

   ```sh
   # on the stand
   sudo install -d -o deploy -g deploy -m 700 /srv/stage-ru
   install -d -m 700 /srv/stage-ru/shared

   # from your machine: start from the example, then edit it on the stand
   scp deploy/production.env.example deploy@<stand-ip>:/srv/stage-ru/shared/production.env
   ssh deploy@<stand-ip> 'chmod 600 /srv/stage-ru/shared/production.env'
   # fill in the table above and the generated secrets
   ```

2. **The database container.** No port is published; the container listens on
   `stage-ru-db` only. This also creates the network and the `stage-ru-pg` volume:

   ```sh
   cp /tmp/compose.db.yml /srv/stage-ru/compose.db.yml
   docker compose -p stage-ru --env-file /srv/stage-ru/shared/production.env \
     -f /srv/stage-ru/compose.db.yml up -d
   docker exec -u postgres stage-ru-postgres pg_isready -d remo
   ```

3. **The application role.** `remo_app` is cluster-wide and must exist before the release
   controller verifies RLS. Run the repository's own setup script inside a throwaway Node
   container attached to the database network; it reads the two URLs and the password from
   `production.env`, so no secret appears on a command line:

   ```sh
   cp /tmp/db-rls-setup.mjs /srv/stage-ru/
   docker run --rm --network stage-ru-db \
     --env-file /srv/stage-ru/shared/production.env \
     --user "$(id -u):$(id -g)" -e HOME=/tmp \
     -v /srv/stage-ru:/work -w /work node:22-bookworm-slim \
     sh -c 'npm install --no-save pg >/dev/null 2>&1 && node db-rls-setup.mjs'
   rm -rf /srv/stage-ru/node_modules /srv/stage-ru/package.json /srv/stage-ru/package-lock.json \
     /srv/stage-ru/db-rls-setup.mjs
   ```

4. **Bootstrap the root.** Installs the controller as `/srv/stage-ru/remo` and checks both
   Docker networks:

   ```sh
   REMO_DEPLOY_ROOT=/srv/stage-ru REMO_COMPOSE_PROJECT=stage-ru \
   REMO_WEB_ALIAS=stage-ru-web REMO_EDGE_NETWORK=edge REMO_DB_NETWORK=stage-ru-db \
     bash /tmp/bootstrap.sh
   ```

   `bootstrap.sh` prints the project and alias it prepared: use exactly those in step 5.

5. **Release from your machine.** The private file has mode 600, stays outside Git, and
   names the instance explicitly. Nothing is defaulted, so the command cannot reach another
   installation:

   ```sh
   # .config/remo/stage-ru.env.local
   REMO_DEPLOY_HOST=deploy@<stand-ip>
   REMO_DEPLOY_ROOT=/srv/stage-ru
   REMO_COMPOSE_PROJECT=stage-ru
   REMO_WEB_ALIAS=stage-ru-web
   REMO_DEPLOY_HTTP_AUTH=tester1:<stand password>
   REMO_APP_ORIGIN=https://app.stage.remuka.ru
   REMO_DOCS_ORIGIN=https://docs.stage.remuka.ru
   ```

   `REMO_DEPLOY_HTTP_AUTH` is the basic-auth pair of one tester (`user:password`), not a
   new account: the release script fetches the app and the guide after the deploy and a
   stand answers `401` without it. It is a secret, which is why it belongs in this file.

   ```sh
   chmod 600 .config/remo/stage-ru.env.local
   REMO_DEPLOY_ENV_FILE=.config/remo/stage-ru.env.local bash deploy/release.sh
   ```

   The script checks the directory of this instance over SSH, runs the gate, uploads the
   commit, prepares the schema, starts the containers and checks `/api/health`, the app
   and the guide on `app.stage.remuka.ru` / `docs.stage.remuka.ru`. The health check is
   the one path that does not need the password.

6. **The inbox.** Start it after the first release, because it joins the application's
   `backend` network:

   ```sh
   cd /srv/stage-ru/releases/$(cat /srv/stage-ru/current)
   docker compose -p stage-ru --env-file /srv/stage-ru/shared/production.env \
     -f deploy/stage/compose.mail.yml up -d
   ```

   `REMO_SMTP_URL=smtp://mail:1025` is set in step 1; the host only resolves once this
   container is up, and the release's health check does not need mail. Mailpit keeps 1000
   messages in memory; a restart empties it.

7. **The legal pages.** `pnpm legal:build` writes `legal-site/<zone>/`; the edge serves the
   instance's own zone from `/srv/legal/<zone>/`. From your machine, once per release that
   changes the texts:

   ```sh
   pnpm legal:build
   ssh deploy@<stand-ip> 'install -d /srv/stage-legal/ru'
   scp -r legal-site/ru deploy@<stand-ip>:/srv/stage-legal/
   ```

   Use `legal-site/eu` and `/srv/stage-legal/eu` for the other zone. A draft document is
   not published on the stand either. The registry may still carry a draft for acceptance
   work, but only when both `REMO_STAGE=1` and `REMO_LEGAL_ALLOW_DRAFTS=1` are set; without
   the stand flag the service refuses to start.

8. **The same steps for `stage-eu`**, with `/srv/stage-eu`, `stage-eu`,
   `stage-eu-web`, `stage-eu-db`, `stage-eu-postgres`, `stage-eu-mail`,
   `.config/remo/stage-eu.env.local` and the `.com` addresses.

Every later release is step 5 alone, one instance per command.

## Backups

Each instance uses the same templated unit as production, with its name after `@`. The
template runs `/srv/%i/remo backup` at 03:15 UTC; `REMO_BACKUP_KEEP_DAYS=3` in
`production.env` deletes dumps older than three days after a good one.

```sh
release=/srv/stage-ru/releases/$(cat /srv/stage-ru/current)
sudo install -m 644 "$release/deploy/remo-backup@.service" "$release/deploy/remo-backup@.timer" \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now remo-backup@stage-ru.timer remo-backup@stage-eu.timer
sudo systemctl list-timers 'remo-backup*'
```

Run one by hand and read the log:

```sh
sudo systemctl start remo-backup@stage-ru.service
journalctl -u remo-backup@stage-ru.service -n 20
ls -l /srv/stage-ru/backups
```

### Moving production to the template

Production used to install `remo-backup.service` and `remo-backup.timer`. Two timers would
run two backups a night, so the old pair is disabled and removed in the same step:

```sh
release=/srv/remo/releases/$(cat /srv/remo/current)
sudo install -m 644 "$release/deploy/remo-backup@.service" "$release/deploy/remo-backup@.timer" \
  /etc/systemd/system/
sudo systemctl disable --now remo-backup.timer
sudo rm -f /etc/systemd/system/remo-backup.service /etc/systemd/system/remo-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now remo-backup@remo.timer
sudo systemctl list-timers --all 'remo-backup*'
```

Exactly one `remo-backup@remo.timer` must be listed, and `systemctl status remo-backup.timer`
must say the unit could not be found. The first run writes
`/srv/remo/backups/…` as before; the root is unchanged.

## Seed, reset and the order of work

Both commands exist only with `REMO_STAGE=1`; without the flag they refuse before touching
the database. Run them on the stand, in the active release directory
(`cd /srv/stage-ru/releases/$(cat /srv/stage-ru/current)`), with the instance's
`production.env` available. The commands read `REMO_PRODUCTION_ENV`,
`REMO_DEPLOY_ROOT/shared/production.env` or the checkout `.env` as data, in that order; a
variable already exported in the shell wins.

### `pnpm stage:seed`

Creates or repairs the fixtures of `spec/stage.md` §6 and is idempotent: a second run keeps
one set of rooms, one Pro subscription and one public link.

| Fixture | What it is |
|---|---|
| `owner@<domain>` | owner of a Free organisation with five rooms, exactly at the Free limit |
| `pro@<domain>` | organisation on Pro, paid by a test invoice and a manual test payment |
| `colleague@<domain>` | active member of `owner@`'s organisation |
| `legacy@<domain>` | account with no acceptance of the current legal documents |
| `operator@<domain>` | instance operator without TOTP, for the recovery scenarios |
| `stage-owner-room-1` | room with a public link and the password `stage` |

The fixture password and address domain come from `REMO_STAGE_SEED_PASSWORD` and
`REMO_STAGE_SEED_DOMAIN`. The command never prints the password. Test payment connections
are not created by the seed; create them once with
`pnpm billing:providers create --mode test …`.

### `pnpm stage:reset --yes`

Returns the stand to that state in one traceable step:

1. stops `sync` with `docker compose -p $REMO_COMPOSE_PROJECT … stop sync`;
2. drops and recreates the instance's own database from
   `REMO_MIGRATION_DATABASE_URL`, terminating the remaining sessions first;
3. runs the ordinary migrations (`schema 38`);
4. runs `stage:seed`;
5. empties Mailpit through `REMO_STAGE_MAILPIT_URL` (a warning, not a failure, when it is
   unreachable);
6. writes `who + when` to the service log and to `REMO_STAGE_RESET_LOG`, when set;
7. starts `sync` again, even when an earlier step failed.

`--yes` is mandatory: the command is destructive. Without `REMO_COMPOSE_PROJECT` it still
resets the database but cannot stop or start the service, and says so. Without
`REMO_STAGE=1` it refuses immediately — this is also the production guard.

### The order

1. `pnpm stage:reset --yes` enters a clean database and ends with the fixtures.
2. `pnpm stage:seed` is optional afterwards: the reset has already run it, and a repeat is
   harmless when a scenario changed a fixture.
3. Check `/api/health` (`"stage": true`, the expected `schema` and `commit`), then open the
   app and run the acceptance items below.

Do not drop the database by hand: the reset is the operation that stops writers, keeps the
instance name, runs the same migrations and leaves the record of who did it.

## What to check after the first deploy

```sh
# Basic auth is the gate: 401 everywhere except the two paths.
curl -sI https://app.stage.remuka.ru/ | head -1
curl -s  https://app.stage.remuka.ru/api/health
curl -sI -u 'tester1:<stand password>' https://app.stage.remuka.ru/ | grep -i x-robots-tag

# Two projects, not one, and their own containers.
docker compose ls
docker ps --filter name=stage-

# A stand account does not exist on the other zone: register on .ru, try to sign in on .com.
```

## Part B acceptance

The flag itself is the subject of this list: every item must be true on the stand and false
on production (`spec/stage.md` §5, §8).

1. **The service says it is a stand.** `curl -s https://app.stage.remuka.ru/api/health`
   contains `"stage": true`, the stand's own `schema` (38 after this release) and `commit`.
   The same request to production has no `stage` key.
2. **The banner is everywhere.** «Тестовый стенд · данные удаляются» / “Test stand · data is
   deleted” is visible on the organisation home, in a room, in help and in the operator
   console; it cannot be closed.
3. **No indexing.** The HTML carries `<meta name="robots" content="noindex, nofollow">` and
   the response header `X-Robots-Tag: noindex, nofollow` is present on every stand host.
4. **Mail is marked.** A letter from the stand has the subject prefix `[Стенд]` (RU letter)
   or `[Stage]` (EN letter) and arrives in Mailpit. The prefix is added by the shared
   renderer, so a new template cannot lose it.
5. **Exports are marked.** Export a room as PNG and as PDF: both carry the repeated «Стенд» /
   “Stage” watermark. The JPEG inside the PDF is the same marked canvas, not a second path.
6. **Real recipients are filtered.** With `REMO_MAIL_DRIVER=resend` (or SMTP to a host
   outside the instance) and `REMO_MAIL_ALLOW_RECIPIENTS` set, send to an address outside
   the list. It must not leave; `mail_outbox.status` is `suppressed` with
   `suppress_reason = 'RECIPIENT_NOT_ALLOWED'`. A listed address and a listed domain still
   send. With the Mailpit driver the catcher accepts every letter and the list is not used.
7. **Live money is refused.** `pnpm billing:providers create --mode live …` fails on the
   stand. A live connection that already exists is not used at checkout: the response is
   `409 STAGE_LIVE_PAYMENT_REFUSED` and `audit_events` has a
   `billing.live_refused_on_stage` row. Test-mode connections still work.
8. **Drafts need the stand.** `REMO_LEGAL_ALLOW_DRAFTS=1` without `REMO_STAGE=1` stops the
   service start with an error naming the flag; with both flags the stand starts.
9. **The commands need the flag.** `pnpm stage:seed` and `pnpm stage:reset --yes` both refuse
   without `REMO_STAGE=1`. On the stand the second run of the seed changes nothing, and the
   reset returns the fixtures, empties Mailpit and writes the operator and the time to the
   log.

After part B, `spec/stage.md` §8 is the complete acceptance list; this section is the
deployment view of the same checks.
