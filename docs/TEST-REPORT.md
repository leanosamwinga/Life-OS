# Sign-in v3 — test report

- Run started: Sat 7 Nov 2026, 00:45 (Europe/London). Branch `claude/phase2-sign-in-v3`.
- Environment: Docker client present but no daemon (`/var/run/docker.sock` missing) → Supabase CLI stack cannot run. Plan: Supabase Auth (GoTrue) release binary + local Postgres 16 + Mailpit binary.

## Local Supabase Auth (no Docker)

`bash scripts/local-auth/start.sh` — what it runs, exactly:

| Piece                  | Version / source                                                                                                                               | How                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres               | 16 from the system packages (`/usr/lib/postgresql/16/bin`), plus `postgresql-16-pgtap` and `postgresql-16-cron` from apt                       | fresh `initdb` in `.local-auth/pgdata`, port 54322, `shared_preload_libraries = pg_cron`; Supabase roles from `scripts/local-auth/roles.sql` |
| Supabase Auth (GoTrue) | official release `v2.197.0`, `auth-v2.197.0-x86.tar.gz` from github.com/supabase/auth releases, sha256 `9daff5d1…78f3` (checked by the script) | `auth migrate` (its own 75 auth-schema migrations), then our `supabase/migrations/*.sql` and `seed.sql`, then `auth serve` on :9999          |
| Mailpit                | official release `v1.33.0`, `mailpit-linux-amd64.tar.gz` from github.com/axllent/mailpit releases, sha256 `d0ec5008…87c8`                      | SMTP :54325, UI/API :54324                                                                                                                   |

Settings come from `scripts/local-auth/config-to-env.sh`, which mirrors `supabase/config.toml`.
All secrets are generated per start into `.local-auth/env` (git-ignored).

## Linking gate (STEP 2) — PROVEN against a real Supabase Auth

`npm run test:integration` → `supabase/functions/auth-api/test/linking-gate.integration.test.ts`, 11/11 passing on
Supabase Auth v2.197.0 (local binary above). Apple and Google are faked with locally generated RSA keys and a
local JWKS URL (test-only provider configuration); no real Apple/Google credentials are used.

| Check                                                                                                                                                                      | Result |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Google or Apple (sign in and create) for a password account's email → `WRONG_METHOD {method: PASSWORD}`, no identity added                                                 | ✅     |
| Apple for a Google account's email, Google for an Apple account's email → `WRONG_METHOD`, nothing linked                                                                   | ✅     |
| Email + password sign-up for a Google / Apple account's email → `WRONG_METHOD` (0b-3h), no password set, owner alert sent once                                             | ✅     |
| Same provider + same email + different `sub` → `PROVIDER_ACCOUNT_MISMATCH`, identity not replaced                                                                          | ✅     |
| Google/Apple ID-token grant and OAuth redirect straight to Supabase Auth → refused (providers off)                                                                         | ✅     |
| Public sign-up, OTP sign-up, anonymous sign-in straight to Supabase Auth → refused                                                                                         | ✅     |
| Password grant straight to Supabase Auth → refused (peppered password; and the custom-access-token hook refuses without an auth-api permit even with the derived password) | ✅     |
| Supabase Auth's own OTP / magic link / recovery emails → never sent (Send Email hook), and their tokens can't issue a session without a permit                             | ✅     |
| `auth.identities` refuses a non-email identity or a second identity (trigger)                                                                                              | ✅     |
| A signed-in user can't set/change a password via Supabase Auth `PUT /user` (trigger on `auth.users`)                                                                       | ✅     |
| Every user has exactly one identity, and it is `email`; no extra `auth.identities` rows ever                                                                               | ✅     |

Run again after the rest of the build: 11/11 still pass (41/41 integration tests in total, below).

## Checks before the PR (Sun 8 Nov 2026)

| Check                                  | Command                                                                                      | Result                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Lint                                   | `npm run lint`                                                                               | ✅ clean                                                                                     |
| Format                                 | `npm run format:check`                                                                       | ✅ clean                                                                                     |
| Typecheck                              | `npm run typecheck` (core, edge functions, app)                                              | ✅ clean                                                                                     |
| Unit tests                             | `npm test`                                                                                   | ✅ core 53/53 · edge functions 42/42 · app (jest-expo) 110/110 in 13 suites                  |
| Database tests                         | `DATABASE_URL=…/lifeos_pgtap npm run test:db` (fresh database on the local Postgres 16)      | ✅ all 7 files pass; `07_sign_in_v3` 58/58                                                   |
| Integration tests (real Supabase Auth) | `npm run local-auth && npm run test:integration`                                             | ✅ 41/41: linking gate 11, flows 27, web cookie server 3. Run twice back to back, both green |
| Deno check                             | `npx deno check --config supabase/functions/<fn>/deno.json supabase/functions/<fn>/index.ts` | ✅ `food-lookup` · ✅ `auth-api`                                                             |
| Expo export, iOS                       | `npx expo export -p ios`                                                                     | ✅                                                                                           |
| Expo export, web (server output)       | `npx expo export -p web`                                                                     | ✅ client + 2 API routes (`/api/auth/[...path]`, `/api/supabase/[...path]`)                  |
| Expo export, Android (decision 9)      | `npx expo export -p android`                                                                 | ✅ still builds                                                                              |
| Secret scan before every push          | `git diff` checked for JWTs (`eyJ…`), private-key blocks and live keys                       | ✅ nothing found; only `*.env.example` placeholders and the documented local-only pepper     |
| Database types                         | `npx supabase gen types typescript --db-url <local> --schema public`                         | ✅ regenerated (CLI 3.0.0, no Docker needed with `--db-url`)                                 |

