# Life OS

One calm, minimal place for health, money, plans, extracurriculars and reflection. iOS first, then web, then Android. UK only: £, metric, Europe/London time.

This repo is an npm workspaces monorepo:

| Path                 | What                                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| `apps/mobile`        | Expo (SDK 58) + Expo Router app — tabs: Today, Health, Week, Money, Me            |
| `packages/core`      | Pure TypeScript: domain types, nutrition maths, UK formatting. No I/O             |
| `supabase/`          | `config.toml`, `migrations/`, `functions/` (Edge Functions), `seed.sql`, `tests/` |
| `scripts/`           | `test-db.sh` + a Supabase shim for running database tests on plain Postgres       |
| `.github/workflows/` | CI: install, lint, typecheck, tests                                               |

See [`CLAUDE.md`](./CLAUDE.md) for product context, domain rules, conventions and the phase plan.

## Prerequisites

- Node 22 (see `.nvmrc`) and npm 10+
- For the backend: [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker
- For iOS: Xcode + Simulator, or Expo Go on a device

## Setup

```bash
npm install

# App env (optional — without it the app starts with a "Not connected" banner and sample data)
cp apps/mobile/.env.example apps/mobile/.env.local

# auth-api secrets for `supabase functions serve` (local values only)
cp supabase/functions/.env.example supabase/functions/.env
```

The copied `supabase/functions/.env` works locally as it is: its `NOT-A-SECRET` values are
local-only defaults, and `auth-api` refuses to start with them anywhere but a local stack.

**Coming from an older branch?** Apple and Google settings moved. The `SUPABASE_AUTH_EXTERNAL_*`
values in `supabase/.env` are no longer read; put the ids in `supabase/functions/.env` instead
(`GOOGLE_CLIENT_IDS`, `APPLE_BUNDLE_ID`, …) and restart `supabase functions serve`. To try Apple
inside Expo Go, set `APPLE_BUNDLE_ID=host.exp.Exponent` there — local only, never on the hosted
project.

### Signing in locally (sign-in v3)

How sign-in works is in `docs/sign-in-spec.md`; how it's built on Supabase is in
`docs/sign-in-supabase-mapping.md`. Email accounts use a password (15–128 characters). There are
nothing emailed can sign anyone in: the only codes are the "confirm your email" code
(0b-4) and the new-device check (0b-5h).

**Quickest:** `supabase db reset` creates a confirmed local password account:

- email **`admin@example.test`**, password **`lifeos-local-admin-2026`**
- in development builds (`__DEV__` only) you can type just **`admin`** as the email.

It has health data on, targets and a few plan meals, so you land on Today. It exists only in your
local database — the seed never runs on the hosted project, and this password must never be used
there. Its hash uses the documented local pepper `local-dev-pepper-NOT-A-SECRET`
(`AUTH_PASSWORD_PEPPER_V1` in `supabase/functions/.env.example`); the hosted project needs its own
random pepper.

**On a phone** (Expo Go or a dev build), `127.0.0.1` means the phone itself. In
`apps/mobile/.env.local`, use your Mac's Wi-Fi address (`ipconfig getifaddr en0`):

```
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.128:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the "Publishable" key from `supabase status`>
```

Then `npm run mobile -- --clear`. If the phone still can't connect, open
`http://<your Mac's IP>:54321` in the phone's browser; if that doesn't load, allow incoming
connections in macOS System Settings → Network → Firewall.

**Emails** (confirm code, new-device code, reset link, security notices) are all sent by `auth-api`
through `EmailSender`; locally that's Mailpit at `http://127.0.0.1:54324` (on the phone,
`http://<your Mac's IP>:54324`). Supabase Auth itself sends nothing.

**Local switches** (`supabase/functions/.env`): `AUTH_DEVICE_CHECKS=off` (App Attest / Turnstile;
also `EXPO_PUBLIC_DEVICE_CHECKS=off` in the app), `AUTH_BREACH_CHECK=on` (the local breach list is a
fake fixture — try `correct horse battery staple`), `AUTH_TIMING_FLOOR_MS=600`.

**Web** runs through a small cookie server (Expo Router API routes in `apps/mobile/src/app/api`):
the browser only ever holds httpOnly cookies, never tokens. `npm run mobile -- --web` serves it.

### Sign-in providers

Supabase Auth's own Apple and Google providers stay **off** (they would link accounts by email).
`auth-api` checks Apple and Google ID tokens itself. Set these as `auth-api` secrets
(`supabase/functions/.env` locally, `supabase secrets set` on the hosted project) and the public
ids in `apps/mobile/.env.local`. None of them go in the repo.

**Sign in with Apple** (needs a paid Apple Developer account):

1. Certificates, IDs & Profiles → Identifiers → your App ID (`bundleIdentifier` in
   `apps/mobile/app.json`; replace `com.example.lifeos`) → enable _Sign in with Apple_ and
   _App Attest_.
