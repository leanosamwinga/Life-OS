#!/usr/bin/env bash
# Run supabase/tests against a throwaway database.
#
#   * With the Supabase CLI and Docker:   supabase start && supabase test db
#   * Without Docker (plain Postgres + pgTAP):   DATABASE_URL=postgres://... npm run test:db
#
# The plain-Postgres path loads scripts/db/supabase-shim.sql (roles, auth.users, auth.uid()),
# applies every migration in order, then runs each test file and fails on any "not ok".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  if command -v supabase >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    exec supabase test db
  fi
  echo "Set DATABASE_URL to an empty Postgres database (with pgTAP available), or install the Supabase CLI and Docker." >&2
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

"${PSQL[@]}" -c "alter database \"$("${PSQL[@]}" -Atc 'select current_database()')\" set search_path = \"\$user\", public, extensions"
"${PSQL[@]}" -f "$ROOT/scripts/db/supabase-shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$migration")"
  "${PSQL[@]}" -f "$migration"
done

# Load the seed too, as `supabase start` does, so tests must coexist with seed rows.
if [[ -f "$ROOT/supabase/seed.sql" ]]; then
  echo "seed: seed.sql"
  "${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
fi

failed=0
for test_file in "$ROOT"/supabase/tests/*.test.sql; do
  echo "test: $(basename "$test_file")"
  output="$("${PSQL[@]}" -At -f "$test_file" 2>&1)" || { echo "$output"; failed=1; continue; }
  echo "$output" | sed 's/^/  /'
  if echo "$output" | grep -qE '^(not ok|# Looks like)'; then
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo "Database tests FAILED" >&2
  exit 1
fi
echo "Database tests passed"
