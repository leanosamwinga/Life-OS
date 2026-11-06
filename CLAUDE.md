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
- Backend: Supabase — Postgres, Auth (email + Sign in with Apple), Storage, Edge Functions (Deno), scheduled jobs. **RLS on every user table.**
- Shared logic: `packages/core` (pure TS, no I/O). App and edge functions import the same types and maths. Relative imports inside core use explicit `.ts` extensions so Deno can load it directly.
- Apple Health: a maintained Expo-compatible HealthKit module, added in phase 3.

## Repo layout

```
apps/mobile            Expo app (src/app routes, src/components, src/features, src/lib, src/data)
packages/core          types.ts, nutrition.ts, format.ts, time.ts, training.ts, defaults.ts (+ *.test.ts)
supabase/config.toml   local stack config
supabase/migrations    timestamped SQL migrations
supabase/functions     edge functions (food-lookup); pure logic in handler.ts/mapping.ts, Deno wiring in index.ts
supabase/tests         pgTAP tests (*.test.sql)
supabase/seed.sql      fake local seed data
scripts/test-db.sh     runs supabase/tests on plain Postgres via scripts/db/supabase-shim.sql
```

## Commands

```bash
npm install
npm run lint && npm run typecheck && npm test   # what CI runs
npm run test:db                                 # DATABASE_URL=… (plain Postgres + pgTAP) or Supabase CLI + Docker
npm run mobile                                  # expo start
supabase start && supabase db reset             # local backend
npx deno check --config supabase/functions/food-lookup/deno.json supabase/functions/food-lookup/index.ts
```

## Domain rules

- **Nutrition**: foods store values **per 100 g** (kcal, protein, carbs, fat; optional fibre/sugar/salt). Portion = grams × per-100g ÷ 100, rounded to **whole kcal** and **1 dp macros** (`portionMacros`). A meal is a list of components (food + grams). A logged meal **snapshots** each component's macros at log time (`snapshotComponents`, `meal_log_items`) so food edits never rewrite history. Suggestions use the amount the user had **last time** (`food_portions_last`). Saved meals form the **roster**; plan meals are saved meals with `in_daily_plan = true` and a `usual_time`.
- Missing nutrition is `null`, never invented. A food with unknown kcal/macros is a `FoodRecord`, not a loggable `Food` (`toFood` returns null) — the user completes it (wireframe 7e).
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
- UI: greyscale tokens in `apps/mobile/src/theme.ts`, system font, ≥44 pt touch targets, accessibility role + label on every control.
- **No secrets in the repo.** Only `*.env.example` files are tracked. `EXPO_PUBLIC_*` values ship in the app bundle — only the anon key goes there. The service role key lives only in the edge runtime.
- Sample/seed/test data must be obviously fake (example.test emails, 000… barcodes, generic names) — never real personal data.
- Workflow: branch from `main` (`claude/<topic>`), small logical commits, push the branch, open a PR. **Never push to or merge into `main`.** Run lint, typecheck and all tests before opening a PR; list anything that couldn't run.

## Phase plan

1. **Foundations** (done): monorepo, core maths, schema + RLS, food-lookup function, app shell.
2. **Log meal flow** (wireframes 7a–7e): roster or new, build meal from components, scan barcode → food-lookup, "how much" with last-time amount, manual entry; "Ate it" from plan; water quick add; auth (email + Sign in with Apple) and health-consent onboarding.
3. **Health**: Apple Health (steps, sleep, weight), supplements, Strava workouts + split rotation, "Log workout in Liftoff" deep link.
4. **Week**: device calendars, weekly rhythm, Notion church card with "remind me to chase".
5. **Money**: monthly CSV import (Starling, NatWest, Amex), categories, budgets, 3-month-average forecast, bill detection, Trading 212 S&S ISA daily sync via read-only API key, manual monthly balances for T212 Cash ISA and Hargreaves Lansdown LISA.
6. **Nudges** + morning briefing / evening check-in screens.
7. **Privacy**: export/delete, legal screens, Face ID lock, TestFlight.

Do not build beyond the current phase.
