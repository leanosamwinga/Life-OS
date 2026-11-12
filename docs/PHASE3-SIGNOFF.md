# Phase 3 sign-off · Health

Branch `claude/phase-3-health`. Built from the Phase 3 build prompt, the decisions doc
(`health-phase-3-decisions.md`, Mon 9 Nov 2026, wireframe picks Thu 12 Nov 2026) and the canvas
"Life OS — Phase 3 Health wireframes" (1B, training option 1, 3a–3c, 4A, 5, 6B + Nutrition, 7,
8a–8b). Decisions the build had to take are in `docs/SPEC-QUESTIONS.md` (Phase 3 · H-…).

Each criterion is one of:

- ✅ **automated** — a test proves it; the test is named (file › test name).
- 📱 **manual on your phone** — needs a real iPhone with a development build. The tests that back
  it are listed; the steps are in the [checklist](#checklist-on-your-iphone) at the end.
- ⏭ **deferred** — moved to a named later phase.

Where the tests live:

| Short name | What                                                          | Runs with                   |
| ---------- | ------------------------------------------------------------- | --------------------------- |
| `jest`     | `apps/mobile/src/__tests__/health-phase3.test.tsx` (and more) | `npm run test:mobile` (CI)  |
| `core`     | `packages/core/src/health.test.ts`                            | `npm run test:core` (CI)    |
| `parse`    | `apps/mobile/src/features/targets/parse.test.ts`              | `npm run test:mobile` (CI)  |
| `pgTAP`    | `supabase/tests/11_health_phase_3.test.sql`                   | `npm run test:db`           |
| `doctor`   | `scripts/doctor/checks.test.mjs`                              | `npm run test:scripts` (CI) |

## A · Health tab

| ID  | Criterion                                                                                                  | Status | Proof                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Day / Week / Month                                                                                         | ✅     | `jest` › A "renders Body, Intake and Training from the memory backend"; G "Week: averages against targets…", "Month: lighter cards…"                                                       |
| A2  | Day (1B): Body (Weight, Sleep \| Steps), Intake (Nutrition, Water, Supplements), Training                  | ✅     | `jest` › A "renders Body, Intake and Training from the memory backend"                                                                                                                     |
| A3  | Weight: current kg, change this week, 14-day line against a dashed target                                  | ✅     | `jest` › A (label "Weight 82.4 kg, −0.6 kg this week", "Weight over the last 14 days, target 80.0 kg"); `core` › weight "change this week compares with the latest reading a week earlier" |
| A4  | Sleep: duration, "23:48–07:00", 7-day average; Steps: "6,240 of 10,000"                                    | ✅     | `jest` › A (7h 12m, 23:48–07:00, 7-day avg 6h 53m, 6,240, of 10,000)                                                                                                                       |
| A5  | Nutrition keeps plan vs eaten (kcal ring, macro bars, meal rows, "+ Log meal")                             | ✅     | `jest` › A; existing `jest` log-meal › "Health "+ 250 ml" saves water" (meal rows, planned and eaten)                                                                                      |
| A6  | Water exactly as before: "+ 250 ml", "Other amount…", tap the total for today's water                      | ✅     | existing `jest` follow-ups › G "Water on Health" (all five tests unchanged and passing)                                                                                                    |
| A7  | Every control ≥ 44 pt with a role and label; 24-hour times, dates like "Thu 12 Nov", metric, sentence case | ✅     | `jest` › A "every control has a role and label and is at least 44 pt"; A ("Thu 12 Nov", "23:48–07:00")                                                                                     |
| A8  | Greyscale only                                                                                             | ✅     | Only `theme.ts` greys and two literal greys from the wireframes (#ECECEC, #F3F3F3) are used.                                                                                               |
| A9  | Health data off: nothing loaded or shown                                                                   | ✅     | `jest` › A "consent off: no health data is loaded or shown"                                                                                                                                |

## B · Weight card states (3a–3c) and empty states (8a–8b)

| ID  | Criterion                                                                                                   | Status | Proof                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| B1  | 3a data                                                                                                     | ✅     | `jest` › B "3a: data shows the current weight"                                                                              |
| B2  | 3b "No weight yet. Add a weight in the Apple Health app and it will appear here." — instructions, no button | ✅     | `jest` › B "3b: connected without data says where to add it (no button)"                                                    |
| B3  | 3c only when we know access isn't granted ("Not now", never connected, never asked)                         | ✅     | `jest` › B "3c: "Not now" on 0d…", "3c: also when HealthKit says the request was never made", "synced data wins over "off"" |
| B4  | 8a no-data states laid out like 1B                                                                          | ✅     | `jest` › C "8a: connected, no data: dashed rings and no-data copy, no banner"                                               |
| B5  | 8b one dismissible banner ("Apple Health access is off", "Open Settings ↗", "Dismiss") + per-card messages  | ✅     | `jest` › C "8b: one banner with Open Settings and Dismiss, plus per-card messages"                                          |
| B6  | The dismissal is remembered on the device                                                                   | ✅     | `jest` › C "8b: a dismissed banner stays dismissed on this device"                                                          |
| B7  | Open Settings works before and after iOS has asked                                                          | ✅ 📱  | `jest` › C "Open Settings before iOS has ever asked…", "Open Settings after iOS has asked…". Checklist step 4.              |
| B8  | HealthKit's unknowable "denied" is written down                                                             | ✅     | `docs/SPEC-QUESTIONS.md` › H-ACCESS                                                                                         |

## C · Apple Health (iPhone only)

| ID  | Criterion                                                                                         | Status | Proof                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Maintained, Expo-compatible module with a config plugin, added with `npx expo install`; read only | ✅     | `apps/mobile/package.json`, `app.json` plugin (`NSHealthUpdateUsageDescription: false`, `background: false`); `npx expo config --type introspect` shows only the share string |
| C2  | Step count, sleep analysis and body mass only, with a clear usage string                          | ✅     | `src/lib/health/healthkit.ts` (`READ`); `pgTAP` › "only weight, sleep and steps are stored"                                                                                   |
| C3  | Needs a development build: README and doctor say so                                               | ✅     | README › "Health: Apple Health, supplements and training"; `doctor` › "says Apple Health needs a development build, as a note and never a failure"                            |
| C4  | 0d and a Me entry make the real request; `apple_health_choice` records it                         | ✅ 📱  | `jest` auth-onboarding › "iPhone: consent → Apple Health → …" (records "connect"); `jest` › C "Open Settings before iOS has ever asked…". Checklist steps 2–3.                |
| C5  | Never asked or read without the health-data consent; withdrawing stops reading and syncing        | ✅     | `jest` › D "never reads without health-data consent", "never reads when the user said "Not now"", "withdrawing consent in Me stops syncing and cancels supplement reminders"  |
| C6  | Sync on open and on return to the foreground; last 35 London days; upsert                         | ✅ 📱  | `jest` › D "on open: reads the last 35 London days and upserts them", "on return to the foreground: syncs again"; `pgTAP` › "a re-sync upserts". Checklist step 5.            |
| C7  | Steps summed; sleep for the night ending that morning with start/end; latest weight each day      | ✅ 📱  | `core` › sleep attribution (all), weight "one reading per London day: the latest"; HealthKit queries in `healthkit.ts`. Checklist step 5 compares with the Health app.        |
| C8  | The reading sits behind an interface; jest uses a fake                                            | ✅     | `HealthReader` (`src/lib/health/reader.ts`); `src/test/fakeHealth.ts`; `jest.setup.ts`                                                                                        |
| C9  | Web and Android show what the iPhone synced                                                       | ✅     | `jest` › C "web: shows what the iPhone synced…", "android: …", "web without synced data: Connect Apple Health on your iPhone"                                                 |

## D · Supplements

| ID  | Criterion                                                                                                    | Status | Proof                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Chips grouped Morning / Evening; tap to mark taken today, tap again to undo                                  | ✅     | `jest` › E "ticks and unticks today"                                                                                                                    |
| D2  | At most one log per supplement per London day                                                                | ✅     | `pgTAP` › "a second log on the same London day is refused", "ticking again is a no-op…", "after midnight London time counts towards the next day (BST)" |
| D3  | Editor (7): name, dose, Morning/Evening, reminder switch + 24-hour time, "Delete {name}", "+ Add supplement" | ✅     | `jest` › I "add, edit, delete and reminders, saved with Done"                                                                                           |
| D4  | Reminders: local notifications, rescheduled when the list changes, cancelled when consent is withdrawn       | ✅ 📱  | `jest` › I (both tests); D "withdrawing consent in Me … cancels supplement reminders". Checklist step 7.                                                |

## E · Training (manual)

| ID  | Criterion                                                                               | Status | Proof                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | "Today: Legs?" with Done and Change above a Mon–Sun strip                               | ✅     | `jest` › A; F "Done marks today with the suggested split day"                                                                                                                                                            |
| E2  | Change picks another split day; the rotation continues from it                          | ✅     | `jest` › F "Change picks another split day…"; `core` › split suggestion "Change: the rotation continues from the day picked"                                                                                             |
| E3  | Tapping a day marks it trained or untrained; the split name shows under trained days    | ✅     | `jest` › F "tapping a day untrains or trains it; future days are disabled", "Done marks…" (label "Thursday, today, trained, Legs")                                                                                       |
| E4  | `training_days`: one row per London date, name snapshot, twice = no-op, untrain deletes | ✅     | `pgTAP` › "the split name is a snapshot", "marking the same day again is a no-op", "untraining deletes the row", "rows can't be changed", "no future days"; `jest` › F "marking the same day twice is a no-op (backend)" |
| E5  | Suggestion = `nextSplitDay(rotation, trained count since the cycle start)`              | ✅     | `core` › the split suggestion (all)                                                                                                                                                                                      |
| E6  | "Log workout in Liftoff ↗" opens Liftoff, falling back to the App Store                 | ✅ 📱  | `jest` › F "Log workout in Liftoff opens Liftoff, or the App Store without it". Checklist step 6 (scheme open: SPEC-QUESTIONS H-LIFTOFF).                                                                                |

## F · Week (4A) and Month (5)

| ID  | Criterion                                                                           | Status | Proof                                                                                                             |
| --- | ----------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| F1  | "‹ Previous" / "Next ›" period bar ("Mon 2 – Sun 8 Nov")                            | ✅     | `jest` › G "Week: Previous and Next move a week; Next stops at this week"; `core` › "labels match the wireframes" |
| F2  | Weight: average, change over the period, line with dashed target and Mon–Sun labels | ✅     | `jest` › G "Week: averages…" (−0.3 kg, Mon to Sun)                                                                |
| F3  | Period average vs target (kcal, macros, water, sleep, steps) and "n of 7 days"      | ✅     | `jest` › G "Week: averages…"; `core` › "averages skip days with no data", adherence (all)                         |
| F4  | Supplement and training adherence                                                   | ✅     | `jest` › G "Week: averages…" (All taken 2 of 4 days, Creatine 3 of 4, 2 of 4 sessions)                            |
| F5  | Month "October 2026": lighter, monthly averages, weight sparkline with the change   | ✅     | `jest` › G "Month: lighter cards with monthly averages and the change this month"                                 |
| F6  | London-day ranges (Mon–Sun, calendar month), including clock changes                | ✅     | `core` › London-day periods (all, incl. "the week of the clocks going back…")                                     |

## G · Me → Health targets (6B)

| ID  | Criterion                                                                                                    | Status | Proof                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| G1  | A menu of rows, each with its current value, opening its own edit screen with Save                           | ✅     | `jest` › H "the menu shows each target and Weight saves"                                                        |
| G2  | Weight target, calories/macros (+ plan name), water (daily amount only), sleep, steps, training (+ rotation) | ✅     | `jest` › H "Sleep, Nutrition, Water, Steps and Training save"; `parse` › "Health targets (6B)"                  |
| G3  | `parse.ts` reused and extended; `targets.tsx` still works for onboarding 0g                                  | ✅     | `parse` (all); existing `jest` follow-ups › B "from onboarding 0g: same header and intro; saving returns to 0g" |
| G4  | Me has the Health targets row                                                                                | ✅     | `jest` › H "Me has the Health targets row"; follow-ups › B "from Me: targets now live in Health targets (6B)…"  |

## H · Data

| ID  | Criterion                                                                                                   | Status | Proof                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| H1  | New timestamped migration; no applied migration edited                                                      | ✅     | `supabase/migrations/20261112090000_health_phase_3.sql`; `git diff main -- supabase/migrations` touches only that file            |
| H2  | `user_settings`: `target_weight_kg`, `target_sleep_min`, `training_per_week` (4), split rotation            | ✅     | `pgTAP` › "weight target", "sleep target", "split rotation", "training target defaults to 4 a week", "targets save", range checks |
| H3  | `supplements.reminder_time`                                                                                 | ✅     | `pgTAP` › "reminder time saved"                                                                                                   |
| H4  | RLS, owner only, `has_active_consent('health_data')`, nothing for anon, `created_at`/`updated_at` + trigger | ✅     | `pgTAP` › "RLS on …", "anon can't read …", isolation (5 tests), consent gate (3 tests); triggers in the migration                 |
| H5  | Composite FK for supplement logs                                                                            | ✅     | `pgTAP` › "can't log someone else's supplement (composite FK)"                                                                    |
| H6  | `health_daily` stores only weight, sleep (+ start/end) and steps                                            | ✅     | `pgTAP` › "only weight, sleep and steps are stored", "sleep needs its start and end", "steps are whole numbers"                   |
| H7  | `database.types.ts` regenerated                                                                             | ✅     | Updated to the migration in the generator's format (no Docker here for `supabase gen types`); `npm run typecheck` uses it         |
| H8  | Backend interface, Supabase implementation and memory backend extended; screens only talk to `Backend`      | ✅     | `src/lib/backend/types.ts`, `supabase.ts`, `src/test/memoryBackend.ts`; every Phase 3 jest test runs on the memory backend        |
| H9  | Export includes the new tables                                                                              | ✅     | `supabase/functions/auth-api/export.ts` (`training_days`, `health_daily`)                                                         |

## I · Not in Phase 3

| ID  | What                                                                   | Status | Where                                       |
| --- | ---------------------------------------------------------------------- | ------ | ------------------------------------------- |
| I1  | Strava / Liftoff sync; Screen Time card; manual weight; Health Connect | ⏭      | CLAUDE.md phase plan › 8 "Health, later"    |
| I2  | Screen Time onboarding step (0e) unchanged                             | ✅     | `jest` auth-onboarding (0e tests unchanged) |

## Checklist on your iPhone

1. Make the development build (README › Health) and start it with `npm run mobile -- --clear`.
2. New account: on 0d tap **Continue** — iOS's Health sheet lists Steps, Sleep and Weight, read
   only (no "write" section). Allow them.
3. Me → Connected → Apple Health says "on" (and the time of the last sync).
4. Fresh install, tap **Skip** on 0d: Health shows the 8b banner; **Open Settings ↗** brings up the
   iOS sheet (first time) and the banner goes once you allow.
5. Health › Day: compare steps, last night's sleep (and 23:48–07:00 style times) and weight with
   the Apple Health app. Walk a bit, background and reopen Life OS: the steps update.
6. **Log workout in Liftoff ↗** opens Liftoff (or the App Store without it).
7. Me → Health targets → Supplements: turn on a reminder two minutes ahead, tap Done, lock the
   phone: the notification arrives. Turn off "Use my health data" in Me: it no longer arrives.
8. On the web (`npm run mobile`, then `w`), sign in as the same user: Health shows the synced
   weight, sleep and steps.
