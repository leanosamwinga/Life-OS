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

# Backend env (optional, for Sign in with Apple / Google locally)
cp supabase/.env.example supabase/.env
```

### Signing in locally

**Quickest:** `supabase db reset` creates a ready-made local account. In a development build, go
to **Continue with email → Use a password instead** and sign in with username **`admin`** and
password **`lifeos-admin`** (or the email `admin@example.test`). It's already set up, with
health data on, targets and a few plan meals, so you land on Today. It exists only in your local
database: the seed never runs on the hosted project.

**On a phone** (Expo Go or a dev build), `127.0.0.1` means the phone itself. In
`apps/mobile/.env.local`, use your Mac's Wi-Fi address (`ipconfig getifaddr en0`):

```
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.128:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the "Publishable" key from `supabase status`>
```

Then `npm run mobile -- --clear`. If the phone still can't connect, open
`http://<your Mac's IP>:54321` in the phone's browser; if that doesn't load, allow incoming
connections in macOS System Settings → Network → Firewall.

**Email sign-in:** `supabase start` runs a mail catcher (Mailpit) at port 54324 — on the phone,
open `http://<your Mac's IP>:54324`. Each email has a **6-digit code** (type it into the app)
and a link that opens the app directly (`exp://…` in Expo Go, `lifeos://…` in a build), so it
works from the phone. Creating an account with a password needs no email locally.

**Apple in Expo Go:** Expo Go asks Apple for a token issued to _Expo Go_ (`host.exp.Exponent`),
not Life OS, so Supabase rejects it ("Unacceptable audience"). For local testing only, add it
to `supabase/.env`:

```
SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID=com.example.lifeos,host.exp.Exponent
```

then `supabase stop && supabase start`. Never add `host.exp.Exponent` to the hosted project.
A development build (`npx expo run:ios` or EAS) uses the real bundle id and needs no stopgap.

**Google:** see below. In Expo Go and on web it opens Google in a browser; in a development
build with the client ids set it shows the native Google account sheet.

### Sign-in providers

None of these are in the repo; set them as env vars locally (`supabase/.env`) and in the
hosted project (Dashboard → Authentication → Providers).

**Redirect URLs** (Authentication → URL Configuration): Site URL `lifeos://`, plus
`lifeos://**`, your web origin (`https://<your-domain>/**`) and, for development,
`exp://127.0.0.1:8081/--/**` and `http://localhost:8081/**`.

**Sign in with Apple** (needs a paid Apple Developer account):

1. Certificates, IDs & Profiles → Identifiers → your App ID (`bundleIdentifier` in
   `apps/mobile/app.json`; replace `com.example.lifeos`) → enable _Sign in with Apple_.
2. Create a **Services ID** (e.g. `com.yourname.lifeos.web`) for web/Android, enable Sign in
   with Apple, and add `https://<project-ref>.supabase.co/auth/v1/callback` as the return URL.
3. Create a **Sign in with Apple key** (.p8), then generate the client secret JWT (Supabase
   docs → Login with Apple has a generator). It expires after 6 months — put a reminder in.
4. Set `SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID=<bundle id>,<services id>` and
   `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET=<jwt>`.

iOS uses the native Apple sheet (`expo-apple-authentication` → `signInWithIdToken`), so it
needs a development build (`npx expo run:ios` or EAS), not Expo Go. Web and Android use
the browser OAuth flow.

**Sign in with Google:**

1. Google Cloud Console → APIs & Services → OAuth consent screen (External; app name Life OS;
   scopes `email`, `profile`, `openid`).
2. Credentials → Create OAuth client ID → **Web application**. Authorised redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback` (locally
   `http://127.0.0.1:54321/auth/v1/callback`).
3. Set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`.

4. **Native sheet (development/store builds):** also create an **iOS** OAuth client (bundle id
   from `app.json`) and an **Android** OAuth client (package name + your signing SHA-1). Put
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in
   `apps/mobile/.env.local` (public ids, not secrets) and rebuild — `app.config.ts` adds the iOS
   URL scheme. List all three client ids in `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` (web
   first), and turn on **Skip nonce checks** for Google in the hosted project (the iOS SDK's
   nonce can't be passed through).

Without those ids (and always in Expo Go and on web) the app opens Google in an in-app browser
(`expo-web-browser`) and returns via `lifeos://auth/callback`.

**Email (hosted):** configure custom SMTP (Authentication → Emails) — Supabase's built-in
sender is rate-limited. Paste `supabase/templates/sign-in.html` into both the **Magic link**
and **Confirm signup** templates so emails carry the 6-digit code and the app link.

### Run the backend locally

```bash
supabase start            # Postgres, Auth, Storage, Edge runtime in Docker
supabase db reset         # apply migrations + seed.sql
supabase functions serve food-lookup
```

`supabase start` prints the API URL and anon key — put them in `apps/mobile/.env.local` as
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

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

| Command                                | What it does                                                                |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `npm run lint`                         | ESLint across the repo                                                      |
| `npm run format`                       | Prettier write (`format:check` to verify)                                   |
| `npm run typecheck`                    | `tsc -b` for core + edge functions, `tsc --noEmit` for the app              |
| `npm test`                             | core (Vitest) + edge functions (Vitest) + mobile (jest-expo)                |
| `npm run test:core`                    | core unit tests only                                                        |
| `npm run test:functions`               | edge function mapping/handler tests                                         |
| `npm run test:mobile`                  | app screen and flow tests (jest-expo)                                       |
| `npm run test:db`                      | database RLS tests (see below)                                              |
| `npm run gen:types -w @life-os/mobile` | regenerate `apps/mobile/src/lib/database.types.ts` (needs `supabase start`) |

### Database tests

`supabase/tests/*.test.sql` are pgTAP tests proving owner-only access, the global food cache rules and health-data consent.

- With Docker: `supabase start && supabase test db`
- Without Docker: point `DATABASE_URL` at an empty Postgres 15+ database with pgTAP installed and run `npm run test:db`. It loads `scripts/db/supabase-shim.sql` (roles, `auth.users`, `auth.uid()`), applies the migrations, then runs every test file. CI uses this path.

## Licences

Food data from Open Food Facts, available under the [Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
