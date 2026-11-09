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

## Run it on your phone

Expo Go (or a development build) on an iPhone, talking to Supabase on your Mac over Wi-Fi. Run
these from the repo root, in this order. The Supabase CLI doesn't need installing: every command
uses it through `npx supabase …`. The blocks contain only commands, so they paste into zsh as
they are.

1. Install, and copy both env files (once). The copied `supabase/functions/.env` works locally as
   it is; set `APPLE_BUNDLE_ID=host.exp.Exponent` in it to try Sign in with Apple in Expo Go.

```bash
npm install
cp supabase/functions/.env.example supabase/functions/.env
cp apps/mobile/.env.example apps/mobile/.env.local
```

2. Start Supabase with this branch's config and database (Docker running). `config.toml` is only
   read at start, so always stop first. The reset applies this branch's migrations and the seed
   (`admin@example.test`). `status` prints the "API URL" and the "Publishable" (anon) key.

```bash
npx supabase stop
npx supabase start
npx supabase db reset
npx supabase status
```

3. Serve the edge functions (`auth-api`, `food-lookup`) and leave it running in its own window.

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

4. Fill in `apps/mobile/.env.local` (see below), then check everything.

```bash
npm run doctor
```

5. Start the app and scan the QR code with the iPhone camera.

```bash
npm run mobile -- --clear
```

**Which value goes where**