## Spec section 12 checklist

Where each item is proven. **J** = app test (`apps/mobile/src/__tests__/sign-in-v3.test.tsx`, jest-expo
against the in-memory backend) · **I** = integration test against the real Supabase Auth
(`supabase/functions/auth-api/test/*.integration.test.ts`) · **P** = pgTAP
(`supabase/tests/07_sign_in_v3.test.sql`) · **U** = unit test · **Manual** = needs a real device or
person, not run overnight · **Later** = Android (decision 9).

### Entry and method screens

| Item                                          | iPhone / web                                                | Android |
| --------------------------------------------- | ----------------------------------------------------------- | ------- |
| 0a both buttons; Terms and Privacy 44 pt      | J ("0a → 0b-1 offers…"); 44 pt via shared `ListRow`/buttons | Later   |
| 0b-1 / 0b-2 Apple, Google, email order; links | J                                                           | Later   |

### Create with email (0b-3)

| Item                                                | Proof                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 3a rules before typing; button disabled             | J                                                                              |
| 3b live ticks; breach tick sends only 5 hex chars ✔ | J; U (`breachRangePrefix`, core `auth.test.ts`); I (range endpoint padded)     |
| 3c creating                                         | J                                                                              |
| 3d don't match, device-only, both cleared           | J ("0b-3d passwords don't match")                                              |
| 3e 14 fails, 15/128 pass, 129 fails; NFKC ✔         | U (core); I ("accepts 15 and 128 characters; emoji and combining characters…") |
| 3f breached ✔                                       | I (fixture password); J                                                        |
| Contains the email ✔                                | U; I ("rejects bad passwords on the server with the spec codes")               |
| 3g exists; owner alert once per 24 h ✔              | J; I                                                                           |
| 3h Google and Apple variants                        | J; I (linking gate)                                                            |
| Re-creating unconfirmed replaces it ✔               | I                                                                              |

### Confirm code (0b-4)

| Item                                                | Proof                                                   |
| --------------------------------------------------- | ------------------------------------------------------- |
| 4a resend after 30 s; paste across boxes            | J. iOS one-time-code autofill: **Manual** (real device) |
| 4b / 4c / 4d (10 min + 1 s ✔) / 4e (5th try ✔)      | J; I                                                    |
| 4f old code rejected ✔; 6th resend → RESEND_LIMIT ✔ | I; J                                                    |
| 4g → 0c                                             | J                                                       |

### Sign in with email (0b-5)

| Item                                                                                   | Proof                                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 5a / 5b / 5c                                                                           | J                                                                              |
| 5d password cleared, email kept, no counter                                            | J; I (no "left/attempt")                                                       |
| 5e not recognised with Apple hint                                                      | J                                                                              |
| 5f pause ✔, other device ✔, right password refused ✔, doubles ✔, resets after 24 h ✔   | I; J                                                                           |
| 5g unconfirmed → new code → 0b-4a                                                      | I; J                                                                           |
| 5h flag after 20 from 3 keys ✔, known device not challenged ✔, new device code ✔, copy | I; J                                                                           |
| Exists / not found / wrong method within 30 ms at p95 ✔                                | I (all hit the padded 600 ms floor). p95 in production needs monitoring (10.3) |

### Wrong method (0b-6)

| Item                                   | Proof                                      |
| -------------------------------------- | ------------------------------------------ |
| 6a–6h, right button, no auto-linking ✔ | I (linking gate, 11 tests; flows 6a/6c); J |

### Forgot password (0b-7)

| Item                                                                                           | Proof |
| ---------------------------------------------------------------------------------------------- | ----- |
| 7a / 7b                                                                                        | J     |
| 7c identical for every case (body, status, timing ✔)                                           | I; J  |
| 7d once ✔, 30 min ✔, newer kills older ✔, 4th request silent ✔                                 | I     |
| 7e Google/Apple email; nothing for unknown ✔                                                   | I     |
| 7f–7i                                                                                          | J     |
| 7j                                                                                             | J     |
| 7k every session revoked incl. mid-request ✔, email ✔, not signed in ✔, unconfirmed → active ✔ | I; J  |

