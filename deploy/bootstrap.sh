#!/usr/bin/env bash
# Run once after the shared database and <root>/shared/production.env are provisioned.
# One machine may host several instances (ADR-261); each has its own root, compose
# project and edge alias. The defaults keep the original single production layout.
set -Eeuo pipefail
umask 077
HERE=$(cd "$(dirname "$0")" && pwd)
root=${REMO_DEPLOY_ROOT:-/srv/remo}
project=${REMO_COMPOSE_PROJECT:-remo}
web_alias=${REMO_WEB_ALIAS:-${project}-web}
[[ $root =~ ^/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$ ]] || {
  echo "REMO_DEPLOY_ROOT must be an absolute path such as /srv/remo, without dots: $root" >&2
  exit 1
}
[[ $project =~ ^[a-z0-9-]+$ ]] || {
  echo "REMO_COMPOSE_PROJECT must match [a-z0-9-]+: $project" >&2
  exit 1
}
[[ $web_alias =~ ^[a-z0-9-]+$ ]] || {
  echo "REMO_WEB_ALIAS must match [a-z0-9-]+: $web_alias" >&2
  exit 1
}
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 700 "$root"
mkdir -p "$root"/{shared,releases,backups}
test -s "$root/shared/production.env" || {
  echo "Provision the database and $root/shared/production.env first; see docs/self-hosting.md." >&2
  exit 1
}
chmod 600 "$root/shared/production.env"
install -m 700 "$HERE/remo" "$root/remo"
docker network inspect "${REMO_EDGE_NETWORK:?Set REMO_EDGE_NETWORK}" > /dev/null
docker network inspect "${REMO_DB_NETWORK:?Set REMO_DB_NETWORK}" > /dev/null
echo "Prepared $root for compose project $project (edge alias $web_alias)."
echo 'Copy shared/production.env to a secure off-machine backup.'
echo "Next: put REMO_DEPLOY_ROOT=$root, REMO_COMPOSE_PROJECT=$project and" \
  "REMO_WEB_ALIAS=$web_alias in the release file, commit, run deploy/release.sh," \
  'validate and reload the reverse proxy.'
