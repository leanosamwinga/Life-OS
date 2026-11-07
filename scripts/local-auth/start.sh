#!/usr/bin/env bash
# Local Supabase Auth stack WITHOUT Docker, for the sign-in integration tests.
#
#   bash scripts/local-auth/start.sh      # downloads (once), resets and starts everything
#   bash scripts/local-auth/stop.sh
#
# What it runs (all on 127.0.0.1, all data under .local-auth/, which is git-ignored):
#   * Postgres 16 (your system install, e.g. /usr/lib/postgresql/16) on :54322, with pg_cron
#     and pgTAP, and the Supabase roles (anon, authenticated, service_role, supabase_auth_admin).
#   * Supabase Auth (GoTrue) — the official release binary, pinned below — on :9999. It applies
#     its own auth-schema migrations, then ours are applied on top (as `supabase db reset` would).
#   * Mailpit — official release binary — SMTP on :54325, web UI + API on :54324.
#
# Every secret here (JWT secret, HMAC keys, service key) is generated fresh on each start and
# written to .local-auth/env. They are LOCAL ONLY and never used for the hosted project.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/.local-auth"
BIN="$STATE/bin"
PGDATA="$STATE/pgdata"
mkdir -p "$BIN" "$STATE/logs"

AUTH_VERSION="v2.197.0"
AUTH_SHA256="9daff5d1939c3142a1586e435e6e2a7a2f71534ec40ff1b196b59b83ad5678f3"
MAILPIT_VERSION="v1.33.0"
MAILPIT_SHA256="d0ec50080cbf3e7c1fa2cda2ee68125d7894175811084b1f8f47c6cfc6f487c8"

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v initdb)")}"
PG_PORT=54322
AUTH_PORT=9999
SMTP_PORT=54325
MAIL_UI_PORT=54324

run_pg() { if [[ "$(id -u)" == "0" ]]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }

fetch() { # url sha256 dest-dir
  local url="$1" sum="$2" dir="$3" tgz
  tgz="$dir/download.tgz"
  mkdir -p "$dir"
  curl -sSfL -o "$tgz" "$url"
  echo "$sum  $tgz" | sha256sum -c --quiet -
  tar -xzf "$tgz" -C "$dir"
  rm -f "$tgz"
}

if [[ ! -x "$BIN/auth/auth" ]]; then
  echo "download: Supabase Auth $AUTH_VERSION"
  fetch "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" "$AUTH_SHA256" "$BIN/auth"
fi
if [[ ! -x "$BIN/mailpit/mailpit" ]]; then
  echo "download: Mailpit $MAILPIT_VERSION"
  fetch "https://github.com/axllent/mailpit/releases/download/$MAILPIT_VERSION/mailpit-linux-amd64.tar.gz" "$MAILPIT_SHA256" "$BIN/mailpit"
fi

bash "$ROOT/scripts/local-auth/stop.sh" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------- Postgres
rm -rf "$PGDATA"
mkdir -p "$PGDATA"
[[ "$(id -u)" == "0" ]] && chown -R postgres "$STATE"
run_pg "'$PG_BIN/initdb' -D '$PGDATA' -U postgres --auth=trust >/dev/null"
cat >>"$PGDATA/postgresql.conf" <<EOF
port = $PG_PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$STATE'
shared_preload_libraries = 'pg_cron'
cron.database_name = 'postgres'
timezone = 'UTC'
EOF
run_pg "'$PG_BIN/pg_ctl' -D '$PGDATA' -l '$STATE/logs/postgres.log' -w start >/dev/null"

PSQL=(psql "postgresql://postgres@127.0.0.1:$PG_PORT/postgres" -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$ROOT/scripts/local-auth/roles.sql"

# Fresh local-only secrets.
rand() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48; }
JWT_SECRET="$(rand)"
SERVICE_KEY="$(node "$ROOT/scripts/local-auth/sign-jwt.mjs" "$JWT_SECRET" service_role)"
ANON_KEY="$(node "$ROOT/scripts/local-auth/sign-jwt.mjs" "$JWT_SECRET" anon)"

# ---------------------------------------------------------------------------- Supabase Auth
AUTH_ENV="$STATE/auth.env"
cat >"$AUTH_ENV" <<EOF
GOTRUE_DB_DRIVER=postgres
DATABASE_URL=postgres://supabase_auth_admin:local-only-auth-admin@127.0.0.1:$PG_PORT/postgres
GOTRUE_DB_MIGRATIONS_PATH=$BIN/auth/migrations
GOTRUE_API_HOST=127.0.0.1
PORT=$AUTH_PORT
API_EXTERNAL_URL=http://127.0.0.1:$AUTH_PORT
GOTRUE_SITE_URL=lifeos://
GOTRUE_JWT_SECRET=$JWT_SECRET
GOTRUE_JWT_EXP=600
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_ADMIN_ROLES=service_role
$(bash "$ROOT/scripts/local-auth/config-to-env.sh")
GOTRUE_SMTP_HOST=127.0.0.1
GOTRUE_SMTP_PORT=$SMTP_PORT
GOTRUE_SMTP_ADMIN_EMAIL=no-reply@lifeos.test
GOTRUE_SMTP_SENDER_NAME="Life OS"
GOTRUE_LOG_LEVEL=info
EOF

set -a; source "$AUTH_ENV"; set +a
"$BIN/auth/auth" migrate >"$STATE/logs/auth-migrate.log" 2>&1

# Our migrations + seed, in order, as `supabase db reset` does.
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$migration" >/dev/null
done
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/fixtures/breached-passwords.sql" >/dev/null

nohup "$BIN/mailpit/mailpit" --smtp "127.0.0.1:$SMTP_PORT" --listen "127.0.0.1:$MAIL_UI_PORT" \
  --smtp-auth-accept-any --smtp-auth-allow-insecure --disable-version-check \
  >"$STATE/logs/mailpit.log" 2>&1 &
echo $! >"$STATE/mailpit.pid"

nohup "$BIN/auth/auth" serve >"$STATE/logs/auth.log" 2>&1 &
echo $! >"$STATE/auth.pid"

for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$AUTH_PORT/health" >/dev/null 2>&1 && break
  sleep 0.2
done
curl -sf "http://127.0.0.1:$AUTH_PORT/health" >/dev/null || { tail -20 "$STATE/logs/auth.log"; exit 1; }

cat >"$STATE/env" <<EOF
# Generated by scripts/local-auth/start.sh — LOCAL ONLY, regenerated on every start.
LOCAL_AUTH_URL=http://127.0.0.1:$AUTH_PORT
LOCAL_DB_URL=postgresql://postgres@127.0.0.1:$PG_PORT/postgres
LOCAL_MAILPIT_URL=http://127.0.0.1:$MAIL_UI_PORT
LOCAL_SMTP_HOST=127.0.0.1
LOCAL_SMTP_PORT=$SMTP_PORT
LOCAL_JWT_SECRET=$JWT_SECRET
LOCAL_SERVICE_ROLE_KEY=$SERVICE_KEY
LOCAL_ANON_KEY=$ANON_KEY
LOCAL_SERVER_SECRET=$(rand)
EOF
echo "local auth stack up: auth :$AUTH_PORT · postgres :$PG_PORT · mailpit :$MAIL_UI_PORT (env in .local-auth/env)"