| File                      | Key                                                                    | Value                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/mobile/.env.local`  | `EXPO_PUBLIC_SUPABASE_URL`                                             | `http://<your Mac's Wi-Fi IP>:54321` (`ipconfig getifaddr en0`). **Not** `127.0.0.1` — that's the phone. |
| `apps/mobile/.env.local`  | `EXPO_PUBLIC_SUPABASE_ANON_KEY`                                        | the **Publishable** key from `npx supabase status` (never the Secret key — it ships in the app)          |
| `apps/mobile/.env.local`  | `EXPO_PUBLIC_DEVICE_CHECKS`                                            | `off` (Expo Go can't do App Attest)                                                                      |
| `apps/mobile/.env.local`  | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | public Google client ids (optional; Google needs a development build, see below)                         |
| `supabase/functions/.env` | `AUTH_*` secrets, `MAILPIT_URL`                                        | as copied from `.env.example` (local-only values)                                                        |
| `supabase/functions/.env` | `AUTH_DEVICE_CHECKS`                                                   | `off`, matching the app                                                                                  |
| `supabase/functions/.env` | `APPLE_BUNDLE_ID`                                                      | `host.exp.Exponent` in Expo Go (local only); your bundle id in a development build                       |
| `supabase/functions/.env` | `GOOGLE_CLIENT_IDS`                                                    | `<web id>,<ios id>` — the same ids the app has                                                           |

Changed `.env.local`? Restart with `npm run mobile -- --clear` (Expo inlines `EXPO_PUBLIC_*` at
build time). Changed `supabase/functions/.env`? Restart `npx supabase functions serve`.

**Switching branches** (or after pulling a branch that changes `supabase/`): the running stack
keeps the old `config.toml` and the old database. Reset both, and the phone's stored session:

```bash
npx supabase stop
npx supabase start
npx supabase db reset
npx supabase functions serve --env-file supabase/functions/.env
```

Then, in another window:

```bash
npm run doctor
```

Sessions from before a reset no longer exist. The app notices on its first request and goes back
to Welcome (0a) on its own — just sign in again. **A reset also erases every account you created**
(only the seeded `admin@example.test` comes back): signing in with Apple or Google afterwards shows
0b-8i "We don't recognise that account" — that's correct; create it again. Development builds say
so on that screen.

**What `npm run doctor` checks** (one line each, with the fix): it first prints the repo path and
branch it is looking at, and warns about a nested clone (another copy of this repo inside it, which
is easy to run commands in by mistake); then Docker and the stack; this
branch's migrations and the Data API guard; that `config.toml`'s Auth hooks are running (if not:
`npx supabase stop`, then `npx supabase start`); both env files (an empty `APPLE_BUNDLE_ID` is an
error, and Apple/Google ids still sitting in `supabase/.env` are reported as moved); that `auth-api` answers; that `auth-api` can
reach Mailpit; that `EXPO_PUBLIC_SUPABASE_URL` isn't `127.0.0.1` and answers. Testing in the
simulator or on the web instead? `npm run doctor -- --simulator` accepts `127.0.0.1`.

**Expo Go and Apple / Google.** Sign in with Apple works in Expo Go (the native sheet; set
`APPLE_BUNDLE_ID=host.exp.Exponent` in `supabase/functions/.env` — without it Apple ends on 0b-8g
and `npm run doctor` shows ✗). **Google sign-in needs a
development build** (`npx expo run:ios` or `eas build --profile development`): Google returns to
the app through a URL scheme made from the iOS client id, which Expo Go can't register. In Expo Go
the Google button says so instead of failing.

**Codes and emails** arrive in Mailpit: `http://127.0.0.1:54324` on the Mac.

**Without Docker** (Linux, CI): `npm run local-auth` runs the same pieces from pinned release
binaries — Postgres 16, Supabase Auth, PostgREST, the edge functions in Deno and a gateway on
`:54321` — and writes the keys to `.local-auth/env` (`LOCAL_ANON_KEY` is the app's key). Start it
with `LOCAL_STACK_HOST=0.0.0.0 npm run local-auth` to reach it from a phone.

## Setup

Install, copy the app env (optional — without it the app starts with a "Not connected" banner
and sample data) and the `auth-api` secrets for `npx supabase functions serve` (local values only):

```bash
npm install
cp apps/mobile/.env.example apps/mobile/.env.local
cp supabase/functions/.env.example supabase/functions/.env
```

The copied `supabase/functions/.env` works locally as it is: its `NOT-A-SECRET` values are
local-only defaults, and `auth-api` refuses to start with them anywhere but a local stack.

**Coming from an older branch?** Apple and Google settings moved. The `SUPABASE_AUTH_EXTERNAL_*`
values in `supabase/.env` are no longer read; put the ids in `supabase/functions/.env` instead
(`GOOGLE_CLIENT_IDS`, `APPLE_BUNDLE_ID`, …) and restart `npx supabase functions serve`.
`npm run doctor` flags a value left only in `supabase/.env` as "moved: copy it to
supabase/functions/.env". Then follow
"Switching branches" above. To try Apple inside Expo Go, set `APPLE_BUNDLE_ID=host.exp.Exponent`
there — local only, never on the hosted project.

### Signing in locally (sign-in v3)

How sign-in works is in `docs/sign-in-spec.md`; how it's built on Supabase is in
`docs/sign-in-supabase-mapping.md`. Email accounts use a password (15–128 characters). There are
nothing emailed can sign anyone in: the only codes are the "confirm your email" code
(0b-4) and the new-device check (0b-5h).

**Quickest:** `npx supabase db reset` creates a confirmed local password account:

- email **`admin@example.test`**, password **`lifeos-local-admin-2026`**
- in development builds (`__DEV__` only) you can type just **`admin`** as the email.

It has health data on, targets and a few plan meals, so you land on Today. It exists only in your
local database — the seed never runs on the hosted project, and this password must never be used
there. Its hash uses the documented local pepper `local-dev-pepper-NOT-A-SECRET`
(`AUTH_PASSWORD_PEPPER_V1` in `supabase/functions/.env.example`); the hosted project needs its own
random pepper.

**On a phone** (Expo Go or a dev build), `127.0.0.1` means the phone itself — see "Run it on your
phone" above. In `apps/mobile/.env.local`, use your Mac's Wi-Fi address (`ipconfig getifaddr en0`):

```
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.128:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the "Publishable" key from `npx supabase status`>
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
(`supabase/functions/.env` locally, `npx supabase secrets set` on the hosted project) and the public
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

iOS uses the native Apple sheet (`expo-apple-authentication`). It works in Expo Go with
`APPLE_BUNDLE_ID=host.exp.Exponent` (local only); a development or store build uses your own
bundle id. Google on iPhone needs a development build (see "Run it on your phone").

**Sign in with Google:**

1. Google Cloud Console → OAuth consent screen (External; scopes `email`, `profile`, `openid`).
2. Create a **Web** client (for the web app) and an **iOS** client (bundle id from `app.json`).
3. Set `GOOGLE_CLIENT_IDS=<web id>,<ios id>` for `auth-api`, and
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in the app (public ids).
   `app.config.ts` adds the iOS redirect scheme.

On iPhone Google opens in `ASWebAuthenticationSession` (code + PKCE + nonce); on web it uses
Google Identity Services with a nonce. Android sign-in screens are a follow-up (decision 9).

**Apple and Google on the web** need more than the phone does, so a local web build
(`npm run mobile -- --web` on `http://localhost:8081`) usually can't offer them:

- **Apple** needs an Apple **Services ID** (`EXPO_PUBLIC_APPLE_SERVICES_ID` in the app,
  `APPLE_SERVICES_ID` for `auth-api`) and an **HTTPS** return address registered with that
  Services ID (`EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI`). Apple never accepts `http://` or
  `localhost` return addresses.
- **Google** needs a Google **web** client id (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, also listed in
  `GOOGLE_CLIENT_IDS`) with your web origin added under "Authorised JavaScript origins".

Without them, a development web build shows a note on the method screen ("Apple sign-in on the
web needs an Apple Services ID and an HTTPS address — see README") instead of ending on 0b-8g;
email + password works as usual. A release build keeps 0b-8g. Web Apple/Google with real ids on
an HTTPS address is part of the web hosting work (Q-HOSTING, phase 7).

### Run the backend locally

`start` runs Postgres, Auth, Storage and the edge runtime in Docker; `db reset` applies the
migrations, `seed.sql` and the fake breach fixture; `functions serve` runs `auth-api` and
`food-lookup`.

```bash
npx supabase start
npx supabase db reset
npx supabase functions serve --env-file supabase/functions/.env
```

`npx supabase start` prints the API URL and anon key — put them in `apps/mobile/.env.local` as
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

**Without Docker** (what the integration and end-to-end tests use): `npm run local-auth` downloads
pinned, checksum-checked Supabase Auth (GoTrue), PostgREST, Deno and Mailpit binaries, starts them
against a local Postgres 16 with pg_cron and pgTAP, applies the migrations, runs `auth-api` and
`food-lookup` in Deno with `supabase/functions/.env.example`, puts a Kong-like gateway on `:54321`
and writes `.local-auth/env` (git-ignored, local-only keys). Then:

- `npm run test:integration` — the linking gate and every sign-in flow (auth-api in Node);
- `npm run test:e2e` — acts like the phone: the app's own sign-in and data code through the gateway,
  with several phones (each its own device): sign up → code from Mailpit → onboarding → log meal →
  water; Apple and Google; wrong method; forgot password; new-device code; signed-in devices;
  change password; delete and keep; export; consent off; an unknown barcode; save to roster only;
  batches (server per-100 g = core, tampering refused, log by the gram, as a component, cook
  again, stars, another user and consent off); custom times, editing and deleting logged meals,
  and g or ml (server time window, crafted edits refused, a plan meal back as not eaten, a barcode
  drink per 100 ml, another user and consent off); yesterday's timeline, a corrected copy
  (atomic, plan link kept, tampered macros refused), log again, "Ate it" at the usual time, custom
  water logged and deleted, another user and consent off. What each sign-off criterion rests on is in
  `docs/PHASE2-SIGNOFF.md`.

The stack also starts local fakes (`scripts/local-auth/fakes.mjs`): a fake Apple and Google (keys
made on each start; `auth-api` here trusts only them) and an Open Food Facts that knows one
made-up 330 ml drink (`0000000000962`, nutrition per 100 ml) and no other barcodes. `LOCAL_FAKES=off npm run local-auth` leaves them out (Apple and Google are then off).
Against `npx supabase start` instead: `E2E_API_URL=http://127.0.0.1:54321 E2E_ANON_KEY=<publishable key>
E2E_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:e2e`.

`LOCAL_AUTH_HOOKS=off npm run local-auth` starts it the way an old `config.toml` would (no Auth
hooks), to see `npm run doctor` and `auth-api` fail loudly. `bash scripts/local-auth/stop.sh` stops it.

When creating the hosted project, choose a **UK/EU region (London, `eu-west-2`)** — the Privacy Policy promises UK/EU storage.

### Barcode scanning

Scanning (Log meal → Scan) uses `expo-camera` and the `food-lookup` edge function. Locally run
`npx supabase functions serve food-lookup` alongside `npx supabase start`. The camera needs a real
device or the web app in a browser with a webcam (the iOS simulator has no camera) — every
platform also has "Or type the barcode". Seed barcodes are fake (`0000000000017`, …), so try
a real product to exercise Open Food Facts. Expo Go includes `expo-camera`; Apple sign-in
still needs a development build.

### Saved meals and batches

Log meal has two tabs: **Plan & recent** (the roster, as before) and **Saved** (saved meals and
batches together, starred first, then A–Z). "Save to roster only" on 7b saves a meal without
logging it. **+ Cooked a batch** builds one pot from its ingredients; the batch becomes your own
food with per-100 g = ingredient totals ÷ cooked weight, logged by the gram (liquids: 1 ml = 1 g)
or used as a component. The cooked weight is estimated from a small table of dry→cooked ratios
(`packages/core/src/batch.ts`) unless you weigh it. Tap a batch on Saved to cook it again;
meals already logged keep their numbers. Batches are saved only through the `save_batch` Postgres
function, which recomputes the per-100 g values and refuses any mismatch.

### Times, editing logged meals, g or ml

**Other time…** on Log meal opens a time picker (Yesterday / Today, looping 24-hour wheels): any time from
yesterday 00:00 up to an hour from now, checked by `log_meal` too. The meal counts towards its
Europe/London day. Tap a logged meal on Today to open it: **Edit meal** changes the name, the time
and each item's g / ml label only (amounts are locked; to change them, delete and log again), and
**Delete meal** takes it off its day (a plan meal shows as not eaten again). Edits and deletes go
only through the `update_logged_meal` and `delete_logged_meal` Postgres functions, which refuse
anything else. Each food is per 100 g or per 100 ml (from Open Food Facts, or chosen on manual
entry); "how much" has a g / ml switch and 1 ml counts as 1 g.

### Yesterday, log again, corrected copies, water

**‹ Yesterday** on Today shows yesterday's meals and totals; yesterday's meals open and edit like
today's. On a logged meal, **Log again** logs the same amounts as a new meal (now, or **Other
time…**), and **Log a corrected copy** opens Build meal pre-filled so you can change amounts: Done
logs the new meal and deletes the old one in one step (`replace_logged_meal`), keeping its plan
link. **Ate it** logs a plan meal at its usual time if that has passed. After **Delete meal**,
Today shows **Meal deleted · Undo** for about five seconds before the meal is really deleted. On
Health, **Other amount…** adds any whole number of ml from 1 to 5,000, and tapping the water total
lists today's water with a delete for each entry.

### Build meal: the time at any point, the meal kept

The time a meal was eaten belongs to the meal: on Build meal it's the chip at the top right, and
tapping it offers Now, the four slots (later ones greyed) and **Other time…**, as many times as you
like before **Done**, without touching the components. Going back to Log meal keeps the meal you
were building: Log meal shows it as **Not logged yet** with **Continue**, and anything that would
start another meal asks before discarding it. Logging it, **Save to roster only**, **Discard** or
closing Log meal clears it; it is kept in memory only, never across app restarts.

### Run the app

`expo start`; press `i` for the iOS simulator.

```bash
npm run mobile
```

## Scripts (from the repo root)

| Command                                | What it does                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                         | ESLint across the repo                                                                                                                                                       |
| `npm run format`                       | Prettier write (`format:check` to verify)                                                                                                                                    |
| `npm run typecheck`                    | `tsc -b` for core + edge functions, `tsc --noEmit` for the app                                                                                                               |
| `npm test`                             | core (Vitest) + edge functions (Vitest) + scripts (Vitest) + mobile (jest-expo)                                                                                              |
| `npm run test:core`                    | core unit tests only                                                                                                                                                         |
| `npm run test:functions`               | edge function mapping/handler tests                                                                                                                                          |
| `npm run test:mobile`                  | app screen and flow tests (jest-expo)                                                                                                                                        |
| `npm run test:db`                      | database RLS tests (see below)                                                                                                                                               |
| `npm run local-auth`                   | start the Docker-free local stack (Postgres, Auth, PostgREST, edge functions, Mailpit, gateway)                                                                              |
| `npm run test:integration`             | sign-in integration tests against that real Supabase Auth                                                                                                                    |
| `npm run test:e2e`                     | phone-like end-to-end test of Phase 2 on the running local stack                                                                                                             |
| `npm run doctor`                       | checks the local setup for running on a phone (`-- --simulator` for 127.0.0.1)                                                                                               |
| `npm run gen:types -w @life-os/mobile` | regenerate `apps/mobile/src/lib/database.types.ts` (needs `npx supabase start`; without Docker: `npx supabase gen types typescript --db-url <postgres url> --schema public`) |

### Database tests

`supabase/tests/*.test.sql` are pgTAP tests proving owner-only access, the global food cache rules, health-data consent, logging and batches (`save_batch` recomputes and refuses mismatches), the log time window and editing or deleting logged meals (amounts locked, owner and consent only) and the sign-in tables, hooks, guards and deletion job.

- With Docker: `npx supabase start`, then `npx supabase test db`
- Without Docker: point `DATABASE_URL` at an empty Postgres 15+ database with pgTAP installed and run `npm run test:db`. It loads `scripts/db/supabase-shim.sql` (roles, `auth.users`, `auth.uid()`), applies the migrations, then runs every test file. CI uses this path.

## Licences

Food data from Open Food Facts, available under the [Open Database Licence (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
