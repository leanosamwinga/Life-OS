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
#   * PostgREST (the Data API) — official release binary, pinned below — on :54330, configured
#     like Supabase's: connects as `authenticator`, anon role `anon`, the same JWT secret as Auth,
#     and in-database config, so the migration's `pgrst.db_pre_request = public.check_request`
#     applies exactly as on `supabase start`.
#   * The edge functions (auth-api, food-lookup) in Deno — official release binary, pinned — on
#     :54331 / :54332, with supabase/functions/.env.example as their env (+ the SUPABASE_* values
#     the edge runtime injects).
#   * A small gateway on :54321 (scripts/local-auth/gateway.mjs) routing /auth/v1, /rest/v1 and
#     /functions/v1 like Supabase's Kong, so the app and the e2e test use the same URLs as with
#     `supabase start`. LOCAL_STACK_HOST=0.0.0.0 makes it reachable from a phone on your Wi-Fi.
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
POSTGREST_VERSION="v16.5"
POSTGREST_SHA256="5099e7ada38f9f6846cd87c14c5f158b7c165f1e9959665ad412e61f4dceba95"
DENO_VERSION="v2.9.6"
DENO_SHA256="394f07f4da2bebe6ce6f1e7ce0fa16429b29b08c35e3fac3fe25972676dff4b2"

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v initdb)")}"
PG_PORT=54322
AUTH_PORT=9999
SMTP_PORT=54325
MAIL_UI_PORT=54324
REST_PORT=54330
AUTH_API_PORT=54331
FOOD_LOOKUP_PORT=54332
GATEWAY_PORT=54321
GATEWAY_HOST="${LOCAL_STACK_HOST:-127.0.0.1}"

run_pg() { if [[ "$(id -u)" == "0" ]]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }

fetch() { # url sha256 dest-dir
  local url="$1" sum="$2" dir="$3" tgz
  tgz="$dir/download.tgz"
  mkdir -p "$dir"
  curl -sSfL -o "$tgz" "$url"
  echo "$sum  $tgz" | sha256sum -c --quiet -
  case "$url" in
    *.tar.xz) tar -xJf "$tgz" -C "$dir" ;;
    *.zip) unzip -q -o "$tgz" -d "$dir" ;;
    *) tar -xzf "$tgz" -C "$dir" ;;
  esac
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

if [[ ! -x "$BIN/postgrest/postgrest" ]]; then
  echo "download: PostgREST $POSTGREST_VERSION"
  fetch "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x86-64.tar.xz" "$POSTGREST_SHA256" "$BIN/postgrest"
fi
if [[ ! -x "$BIN/deno/deno" ]]; then
  echo "download: Deno $DENO_VERSION"
  fetch "https://github.com/denoland/deno/releases/download/$DENO_VERSION/deno-x86_64-unknown-linux-gnu.zip" "$DENO_SHA256" "$BIN/deno"
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

# ---------------------------------------------------------------------------- PostgREST
# Supabase's settings: authenticator, anon role, the Auth JWT secret, in-database config (so the
# migration's pgrst.db_pre_request is used, as on `supabase start`), extra search path.
REST_ENV="$STATE/postgrest.env"
cat >"$REST_ENV" <<EOF
PGRST_DB_URI=postgresql://authenticator@127.0.0.1:$PG_PORT/postgres
PGRST_DB_SCHEMAS=public
PGRST_DB_ANON_ROLE=anon
PGRST_DB_CONFIG=true
PGRST_DB_EXTRA_SEARCH_PATH=public,extensions
PGRST_DB_MAX_ROWS=1000
PGRST_JWT_SECRET=$JWT_SECRET
PGRST_SERVER_HOST=127.0.0.1
PGRST_SERVER_PORT=$REST_PORT
PGRST_ADMIN_SERVER_PORT=$((REST_PORT + 10))
EOF
(
  set -a; source "$REST_ENV"; set +a
  nohup "$BIN/postgrest/postgrest" >"$STATE/logs/postgrest.log" 2>&1 &
  echo $! >"$STATE/postgrest.pid"
)

# ---------------------------------------------------------------------------- edge functions
# Each function's env: supabase/functions/.env.example exactly as the README says to copy it,
# plus what the edge runtime injects. Mailpit is on 127.0.0.1 here (no Docker).
FN_ENV="$STATE/functions.env"
{
  grep -E '^[A-Z_0-9]+=' "$ROOT/supabase/functions/.env.example" | grep -v '^MAILPIT_URL='
  echo "MAILPIT_URL=http://127.0.0.1:$MAIL_UI_PORT"
  echo "SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT"
  echo "SUPABASE_ANON_KEY=$ANON_KEY"
  echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY"
  echo "SUPABASE_DB_URL=postgresql://postgres@127.0.0.1:$PG_PORT/postgres"
} >"$FN_ENV"
start_fn() { # name port
  local name="$1" fport="$2"
  (
    cd "$ROOT/supabase/functions/$name"
    DENO_SERVE_ADDRESS="tcp:127.0.0.1:$fport" DENO_NO_UPDATE_CHECK=1 \
      nohup "$BIN/deno/deno" run --allow-net --allow-env --allow-read --allow-sys \
      --env-file="$FN_ENV" --config deno.json index.ts >"$STATE/logs/$name.log" 2>&1 &
    echo $! >"$STATE/$name.pid"
  )
}
start_fn auth-api "$AUTH_API_PORT"
start_fn food-lookup "$FOOD_LOOKUP_PORT"

# ---------------------------------------------------------------------------- gateway (Kong)
(
  export GATEWAY_HOST GATEWAY_PORT JWT_SECRET
  export AUTH_UPSTREAM="http://127.0.0.1:$AUTH_PORT" REST_UPSTREAM="http://127.0.0.1:$REST_PORT"
  export FUNCTIONS="auth-api=http://127.0.0.1:$AUTH_API_PORT:nojwt,food-lookup=http://127.0.0.1:$FOOD_LOOKUP_PORT:jwt"
  export ANON_KEY SERVICE_ROLE_KEY="$SERVICE_KEY"
  nohup node "$ROOT/scripts/local-auth/gateway.mjs" >"$STATE/logs/gateway.log" 2>&1 &
  echo $! >"$STATE/gateway.pid"
)

wait_for() { # name url — any HTTP answer counts
  for _ in $(seq 1 300); do
    curl -s -o /dev/null "$2" 2>/dev/null && return 0
    sleep 0.2
  done
  echo "$1 didn't start:"
  tail -20 "$STATE/logs/$1.log"
  exit 1
}
wait_for postgrest "http://127.0.0.1:$((REST_PORT + 10))/ready"
wait_for auth-api "http://127.0.0.1:$AUTH_API_PORT/auth-api/v1/health"
wait_for food-lookup "http://127.0.0.1:$FOOD_LOOKUP_PORT/"
wait_for gateway "http://127.0.0.1:$GATEWAY_PORT/health"

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
LOCAL_API_URL=http://127.0.0.1:$GATEWAY_PORT
LOCAL_REST_URL=http://127.0.0.1:$REST_PORT
EOF
echo "local stack up: API :$GATEWAY_PORT (auth · rest · functions) · postgres :$PG_PORT · mailpit :$MAIL_UI_PORT"
echo "env in .local-auth/env. App: EXPO_PUBLIC_SUPABASE_URL=http://<this machine>:$GATEWAY_PORT, EXPO_PUBLIC_SUPABASE_ANON_KEY=<LOCAL_ANON_KEY>"
