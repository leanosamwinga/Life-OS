# CLAUDE.md — Life OS

Read this first in every session. It is the source of truth for product decisions, conventions and the phase plan.

## Product (decided — do not revisit)

- One calm, minimal, Apple-like place for health, money, plans, extracurriculars and reflection. iOS first, then web, then Android.
- Built for the owner first but must work for **any user**: nothing hard-coded to one person (names, accounts, routines come from data/settings).
- **UK only**: £, metric (kg, g, ml), Europe/London time, dates like "Fri 6 Nov", 24-hour times.
- Visual spec: "Life OS — Low-fi Wireframes v1" (Claude project files / https://claude.ai/artifact/5yoW1ZurwttPHeUa1qUNPE). Screens: 1B Today (chosen; 1A not chosen), 2 Health, 3 Week, 4 Money, 5 Morning briefing, 6 Evening check-in, Me, 7a–7e Log meal flow. Match layout, hierarchy and copy. They are greyscale on purpose — no colour or branding until decided.
  - Home = **1B Today — timeline**: rings (kcal, water, steps, sleep), timeline of meals and events with a "Now" line, an "Elsewhere" card, floating "+ Log meal".
  - Tab bar: **Today, Health, Week, Money, Me**. Morning briefing and evening check-in open from notifications, not tabs.
- Legal: Privacy Policy (https://claude.ai/artifact/X1bcQ8p598TE7ud5j5svqs) and Terms (https://claude.ai/artifact/QdA3u8qenBH7LLzBEuiRNK) drafts. The app must behave as they say:
  - no ads, never sell data, never use health data for marketing, no AI training on user data;
  - **health data only with explicit consent** (UK GDPR Art. 9(2)(a)); withdrawing stops processing and the rest of the app keeps working;
  - export (CSV + JSON) and delete account available in Me;
  - data stored in a **UK/EU region** (Supabase project in London, `eu-west-2`);
  - Open Food Facts credit shown: "Food data from Open Food Facts (ODbL)".

## Stack

- App: Expo SDK 58 + TypeScript (strict) + Expo Router (routes in `apps/mobile/src/app`). JS tabs from `expo-router/js-tabs`. Read `apps/mobile/AGENTS.md` — Expo changes every SDK; check versioned docs, use `npx expo install`.
- Backend: Supabase — Postgres, Auth, Storage, Edge Functions (Deno), scheduled jobs (pg_cron). **RLS on every user table.** Sign-in is **sign-in v3** (`docs/sign-in-spec.md`, built as described in `docs/sign-in-supabase-mapping.md`): Supabase Auth issues and stores sessions and password hashes, but every sign-in goes through the `auth-api` edge function — email + password (15–128 characters), Sign in with Apple and Google, one method per email, never linked automatically. On web the tokens live in httpOnly cookies behind Expo Router API routes (`apps/mobile/src/app/api`, `src/server/bff.ts`).
- Shared logic: `packages/core` (pure TS, no I/O). App and edge functions import the same types and maths. Relative imports inside core use explicit `.ts` extensions so Deno can load it directly.
- Apple Health: a maintained Expo-compatible HealthKit module, added in phase 3.

## Repo layout

```
apps/mobile            Expo app (src/app routes, src/components, src/features, src/lib, src/data)
                       src/lib/backend: Backend interface + Supabase implementation; src/test: in-memory fake
packages/core          types.ts, nutrition.ts, format.ts, time.ts, training.ts, defaults.ts (+ *.test.ts)
supabase/config.toml   local stack config
supabase/migrations    timestamped SQL migrations
supabase/functions     edge functions (food-lookup, auth-api); pure logic in handler.ts/service.ts etc., Deno wiring in index.ts;
                       auth-api/test/*.integration.test.ts run against a real Supabase Auth
supabase/tests         pgTAP tests (*.test.sql)
supabase/seed.sql      fake local seed data
scripts/test-db.sh     runs supabase/tests on plain Postgres via scripts/db/supabase-shim.sql
scripts/local-auth     Docker-free local stack: Postgres 16, Supabase Auth, PostgREST, edge functions in Deno, Mailpit,
                       and a Kong-like gateway on :54321 (pinned, checksum-checked binaries)
scripts/doctor         `npm run doctor`: checks the local setup for running on a phone
e2e                    phone-like end-to-end test (the app's own AuthClient + backend in Node) on the real stack
docs                   sign-in spec, decisions, Supabase mapping, SPEC-QUESTIONS, TEST-REPORT, PRIVACY-POLICY-CHANGES
```

## Commands

```bash
npm install
npm run lint && npm run typecheck && npm test   # what CI runs
npm run test:db                                 # DATABASE_URL=… (plain Postgres + pgTAP) or Supabase CLI + Docker
npm run mobile                                  # expo start
supabase start && supabase db reset             # local backend
npm run local-auth && npm run test:integration   # sign-in tests against a real Supabase Auth (no Docker)
npm run local-auth && npm run test:e2e           # phone-like end-to-end test of Phase 2 on the real stack
npm run doctor                                  # local setup check before running on a phone
npx deno check --config supabase/functions/food-lookup/deno.json supabase/functions/food-lookup/index.ts
npx deno check --config supabase/functions/auth-api/deno.json supabase/functions/auth-api/index.ts
```

## Domain rules

- **Screen Time** data can never be read, stored or synced. Apple draws the card on-device (DeviceActivityReport extension); Life OS stores only the user's choice to show it (`user_settings.screen_time_choice`). Never add tables, columns, logs or analytics for Screen Time values.
- **Sign-in & onboarding** (sign-in v3 — `docs/sign-in-spec.md` is the source of truth; `docs/sign-in-decisions.md` is fixed):
  - Methods: email + password, Apple, Google. **One method per email; never link methods automatically**, even when emails match. Supabase Auth's own sign-up and Apple/Google providers stay **off**; `auth-api` verifies ID tokens itself (proper single-use nonce, never `skip_nonce_check`) and keeps identities in `auth_federated_identities`. Apple is always offered wherever Google is.
  - **Nothing emailed can sign anyone in.** Email sign-in is always email + password. The only emailed codes are "confirm your email" (0b-4) and the new-device check (0b-5h); the only emailed link is the password reset link, which never signs anyone in.
  - Passwords: 15–128 characters (NFKC code points), not breached (own k-anonymity SHA-1 check, `auth_breached_hashes`), not containing the email. Peppered before Supabase Auth's bcrypt. The rules live in `packages/core/src/auth.ts` for both app and server.
  - Sessions: issued only after `auth-api`'s checks (permit-gated hooks). Access 10 minutes; refresh rotates and any reuse revokes; phone 30/90 days, web 7/30. Tokens: iPhone Keychain (SecureStore, this device only), web httpOnly cookies — browser JS never sees a token. `public.check_request` refuses Data API calls from ended sessions and the `PENDING_DELETION` scope. The app handles those answers in one place (`src/lib/backend/sessionFetch.ts`, spec 3.3): an ended session is forgotten → 0a with no message; `PENDING_DELETION` re-checks with auth-api → S-5h; "Couldn't load your data" is only for network/server errors. `auth-api` refuses any token without `lifeos_scope` (Auth hooks not running).
  - All auth email goes through `EmailSender` (Mailpit locally); Supabase Auth sends none. Device checks: App Attest (iPhone) and Turnstile (web) behind one `DeviceCheck` interface, `AUTH_DEVICE_CHECKS` / `EXPO_PUBLIC_DEVICE_CHECKS` flag, on in production.
  - Me → Security: change password, signed-in devices, delete account (30-day grace; the day-30 pg_cron job erases data, revokes the Apple token and sends the "deleted" email) and export (CSV + JSON).
  - The seeded `admin@example.test` account (password in the README) and the bare-`admin` shortcut (`__DEV__` only) are local development only.
  - First run: 0c health-data consent → 0d Apple Health → 0e Screen Time → 0f nudges → 0g name & targets; web and Android skip 0d and 0e, and "Not now" on consent skips 0d. `user_settings.onboarding_completed_at` gates the app.

- **Nutrition**: foods store values **per 100 g** (kcal, protein, carbs, fat; optional fibre/sugar/salt). Portion = grams × per-100g ÷ 100, rounded to **whole kcal** and **1 dp macros** (`portionMacros`). A meal is a list of components (food + grams). A logged meal **snapshots** each component's macros at log time (`snapshotComponents`, `meal_log_items`) so food edits never rewrite history. Suggestions use the amount the user had **last time** (`food_portions_last`). Meals are logged only through the `log_meal` Postgres function (atomic, SECURITY INVOKER so RLS applies): the client sends core-computed macros and the server recomputes them from the food's per-100 g values and rejects any mismatch. Roster meals are saved through `save_meal`. Saved meals form the **roster**; plan meals are saved meals with `in_daily_plan = true` and a `usual_time`.
- Missing nutrition is `null`, never invented. Pack/serving sizes (`foods.pack_g`, `serving_g`) are grams only — a product sold in ml gets `null`, not a guess. A user's own food for a barcode (one per user, `foods_user_barcode_key`) wins over the global cache; `remembered = false` keeps it out of search and suggestions. A food with unknown kcal/macros is a `FoodRecord`, not a loggable `Food` (`toFood` returns null) — the user completes it (wireframe 7e).
- **Daily targets**: kcal, protein, carbs, fat, water (ml), steps. Today's progress = sum of logs for the **Europe/London local day** (`dayProgress`).
- **Money**: integer **pence** (`bigint` in Postgres, `MoneyAmount` in TS) — never floats. Balances can be negative (credit cards). Display with `formatPence` → "£1,234.56" / "−£628.40" (U+2212 minus).
- **Training**: the split is a rotation (e.g. Day 1 Arms & shoulders, Day 2 Chest & triceps, Day 3 Legs, Day 4 Back; target 4/week). Each new synced workout advances it; the user can correct it (`nextSplitDay(rotation, completedCount)`). **Sets/reps stay in Liftoff — never model them.**
- **Nudges**: quiet by default, individually toggleable — morning briefing 07:30 weekdays / 08:30 weekends (on), evening check-in 21:30 (on), event reminders (off), urgent bill alerts (on), monthly statement import reminder 1st at 09:00 (on), quiet hours 22:30–07:00 (`DEFAULT_NUDGE_SETTINGS`, `user_settings` defaults).

## Conventions

- **RLS everywhere**: every user table has `user_id`, RLS enabled, owner-only policies via `(select auth.uid())`. Child tables carry `user_id` and use composite FKs `(parent_id, user_id)` so rows can't attach to someone else's parent.
- **Health tables** (nutrition logs, saved meals, last portions, water, supplements) also require `public.has_active_consent('health_data')` in their policies. New health tables must do the same.
- Global Open Food Facts cache rows have `user_id IS NULL`: readable by `authenticated`, writable only by the service role (edge functions).
- New tables: add `created_at`/`updated_at` + the `set_updated_at` trigger, revoke from `anon`, grant to `authenticated`, enable RLS, write pgTAP tests proving cross-user isolation. Supabase's default privileges grant new tables to `anon` — revoke explicitly in each migration.
- Never edit an applied migration; add a new timestamped one. Regenerate `apps/mobile/src/lib/database.types.ts` after schema changes.
- Timestamps are `timestamptz` (UTC); convert to Europe/London only for display/day boundaries (`toLondonDate`, `formatDateUK`, `formatTimeUK`).
- Screens talk to Supabase only through `Backend` (`src/lib/backend`) via `useSession()`/`useBackend()`, so jest tests run against `src/test/memoryBackend.ts`. Without Supabase env the app is "Not connected" and shows sample data.
- UI: greyscale tokens in `apps/mobile/src/theme.ts`, system font, ≥44 pt touch targets, accessibility role + label on every control.
- **No secrets in the repo.** Only `*.env.example` files are tracked. `EXPO_PUBLIC_*` values ship in the app bundle — only the anon key goes there. The service role key lives only in the edge runtime.
- Sample/seed/test data must be obviously fake (example.test emails, 000… barcodes, generic names) — never real personal data.
- After switching branches: `supabase stop && supabase start && supabase db reset` (config.toml is only read at start), then `npm run doctor`.
- Workflow: branch from `main` (`claude/<topic>`), small logical commits, push the branch, open a PR. **Never push to or merge into `main`.** Run lint, typecheck and all tests before opening a PR; list anything that couldn't run.

## Phase plan

1. **Foundations** (done): monorepo, core maths, schema + RLS, food-lookup function, app shell.
2. **Sign-in, onboarding and log meal flow**: sign-in v3 (`docs/sign-in-spec.md`: email + password, Apple, Google; wireframes v3 0a–0b-8i and Me → Security S-1–S-5; iPhone and web, Android screens later) and first-run onboarding (wireframes 0c–0g; HealthKit and Screen Time steps record the choice only); wireframes 7a–7e: roster or new, build meal from components, scan barcode → food-lookup, "how much" with last-time amount, manual entry; "Ate it" from plan; water quick add; Today and Health on real data.
3. **Health**: Apple Health (steps, sleep, weight), supplements, Strava workouts + split rotation, "Log workout in Liftoff" deep link; Screen Time card (display-only, via the DeviceActivityReport extension; needs the Family Controls distribution entitlement).
4. **Week**: device calendars, weekly rhythm, Notion church card with "remind me to chase".
5. **Money**: monthly CSV import (Starling, NatWest, Amex), categories, budgets, 3-month-average forecast, bill detection, Trading 212 S&S ISA daily sync via read-only API key, manual monthly balances for T212 Cash ISA and Hargreaves Lansdown LISA.
6. **Nudges** + morning briefing / evening check-in screens.
7. **Privacy**: export/delete, legal screens, Face ID lock, TestFlight.

Do not build beyond the current phase.
