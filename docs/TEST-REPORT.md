# Sign-in v3 — test report

- Run started: Sat 7 Nov 2026, 00:45 (Europe/London). Branch `claude/phase2-sign-in-v3`.
- Environment: Docker client present but no daemon (`/var/run/docker.sock` missing) → Supabase CLI stack cannot run. Plan: Supabase Auth (GoTrue) release binary + local Postgres 16 + Mailpit binary.

## Local Supabase Auth (no Docker)

`bash scripts/local-auth/start.sh` — what it runs, exactly:

| Piece | Version / source | How |
|---|---|---|
| Postgres | 16 from the system packages (`/usr/lib/postgresql/16/bin`), plus `postgresql-16-pgtap` and `postgresql-16-cron` from apt | fresh `initdb` in `.local-auth/pgdata`, port 54322, `shared_preload_libraries = pg_cron`; Supabase roles from `scripts/local-auth/roles.sql` |
| Supabase Auth (GoTrue) | official release `v2.197.0`, `auth-v2.197.0-x86.tar.gz` from github.com/supabase/auth releases, sha256 `9daff5d1…78f3` (checked by the script) | `auth migrate` (its own 75 auth-schema migrations), then our `supabase/migrations/*.sql` and `seed.sql`, then `auth serve` on :9999 |
| Mailpit | official release `v1.33.0`, `mailpit-linux-amd64.tar.gz` from github.com/axllent/mailpit releases, sha256 `d0ec5008…87c8` | SMTP :54325, UI/API :54324 |

Settings come from `scripts/local-auth/config-to-env.sh`, which mirrors `supabase/config.toml`.
All secrets are generated per start into `.local-auth/env` (git-ignored).
