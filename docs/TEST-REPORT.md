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

## Linking gate (STEP 2) — PROVEN against a real Supabase Auth

`npm run test:integration` → `supabase/functions/auth-api/test/linking-gate.integration.test.ts`, 11/11 passing on
Supabase Auth v2.197.0 (local binary above). Apple and Google are faked with locally generated RSA keys and a
local JWKS URL (test-only provider configuration); no real Apple/Google credentials are used.

| Check | Result |
|---|---|
| Google or Apple (sign in and create) for a password account's email → `WRONG_METHOD {method: PASSWORD}`, no identity added | ✅ |
| Apple for a Google account's email, Google for an Apple account's email → `WRONG_METHOD`, nothing linked | ✅ |
| Email + password sign-up for a Google / Apple account's email → `WRONG_METHOD` (0b-3h), no password set, owner alert sent once | ✅ |
| Same provider + same email + different `sub` → `PROVIDER_ACCOUNT_MISMATCH`, identity not replaced | ✅ |
| Google/Apple ID-token grant and OAuth redirect straight to Supabase Auth → refused (providers off) | ✅ |
| Public sign-up, OTP sign-up, anonymous sign-in straight to Supabase Auth → refused | ✅ |
| Password grant straight to Supabase Auth → refused (peppered password; and the custom-access-token hook refuses without an auth-api permit even with the derived password) | ✅ |
| Supabase Auth's own OTP / magic link / recovery emails → never sent (Send Email hook), and their tokens can't issue a session without a permit | ✅ |
| `auth.identities` refuses a non-email identity or a second identity (trigger) | ✅ |
| A signed-in user can't set/change a password via Supabase Auth `PUT /user` (trigger on `auth.users`) | ✅ |
| Every user has exactly one identity, and it is `email`; no extra `auth.identities` rows ever | ✅ |
