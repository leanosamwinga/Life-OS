# Sign-in v3 on Supabase — how each spec rule is met

How every rule in `docs/sign-in-spec.md` is met on Supabase (decision 1: keep Supabase Auth).
For each rule: **Setting** (Supabase Auth config, `supabase/config.toml`), **Hook** (a Supabase
Auth hook), **Postgres** (our own tables, functions, triggers, RLS or pg_cron), **Edge function**
(our `auth-api` function), **Web server** (the Expo Router API routes) or **Not possible** (with
what we did instead). Where Supabase forced a change to the spec, the spec was edited and the change
is logged in `docs/SPEC-QUESTIONS.md`.

Checked against Supabase's docs on 7–8 November 2026. Links are at the end of each section.

## The shape of it

```
iPhone app ──(Bearer + X-Device-Id + App Attest)──▶ auth-api (edge function) ──▶ Supabase Auth (admin API)
browser ──(cookies + CSRF)──▶ /api/auth, /api/supabase (Expo API routes) ──▶ auth-api / Data API
                                                                │
                                         Postgres: auth_* tables, hooks, guards, pg_cron
```

- **Supabase Auth (GoTrue) still issues and signs every session**, stores password hashes and
  sessions, and checks refresh tokens. The app never calls its public endpoints directly.
- **`auth-api` owns the sign-in rules**: method per email, codes, pauses, quiet check, timing
  floor, ID-token checks, tickets, reset links, deletion, export and the Apple webhook. It calls
  Supabase Auth's admin API with the service role key (edge runtime only).
- **Public sign-up, Apple and Google in Supabase Auth are all switched off**, so Supabase Auth can't
  create users or link identities on its own. `auth-api` creates users through the admin API.
- **Postgres hooks and guards** make sure nothing slips past `auth-api`: sessions need a one-time
  permit from `auth-api`, password changes need a permit, email changes are refused, and Supabase
  Auth sends no email.

## 0. Ground rules

