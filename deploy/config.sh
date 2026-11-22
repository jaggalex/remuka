#!/usr/bin/env bash
# Release configuration: read and validate a private KEY=VALUE file as data.
#
# Sourced by `release.sh` and kept in its own file so the rules can be exercised
# without starting a release. Nothing here evaluates the file: `source` would turn a
# document the script merely reads into shell code and could change the environment the
# verification gate sees.

release_file_uid() { stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"; }
release_file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# Installation parameters (ADR-261). The defaults are today's production layout, so a
# deploy with an unchanged configuration still writes /srv/remo, project `remo` and the
# edge alias `remo-web`. A second installation on the same machine sets its own three.
# They may come from the release file or from the environment; both are validated by
# `check_release_parameters` before anything is uploaded.
REMO_DEPLOY_ROOT=${REMO_DEPLOY_ROOT:-/srv/remo}
REMO_COMPOSE_PROJECT=${REMO_COMPOSE_PROJECT:-remo}
REMO_WEB_ALIAS=${REMO_WEB_ALIAS:-remo-web}
# Optional HTTP basic-auth credential for the public checks after a release. A stand is
# closed by basic auth (ADR-261), and the script still has to fetch the app and the guide.
# Empty on production, where the addresses answer without a password.
REMO_DEPLOY_HTTP_AUTH=${REMO_DEPLOY_HTTP_AUTH:-}

# The root is concatenated into paths (`$root/releases/…`) and quoted into a remote
# shell, so only these characters are accepted. A dot is not among them, which also
# rules out `.` and `..` rather than relying on a spelling check alone.
check_deploy_root() {
  [[ ${1:-} =~ ^/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$ ]] && return 0
  echo "REMO_DEPLOY_ROOT must be an absolute path such as /srv/remo, without dots, '..' or a trailing slash: ${1:-}" >&2
  return 1
}

# Docker Compose project names and network aliases share one shape.
check_instance_name() {
  [[ ${2:-} =~ ^[a-z0-9-]+$ ]] && return 0
  echo "$1 must match [a-z0-9-]+: ${2:-}" >&2
  return 1
}

# Validate the three parameters as they stand after the file and the environment were
# merged. A value supplied through the environment never passes `read_release_config`.
check_release_parameters() {
  check_deploy_root "${1:-$REMO_DEPLOY_ROOT}" &&
    check_instance_name REMO_COMPOSE_PROJECT "${2:-$REMO_COMPOSE_PROJECT}" &&
    check_instance_name REMO_WEB_ALIAS "${3:-$REMO_WEB_ALIAS}" &&
    check_http_auth "${4:-$REMO_DEPLOY_HTTP_AUTH}"
}

# `curl --user` takes `user:password`. A space cannot survive the argument, and a missing
# colon is a value that would silently send no credential at all. The password is never
# echoed back.
check_http_auth() {
  local user password
  [[ -z ${1:-} ]] && return 0
  user=${1%%:*}
  password=${1#*:}
  [[ -n $user && -n $password && $1 == *:* && $1 != *[[:space:]]* ]] && return 0
  echo "REMO_DEPLOY_HTTP_AUTH must be user:password without spaces." >&2
  return 1
}

# Print why a configuration file may not be used, and return 1. Silent when it may.
check_release_config() {
  local file=$1
  [[ ! -L $file ]] || {
    echo "Refusing a symlinked release configuration: $file" >&2
    return 1
  }
  [[ -f $file && -r $file ]] || {
    echo "Cannot read release configuration: $file" >&2
    return 1
  }
  [[ $(release_file_uid "$file") == "$(id -u)" ]] || {
    echo "Release configuration must be owned by the current user: $file" >&2
    return 1
  }
  [[ $(release_file_mode "$file") == "600" ]] || {
    echo "Release configuration must be mode 600 (chmod 600 $file)." >&2
    return 1
  }
}

# Assign REMO_DEPLOY_HOST, REMO_APP_ORIGIN and REMO_DOCS_ORIGIN from strict
# `KEY=VALUE` lines, plus the optional installation parameters REMO_DEPLOY_ROOT,
# REMO_COMPOSE_PROJECT and REMO_WEB_ALIAS, and REMO_DEPLOY_HTTP_AUTH for a stand behind
# basic auth. Blank lines and `#` comments are allowed; anything else is an error, so a
# typo cannot be silently ignored.
read_release_config() {
  local file=$1 line key value
  check_release_config "$file" || return 1
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ -z $line || $line == \#* ]] && continue
    [[ $line =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]] || {
      echo "Invalid line in $file (expected KEY=VALUE): $line" >&2
      return 1
    }
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    # Values are used as arguments, never evaluated, so shell syntax is a mistake
    # rather than a feature.
    [[ $value == *'$('* || $value == *'`'* ]] && {
      echo "Shell syntax is not allowed in $file: $line" >&2
      return 1
    }
    case $key in
      REMO_DEPLOY_HOST|REMO_APP_ORIGIN|REMO_DOCS_ORIGIN) printf -v "$key" '%s' "$value" ;;
      REMO_DEPLOY_ROOT)
        check_deploy_root "$value" || return 1
        REMO_DEPLOY_ROOT=$value
        ;;
      REMO_COMPOSE_PROJECT)
        check_instance_name "$key" "$value" || return 1
        REMO_COMPOSE_PROJECT=$value
        ;;
      REMO_WEB_ALIAS)
        check_instance_name "$key" "$value" || return 1
        REMO_WEB_ALIAS=$value
        ;;
      REMO_DEPLOY_HTTP_AUTH)
        check_http_auth "$value" || return 1
        REMO_DEPLOY_HTTP_AUTH=$value
        ;;
      *)
        echo "Unknown key in $file: $key" >&2
        return 1
        ;;
    esac
  done < "$file"
}

# Render the app's security headers with the one support origin allowed to be framed.
#
# `add_header` is static: nginx cannot substitute a variable into a CSP at request time,
# so the alternative is one rendered file per installation (ADR-250). The origin is
# validated here rather than at the first blocked iframe, and only `__SUPPORT_ORIGIN__`
# in the template is replaced — sed never sees the rest of the policy.
render_support_headers() {
  local origin=$1 output=$2 template directory
  [[ $origin =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]] || {
    echo "Support origin must be https://host[:port] without a path: $origin" >&2
    return 1
  }
  directory=$(dirname -- "$output")
  [[ -d $directory ]] || {
    echo "Cannot write rendered headers: no directory $directory" >&2
    return 1
  }
  template="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nginx-security-headers-support.conf"
  [[ -f $template ]] || {
    echo "Cannot read template: $template" >&2
    return 1
  }
  sed "s|__SUPPORT_ORIGIN__|$origin|g" "$template" > "$output.tmp.$$" &&
    mv -f -- "$output.tmp.$$" "$output"
}