2. Create a **Services ID** for web, enable Sign in with Apple, and add your web origin and its
   return URL.
3. Create a **Sign in with Apple key** (.p8). Set `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
   `APPLE_PRIVATE_KEY` (the .p8 contents — a secret), `APPLE_BUNDLE_ID`, `APPLE_SERVICES_ID`, and
   `EXPO_PUBLIC_APPLE_SERVICES_ID` / `EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI` in the app.
4. Register `https://<project-ref>.supabase.co/functions/v1/auth-api/v1/webhooks/apple` as the
   server-to-server notification endpoint, and register the email domain with Apple's Private
   Email Relay.

iOS uses the native Apple sheet (`expo-apple-authentication`), so it needs a development build
(`npx expo run:ios` or EAS), not Expo Go.

**Sign in with Google:**

1. Google Cloud Console → OAuth consent screen (External; scopes `email`, `profile`, `openid`).
2. Create a **Web** client (for the web app) and an **iOS** client (bundle id from `app.json`).
3. Set `GOOGLE_CLIENT_IDS=<web id>,<ios id>` for `auth-api`, and
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in the app (public ids).
   `app.config.ts` adds the iOS redirect scheme.

On iPhone Google opens in `ASWebAuthenticationSession` (code + PKCE + nonce); on web it uses
Google Identity Services with a nonce. Android sign-in screens are a follow-up (decision 9).

### Run the backend locally

```bash
supabase start            # Postgres, Auth, Storage, Edge runtime in Docker
supabase db reset         # apply migrations + seed.sql + the fake breach fixture
supabase functions serve --env-file supabase/functions/.env   # auth-api + food-lookup
```

`supabase start` prints the API URL and anon key — put them in `apps/mobile/.env.local` as
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

**Without Docker** (what the sign-in integration tests use): `npm run local-auth` downloads pinned
Supabase Auth (GoTrue) and Mailpit binaries, starts them against a local Postgres 16 with pg_cron
and pgTAP, applies the migrations and writes `.local-auth/env` (git-ignored, local-only keys).
Then `npm run test:integration` runs the linking gate and every sign-in flow against it.
`bash scripts/local-auth/stop.sh` stops it.

When creating the hosted project, choose a **UK/EU region (London, `eu-west-2`)** — the Privacy Policy promises UK/EU storage.

### Barcode scanning

Scanning (Log meal → Scan) uses `expo-camera` and the `food-lookup` edge function. Locally run
`supabase functions serve food-lookup` alongside `supabase start`. The camera needs a real
device or the web app in a browser with a webcam (the iOS simulator has no camera) — every
platform also has "Or type the barcode". Seed barcodes are fake (`0000000000017`, …), so try
a real product to exercise Open Food Facts. Expo Go includes `expo-camera`; Apple sign-in
still needs a development build.

### Run the app

```bash
npm run mobile            # expo start; press i for the iOS simulator
```

## Scripts (from the repo root)

| Command                                | What it does                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`                         | ESLint across the repo                                                                                                                                                   |
| `npm run format`                       | Prettier write (`format:check` to verify)                                                                                                                                |
| `npm run typecheck`                    | `tsc -b` for core + edge functions, `tsc --noEmit` for the app                                                                                                           |
| `npm test`                             | core (Vitest) + edge functions (Vitest) + mobile (jest-expo)                                                                                                             |
| `npm run test:core`                    | core unit tests only                                                                                                                                                     |
| `npm run test:functions`               | edge function mapping/handler tests                                                                                                                                      |
| `npm run test:mobile`                  | app screen and flow tests (jest-expo)                                                                                                                                    |
| `npm run test:db`                      | database RLS tests (see below)                                                                                                                                           |
| `npm run local-auth`                   | start a Docker-free Supabase Auth + Postgres + Mailpit for sign-in tests                                                                                                 |
| `npm run test:integration`             | sign-in integration tests against that real Supabase Auth                                                                                                                |
| `npm run gen:types -w @life-os/mobile` | regenerate `apps/mobile/src/lib/database.types.ts` (needs `supabase start`; without Docker: `npx supabase gen types typescript --db-url <postgres url> --schema public`) |

### Database tests

`supabase/tests/*.test.sql` are pgTAP tests proving owner-only access, the global food cache rules, health-data consent and the sign-in tables, hooks, guards and deletion job.

- With Docker: `supabase start && supabase test db`
- Without Docker: point `DATABASE_URL` at an empty Postgres 15+ database with pgTAP installed and run `npm run test:db`. It loads `scripts/db/supabase-shim.sql` (roles, `auth.users`, `auth.uid()`), applies the migrations, then runs every test file. CI uses this path.

## Licences

Food data from Open Food Facts, available under the [Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