| Rule                                     | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 One method per email, never linked   | **Not possible in Supabase Auth alone**: it links OAuth identities with the same email to one user automatically, and the docs give no switch to turn that off. So: **Setting** `[auth.external.apple]`/`[auth.external.google]` `enabled = false` and `enable_manual_linking = false`; **Edge function** verifies Apple/Google ID tokens itself and keeps identities in `auth_federated_identities` (unique on provider + `sub`); **Postgres** trigger on `auth.identities` allows only one `email` identity per user. Proven by the linking gate (11 tests against a real Supabase Auth v2.197.0, `docs/TEST-REPORT.md`). |
| 0.2 Never redirect on its own            | App: branch screens show a message and a button (`src/app/sign-in/use-method.tsx`, `sign-up/exists.tsx`, `sign-in/not-found.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 0.3 Passwords never shown, sent, kept    | App: `PasswordField` keeps `secureTextEntry`, `useClearOnBlur` and an explicit clear after every error. **Edge function**: allow-listed log fields, request bodies never logged (`log.ts`). **Hook** `send_email` means Supabase Auth sends nothing.                                                                                                                                                                                                                                                                                                                                                                        |
| 0.4 / 0.5 No hints; branch only on tap   | App copy (`src/lib/auth/copy.ts`); API returns codes only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 0.7 Copy in the apps, codes from the API | `AUTH_ERROR_CODES` in `packages/core/src/auth.ts`, shared by the app and `auth-api`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Links: [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking) ·
[Auth hooks](https://supabase.com/docs/guides/auth/auth-hooks)

## 1. Account model

| Spec table / field                                          | Where it lives                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `account`                                                   | `auth.users` (id, email, `encrypted_password`) + **Postgres** `auth_accounts` (method, status, `step_up_required`, deletion dates, `email_deliverable`, `token_epoch`, pepper version). Unique `email_norm` index. |
| `password_credential`                                       | `auth.users.encrypted_password` (Supabase Auth's bcrypt; see 5.4).                                                                                                                                                 |
| `federated_identity`                                        | **Postgres** `auth_federated_identities` (unique provider + `sub`; Apple refresh token encrypted).                                                                                                                 |
| `known_device`                                              | **Postgres** `auth_known_devices` (device-ID hash only).                                                                                                                                                           |
| `session`                                                   | `auth.sessions` + **Postgres** `auth_session_meta` (device hash, label, platform, scope, idle/absolute expiry, revoke reason). `auth_refresh_hashes` for strict reuse (8.1).                                       |
| `one_time_code`, `reset_token`, `auth_ticket`, `auth_nonce` | **Postgres** `auth_one_time_codes` (HMAC), `auth_reset_tokens` (SHA-256), `auth_tickets`, `auth_nonces`.                                                                                                           |
| 1.2 statuses                                                | `auth_accounts.status`. `PENDING_DELETION` sessions carry `lifeos_scope = PENDING_DELETION` in the access token (**Hook** custom access token) and the **Postgres** guard `check_request` refuses Data API calls.  |
| Unconfirmed can't be squatted; purged after 7 days          | **Edge function** replaces the pending password on re-create; **Postgres** `auth_housekeeping` (pg_cron) purges.                                                                                                   |
| 1.3 step-up flag                                            | **Postgres** `auth_record_wrong_password` sets it (quiet check, 4.2).                                                                                                                                              |

Every `auth_*` table is server-only: RLS on, no policies, revoked from `anon` and `authenticated`
(`lock_down_server_table`). pgTAP proves it (`supabase/tests/07_sign_in_v3.test.sql`).

## 2. Flows and 3. API

All endpoints in spec 3.2 are routes of the `auth-api` edge function
(`supabase/functions/auth-api/handler.ts`), at `/functions/v1/auth-api/v1/...`. `verify_jwt = false`
for this function (sign-in calls have no user yet); authenticated routes check the Bearer token
themselves with Supabase Auth and the live session.

| Flow                    | How                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 Create with email   | **Edge function**: checks rules + breach list, creates the user with the admin API (`email_confirm = false`), emails a code through the outbox. Supabase's own sign-up is off (`enable_signup = false`), and the `before_user_created` **Hook** refuses every public creation.                                                                                                          |
| 2.2 / 2.9 Codes         | **Edge function** + `auth_one_time_codes` (6 digits, 10 min, 5 tries, resend 30 s / 5 an hour). Supabase Auth's own OTPs are never used.                                                                                                                                                                                                                                                |
| 2.3 Sign in with email  | **Edge function** runs the spec's order (device check, limits, pause, look-up, method, password via Supabase Auth's password grant, unconfirmed, step-up, deletion scope).                                                                                                                                                                                                              |
| 2.7 Apple and Google    | **Edge function** verifies ID tokens (9.1) and then mints a session for that user (below). iPhone Google uses the browser flow (SPEC-QUESTIONS Q-GOOGLE-IOS).                                                                                                                                                                                                                           |
| 2.8 Forgot password     | **Edge function** + `auth_reset_tokens` (30 min, single use, newest wins; link `…/reset#t=…`). Supabase Auth's `/recover` isn't used. Completing a reset changes the password through the admin API with a `SET_PASSWORD` permit.                                                                                                                                                       |
| 2.10 Sign out           | **Edge function** signs the session out in Supabase Auth and marks `auth_session_meta`.                                                                                                                                                                                                                                                                                                 |
| How a session is minted | Supabase Auth has no "issue a session for this user" admin call. **Edge function** generates a one-off link with the admin `generateLink` API (which doesn't send anything) and verifies it straight away on the server, after writing an `ISSUE_SESSION` permit. **Hook** custom access token refuses any session without that permit. Nothing is ever emailed. SPEC-QUESTIONS Q-MINT. |

Links: [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) ·
[Auth hooks](https://supabase.com/docs/guides/auth/auth-hooks)

## 4. Limits and timings

| Rule                                                                                | How                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong-password pause (device+email, IP+email; doubling, 24 h cap, reset after 24 h) | **Postgres** `auth_record_wrong_password` / `auth_active_pause` (`auth_sign_in_failures`, `auth_sign_in_pauses`). Supabase Auth's rate limits are per IP or per request type and can't key on email or device, so they're not enough on their own.     |
| Quiet check (≥ 20 in 24 h from ≥ 3 keys)                                            | **Postgres** (same function) — the spec's Redis window is a Postgres table here.                                                                                                                                                                       |
| Look-up limits, resend limits, breach-range                                         | **Postgres** `auth_rate_events` via the edge function.                                                                                                                                                                                                 |
| Supabase Auth's own limits                                                          | **Setting** `[auth.rate_limit]` raised, because every call now comes from `auth-api` (one IP). Hosted: turn on **IP Address Forwarding** and send `Sb-Forwarded-For` with the secret key so Supabase Auth's limits see the end user's IP (setup list). |
| Timing floor 600 ms ± 50 ms                                                         | **Edge function** (`padTo`), on every look-up endpoint.                                                                                                                                                                                                |

Links: [Rate limits](https://supabase.com/docs/guides/auth/rate-limits)

## 5. Passwords

| Rule                               | How                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 15–128, NFKC code points, no rules | **Setting** `minimum_password_length = 15`, `password_requirements = ""`. Supabase documents no maximum, so **Edge function** enforces 128 (`checkPassword` in `packages/core`). The client checks the same function.                                                                                                                                                                                  |
| Contains the email                 | **Edge function** + core (`passwordContainsEmail`).                                                                                                                                                                                                                                                                                                                                                    |
| Breach check                       | Supabase's leaked-password protection calls the HIBP API and needs the Pro plan, and the spec wants a local copy, so **Postgres** `auth_breached_hashes` (fake fixture locally; the full dataset is a setup step) + **Edge function** check on create, reset and change + `GET /v1/password/breach-range/{prefix}` padded for the client tick. SPEC-QUESTIONS Q-BREACH.                                |
| 5.4 Argon2id + pepper              | **Not possible**: Supabase Auth hashes with bcrypt, and decision 1 keeps Supabase Auth. Instead the edge function sends Supabase Auth `base64url(HMAC-SHA256(pepper, NFKC(password)))`, so the stored hash is bcrypt over a peppered, fixed-length value (also avoids bcrypt's 72-byte limit). The pepper version sits in `auth_accounts`; rehash on sign-in. Spec 5.4 updated. SPEC-QUESTIONS Q-HASH. |

Links: [Password security](https://supabase.com/docs/guides/auth/password-security)

## 6. Checking which emails have accounts

| Rule                   | How                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device checks          | **Edge function** `DeviceCheck` interface (`device-check.ts`): App Attest on iPhone (`app-attest.ts`, attestation + assertions over `METHOD path\nbody`), Turnstile `siteverify` on web, one flag `DEVICE_CHECKS=off` for local and tests (decision 8). Supabase's CAPTCHA setting supports Turnstile and hCaptcha only on its own endpoints, which we don't use, and has no App Attest. |
| Same time every branch | **Edge function**: dummy password verify on not-found, outbox for all email, 600 ms floor.                                                                                                                                                                                                                                                                                               |
| Owner alert (7.5)      | **Edge function** + `auth_owner_alerts` (one per 24 h).                                                                                                                                                                                                                                                                                                                                  |

Links: [CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)

## 7. Emails

**Hook** `send_email` returns without sending, so Supabase Auth never sends mail. All email goes
through `auth_email_outbox` → **Edge function** `drainOutbox` → `EmailSender` (Mailpit locally; the
provider is a setup step, decision 11). Copy is spec section 7 (`email.ts`). No tracking, no
sign-in links; the only link is the reset link.

## 8. Sessions

| Rule                                              | How                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token 10 minutes                           | **Setting** `jwt_expiry = 600`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| ES256, rotated                                    | **Setting (hosted)**: Supabase's asymmetric JWT signing keys (ES256 available). Locally the CLI-style stack uses HS256. Setup list.                                                                                                                                                                                                                                                                                                            |
| Refresh rotates; any reuse kills the family       | Supabase Auth rotates, but even with the reuse interval at 0 it still accepts the **parent** of the current token and returns the active one. The spec says any reuse is theft, so: **Setting** `refresh_token_reuse_interval = 0`; **Edge function** is the only refresher, keeps `auth_refresh_hashes`, revokes the session and logs `auth.refresh.reuse` on any reuse; **Hook** needs a `REFRESH_SESSION` permit. SPEC-QUESTIONS Q-REFRESH. |
| Idle / absolute lifetimes (web 7/30, phone 30/90) | Supabase's time-box and inactivity settings are Pro-only and the same for every client, so **Hook** custom access token enforces per-platform lifetimes from `auth_session_meta`, and the edge function checks them on refresh.                                                                                                                                                                                                                |
| Revocation takes effect at once                   | **Postgres** `check_request` as PostgREST `db_pre_request`: the session must still exist and not be revoked; `PENDING_DELETION` refused. Supabase notes `db_pre_request` covers the Data API only — Storage and Realtime aren't used by Life OS yet; when they are, their RLS must call the same check. SPEC-QUESTIONS Q-PREREQUEST. Instead of `token_epoch` claims we delete the Supabase Auth sessions, which the guard sees immediately.   |
| 8.2 iPhone storage                                | `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (stricter than the spec's after-first-unlock; background refresh isn't needed yet). SPEC-QUESTIONS Q-KEYCHAIN.                                                                                                                                                                                                                                                                       |
| 8.2 Web storage                                   | **Web server** (`apps/mobile/src/server/bff.ts`, `src/app/api/**+api.ts`): `__Host-` httpOnly, Secure, SameSite=Strict cookies for the access and refresh tokens and the device ID; double-submit CSRF + Origin check; token bodies never reach the browser. SameSite=Strict is stricter than the spec's Lax. Hosting is an open question (SPEC-QUESTIONS Q-HOSTING).                                                                          |
| 8.4 Device list                                   | **Edge function** from `auth_session_meta`. Town lookup isn't built (no GeoIP database yet) — the list shows the label and last active. Supabase Auth also stores the IP in `auth.sessions`; that's outside our control and noted for the privacy policy. SPEC-QUESTIONS Q-GEOIP.                                                                                                                                                              |

Links: [Sessions](https://supabase.com/docs/guides/auth/sessions) ·
[JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys) ·
[Securing your API (db_pre_request)](https://supabase.com/docs/guides/api/securing-your-api) ·
[PostgREST pre-request](https://docs.postgrest.org/en/v14/references/transactions.html) ·
[Expo API routes](https://docs.expo.dev/router/web/api-routes/)

## 9. Apple and Google

| Rule                               | How                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 9.1 ID token checks                | **Edge function** `JoseIdTokenVerifier`: JWKS, RS256 only, `iss`, `aud`, `exp`/`iat` (60 s skew), single-use device-bound nonce (Apple native = SHA-256 of the raw nonce), `email_verified` before any email match. Supabase's `signInWithIdToken` would verify too, but it then links by email, so it isn't used. The old `skip_nonce_check` is gone. |
| 9.2 Apple code exchange and revoke | **Edge function** `apple.ts` (ES256 client secret from the `.p8`, kept as an edge secret; refresh token stored encrypted; revoked on day 30).                                                                                                                                                                                                          |
| 9.4 Apple server-to-server         | **Edge function** `POST /v1/webhooks/apple` (signature + claims, idempotent on `jti` in `auth_apple_events`). Supabase Auth itself doesn't handle these notifications.                                                                                                                                                                                 |
| Google RISC                        | Not built (recommended, not required). SPEC-QUESTIONS.                                                                                                                                                                                                                                                                                                 |

Links: [Login with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)

## 10. Logging

**Edge function** `log.ts`: one JSON event per outcome, allow-listed fields only, `email_hmac`
instead of email, request bodies never logged. The logging test greps every captured log line from
the integration run for passwords, codes and tokens (`flows.integration.test.ts`). Alerts (10.3)
need a log pipeline on the hosted project — setup list.

## 11. Data and deletion

| Rule                                         | How                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deletion: 30-day grace, other sessions out   | **Edge function** + `auth_deletion_requests`.                                                                                                                                                                             |
| Day 30: erase, revoke Apple, "deleted" email | **Postgres** `auth_run_due_deletions` via **pg_cron** (deletes `auth.users`, which cascades every user table), queues the email and the Apple revocation; pg_cron then calls the edge function with pg_net to drain them. |
| Export CSV + JSON                            | **Edge function** `GET /v1/me/export` (`export.ts`), from Me and S-5a, allowed in the `PENDING_DELETION` scope.                                                                                                           |
| UK region                                    | Hosted project in London (`eu-west-2`), as before.                                                                                                                                                                        |

Links: [Cron](https://supabase.com/docs/guides/cron)

## Screen → route map

| Screens          | Route                                        |
| ---------------- | -------------------------------------------- |
| 0a               | `src/app/welcome.tsx`                        |
| 0b-1             | `src/app/sign-up/index.tsx`                  |
| 0b-3a–h          | `src/app/sign-up/email.tsx`                  |
| 0b-4a–f          | `src/app/sign-up/code.tsx`                   |
| 0b-4g            | `src/app/onboarding/confirmed.tsx`           |
| 0b-8h            | `src/app/sign-up/exists.tsx`                 |
| 0b-2             | `src/app/sign-in/index.tsx`                  |
| 0b-5a–g, 0b-6a–d | `src/app/sign-in/email.tsx`                  |
| 0b-5h            | `src/app/sign-in/check.tsx`                  |
| 0b-6e–h          | `src/app/sign-in/use-method.tsx`             |
| 0b-8i            | `src/app/sign-in/not-found.tsx`              |
| 0b-8g            | `src/app/sign-in/failed.tsx`                 |
| 0b-8f            | `SigningIn` in `src/features/auth/parts.tsx` |
| 0b-7a–c          | `src/app/forgot.tsx`                         |
| 0b-7f–k          | `src/app/reset.tsx`                          |
| S-1a/b/c, S-3a   | `src/app/security/index.tsx`                 |
| S-3b/c           | `src/app/security/method.tsx`                |
| S-2a–f           | `src/app/security/password.tsx`              |
| S-4a–g           | `src/app/security/devices.tsx`               |
| S-5a             | `src/app/security/delete/index.tsx`          |
| S-5b–d           | `src/app/security/delete/confirm.tsx`        |
| S-5e–g           | `src/app/security/delete/type.tsx`           |
| S-5h             | `src/app/deletion.tsx`                       |
| S-5i             | `src/app/kept.tsx`                           |