### Apple and Google (0b-8)

| Item                                                                               | Proof                                                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 8a Apple sheet, Share / Hide My Email; name on first sign-in only                  | Server side I (relay flag, `given_name`); the native sheet: **Manual** (needs a dev build and Apple account) |
| 8b + 8c iPhone Google; web Google pop-up; redirect fallback                        | **Manual** (real Google client ids). Server verification I                                                   |
| 8d Android and web Apple                                                           | Web: **Manual** (Apple Services ID). Android: Later                                                          |
| 8e Android Credential Manager                                                      | Later                                                                                                        |
| 8f loading and Cancel → back, no error                                             | J                                                                                                            |
| 8g invalid signature, wrong aud, wrong iss, expired, reused nonce, missing nonce ✔ | I                                                                                                            |
| 8h ticket one-tap; expires at 2 min ✔                                              | I; J                                                                                                         |
| 8i one-tap create                                                                  | I; J                                                                                                         |
| PROVIDER_ACCOUNT_MISMATCH support copy                                             | I (linking gate); J                                                                                          |
| Apple webhooks: consent-revoked ✔, email-disabled ✔, bad signature ✔               | I                                                                                                            |

### Me → Security (row 9)

| Item                                                                            | Proof                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| S-1a / S-1b / S-1c                                                              | J                                                                                          |
| "Coming later" rows not tappable, announced "Later"                             | J (accessibility state)                                                                    |
| S-2a–c rules first, button disabled until valid                                 | J                                                                                          |
| S-2d same pause ✔; S-2e breached; same-as-current                               | I; J                                                                                       |
| S-2f this device stays in, others out at once ✔, email 7.6                      | I; J                                                                                       |
| S-3a / S-3b / S-3c                                                              | J (S-3a); S-3b/c copy follows the spec (SPEC-QUESTIONS Q-S3)                               |
| S-4a this device first                                                          | I; J                                                                                       |
| S-4b–d next API call 401 ✔; push token gone ✔                                   | I (401 + Data API refused, P). Push tokens: none exist yet (phase 6)                       |
| S-4e sign out everywhere → 0a                                                   | I; J                                                                                       |
| S-4f / S-4g                                                                     | J                                                                                          |
| S-5a what's deleted; download                                                   | J; I (export JSON + ZIP of CSVs)                                                           |
| S-5b / S-5c / S-5d                                                              | J; I (re-auth)                                                                             |
| S-5e / 5f DELETE case-sensitive ✔                                               | I; J                                                                                       |
| S-5g                                                                            | J                                                                                          |
| S-5h others out ✔; only S-5h, every other call 403 ✔                            | I; P (`check_request`); J                                                                  |
| S-5i cancel → full access, "safe" email                                         | I; J                                                                                       |
| Day 30: data gone ✔, Apple token revoked ✔, "deleted" email ✔, email reusable ✔ | P (incl. "every user table cascades"); I                                                   |
| S-5j email has no links                                                         | U (`email.test.ts`: only the reset email has a link; no tracking; codes never in subjects) |

### Cross-cutting

| Item                                                                | Proof                                                                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Screen readers read errors (`role="alert"`), label every code digit | J (roles and labels asserted). Real VoiceOver: **Manual**. TalkBack: Later                                             |
| Dynamic Type at largest sizes                                       | **Manual** (screens are in ScrollViews; not visually checked)                                                          |
| Targets ≥ 44 pt                                                     | Shared components enforce `minHeight: 44`; not measured on a device                                                    |
| No password, code or token in logs ✔                                | I ("no password, code, token, link, nonce or full email ever appears in the logs")                                     |
| Tokens where 8.2 says; nothing in UserDefaults / localStorage ✔     | iPhone: SecureStore (`device.ts`). Web: I + U (cookie server — the browser only gets cookies; token bodies rewritten). |

## Skipped or not run, and why

- **Docker / `supabase start`**: no Docker daemon in this environment, so the Supabase CLI stack and
  `supabase functions serve` weren't run. Everything was run against the Docker-free stack above
  instead; `auth-api` runs in-process under Vitest (Node) rather than in the Deno edge runtime, and
  `deno check` covers its Deno entry point.
- **PostgREST** isn't part of the local stack, so `check_request` is proven by pgTAP calling it with
  the claims PostgREST would set, not through a live Data API.
- **Real Apple / Google / Turnstile / App Attest**: no credentials (and none may be committed). Fake
  JWKS and ID tokens for the providers; device checks off in the integration run, with unit tests for
  the App Attest and Turnstile verifiers.
- **Real devices** (iPhone autofill, Face ID sheet, VoiceOver, Dynamic Type): not available overnight.
- **`npx expo install`** was blocked by the network proxy; packages were added with npm at the
  versions in Expo SDK 58's `bundledNativeModules.json` instead.
- Nothing needed approval and nothing was skipped for lack of it.
