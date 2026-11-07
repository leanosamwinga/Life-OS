#!/usr/bin/env bash
# Stops the Docker-free local auth stack started by scripts/local-auth/start.sh.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/.local-auth"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v pg_ctl)")}"
for name in gateway auth-api food-lookup postgrest auth mailpit; do
  if [[ -f "$STATE/$name.pid" ]]; then
    kill "$(cat "$STATE/$name.pid")" 2>/dev/null || true
    rm -f "$STATE/$name.pid"
  fi
done
if [[ -d "$STATE/pgdata" ]]; then
  if [[ "$(id -u)" == "0" ]]; then
    su postgres -s /bin/bash -c "'$PG_BIN/pg_ctl' -D '$STATE/pgdata' -m fast stop" 2>/dev/null || true
  else
    "$PG_BIN/pg_ctl" -D "$STATE/pgdata" -m fast stop 2>/dev/null || true
  fi
fi
