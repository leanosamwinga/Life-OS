# Test report

- Run started: Sat 7 Nov 2026, 00:45 (Europe/London). Branch `claude/phase2-sign-in-v3`.
- Environment: Docker client present but no daemon (`/var/run/docker.sock` missing) → Supabase CLI stack cannot run. Plan: Supabase Auth (GoTrue) release binary + local Postgres 16 + Mailpit binary.

## Build meal: time at any point, keep the draft (Tue 10 Nov 2026)

Branch `claude/build-meal-time-and-draft`, after PR #10 was merged into main (checked: the PR's
head is an ancestor of `origin/main`, merge commit `15c1b00`). Criteria O1–O16 and the proof for
each are in `docs/PHASE2-SIGNOFF.md` › "O · Build meal: set the time at any point, keep the draft".
No schema change, so no new pgTAP.

New tests:

- **unit** `features/log-meal/slots.test.ts` (+6): the WHEN choices in order with 7a's labels;
  greyed more than an hour ahead (an hour exactly still allowed) with the VoiceOver reason; the
  selected choice for Now, a slot and a picked time (Other time… then); 7b's chip label equal to
  7a's; 7b-W's quiet line with and without greyed slots; where 7i opens.
  `features/log-meal/draft.test.ts` (3): what is kept (components or a typed name; default name),
  what never is (empty, batch, roster edit, corrected copy), and the discard question (2, 1, 0
  components).
- **jest** `build-meal-time-draft.test.tsx` (25): 7b-T2 chip from Now, a slot and a custom time;
  none in edit-roster and save-only ("Log it instead" brings it back); 7b-W rows, ✓, quiet line;
  greyed slots unpickable; a slot picked keeps name, components, amounts and units (one in ml)
  while the chip, bar and default name follow; Other time… → 7i → Yesterday 21:15 → Done (chip,
  "Sun 8 Nov after this meal", 772 / 2,450 kcal) and logged at 2026-11-08T21:15Z with the same
  components; Cancel in 7b-W and in 7i; the corrected copy's chip and bar (original left out, then
  on yesterday); 7a-C card, Continue, default name, a name alone, no card when empty, WHEN chip
  changing the kept meal's time, roster edits not kept; asking before build from scratch, roster
  Log, Log again, batch builder and roster edit (Keep it and Discard), nothing asked without a kept
  meal; cleared after logging, save-only and Cancel; consent off. Two older tests updated for the
  chip (`saved-batches` 7b-R header, `time-edit-units` 7b-T now via 7b-W).
- **e2e** (2 more, 37 in all): W1 a meal built at Now, kept, its time changed to yesterday 21:15 as
  7b does it, logged through the app's backend → on yesterday at 21:15 with the same components,
  amounts and units (one in ml) and server-recomputed kcal, not on today; W2 a slot more than an hour
  ahead forced through the Data API (`rpc/log_meal`) → 400 / 22023, and through the app → refused,
  nothing written. (Run after 22:30, no slot can be ahead today, so W2 uses the same time 90 minutes
  ahead; earlier in the day it takes the time of a greyed plan dinner from `whenChoices`.)

What looking at it found and what was fixed (headless Chrome, 390 × 844, web against the local
stack, signed in as the seeded account, the browser clock held at 13:40 so later slots are greyed:
7a, 7b-T2 from Now with two components, 7b-W, 7i on Yesterday, 7b-T2 after the change, 7b-W with
a picked time, 7a-C, the web discard question):

| Found                                                                | Fix                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| the chip's ▾ was as big as the time (the wireframe draws it smaller) | ▾ at 11 pt inside the chip; checked again in Chrome |

Everything else matched the wireframes: chip outline and placement, 7b-W rows, greyed slots, ✓ and
the quiet line, "Sun 8 Nov after this meal", the 7a-C card and the line under the build buttons.

### Checks (Tue 10 Nov 2026, this branch)

| Check                                                               | Result                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run lint` · `format:check` · `typecheck`                       | ✅                                                                                 |
| `npx tsc --noEmit` in apps/mobile with `.expo/types` (typed routes) | ✅                                                                                 |
| `npm test` (core · functions · scripts · mobile)                    | ✅ 136 · 45 · 18 · 259                                                             |
| `npm run test:db` (plain Postgres 16 + pgTAP, fresh database)       | ✅ 319 ok, 0 not ok                                                                |
| `npm run test:integration` (local stack)                            | ✅ 42                                                                              |
| `npm run test:e2e`, three runs back to back                         | ✅ 37 · 37 · 37                                                                    |
| `deno check` food-lookup · auth-api                                 | ✅ both                                                                            |
| `npx expo export` ios · web · android                               | ✅ all three                                                                       |
| `npm run doctor` against the local stack                            | ✅ all but "from the phone": the stack here listens on 127.0.0.1 only (see the PR) |
| CI                                                                  | not checked from here: this session had no GitHub API access (see the PR)          |

## Log meal and water follow-ups (Mon 9 Nov 2026)

Branch `claude/log-meal-and-water-follow-ups`, after PR #9 was merged into main. Criteria N1–N18
and the proof for each are in `docs/PHASE2-SIGNOFF.md` › "N · Log meal and water follow-ups".

New tests:

- **core** `followups.test.ts` (17): 7i order; looping (rows, 59 → 00 → 01 and back, 23 → 00 and
  back, the short way round, recentring, the day unchanged, struck-through values still
  unpickable, VoiceOver stopping at the ends); "Ate it" time (passed, still to come, no usual
  time, BST, just after midnight); water amounts (0, 1, 5,000, "5,000", "750 ml", 5,001, decimals,
  text, negative, exponent, empty) and newest first; the yesterday view's date; a logged meal's
  components by today's foods, with deleted foods listed apart. `mealedit.test.ts` updated for
  Yesterday | Today and 7l's new line.
- **pgTAP** `10_log_meal_and_water_follow_ups.test.sql` (35): `replace_logged_meal` is SECURITY
  INVOKER and not for `anon`; mismatched macros, a time out of the window, an unknown food, no
  components and an old meal before yesterday are all refused with the original untouched; another
  user gets "meal not found"; the copy is logged, the old meal and its items deleted, the plan link
  kept, the name trimmed, the time and recomputed macros right, the plan meal unchanged; water:
  another user can't see, change or delete yours, you can delete your own, 0 and 5,001 refused;
  consent off refuses the copy, log again and water, and nothing is deleted.
- **jest** `follow-ups.test.tsx` (32): 7i order, opening day, minutes and hours looping, struck
  values when wrapped, VoiceOver ends; Daily targets from Me and from 0g; Today ↔ Yesterday, a
  yesterday meal edited, a meal moved to yesterday, consent off; Log again now and at another time,
  a deleted food; corrected copy pre-filled, saved (one `replaceLoggedMeal`, plan link kept),
  cancelled, failing, with a deleted food, consent off; Ate it at the usual time and now; water
  quick and custom amounts, refusals, today's list and delete, consent off; undo shown and undone,
  timed out, dismissed, plan meal not eaten meanwhile, failure. The 7l test in
  `time-edit-units.test.tsx` now dismisses the note before checking the delete.
- **scripts** `checks.test.mjs` (+5): repo and branch lines, remotes, nested clone by origin and by
  package name, nothing when there's none.
- **e2e** (6 more, 35 in all): U1 a meal moved to yesterday on yesterday's timeline and edited; U2
  corrected copy — raw Data API tampering and a time out of the window refused with the original
  intact, then replaced atomically with the plan link kept; U3 log again; U4 "Ate it" at the usual
  time; U5 custom water logged and deleted, 0 and 5,001 refused; U6–U7 another user and consent off.

What looking at it found and what was fixed (headless Chrome, 390 × 844, web against the local
stack, signed in as the seeded account: Today, Ate it, 7j, Log again, corrected copy, 7k moved to
yesterday, the yesterday view, 7l, the undo note, 7i from 7a and 7k with the mouse wheel, Daily
targets, Health water, both water sheets):

| Found                                                                                      | Fix                                                                              |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| On the web both 7i wheels opened on 00 (the web ignores the scroll view's starting offset) | the wheel scrolls to its row once the rows are laid out; checked again in Chrome |
| 7j had two dark buttons ("Log again" and "Edit meal") competing                            | "Log again" is an outlined button; "Edit meal" stays the one dark button         |
| Daily targets: the intro sat tight against the first field's label                         | space under the intro                                                            |
| "Add water": on the web the field pushed "ml" off the edge                                 | the field can shrink (`minWidth: 0`)                                             |

### Checks (Mon 9 Nov 2026, this branch)

| Check                                                                           | Result                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run lint` · `format:check` · `typecheck`                                   | ✅                                                                                 |
| `npx tsc --noEmit` in apps/mobile with and without `.expo/types` (typed routes) | ✅ both                                                                            |
| `npm test` (core · functions · scripts · mobile)                                | ✅ 136 · 45 · 18 · 225                                                             |
| `npm run test:db` (Postgres 16 + pgTAP, fresh database)                         | ✅ 10 files; `10_log_meal_and_water_follow_ups` 35                                 |
| `npm run test:integration` (real Supabase Auth, fresh stack)                    | ✅ 42                                                                              |
| `npm run test:e2e`, three runs back to back                                     | ✅ 35 · 35 · 35 (~45 s each)                                                       |
| `deno check` food-lookup and auth-api                                           | ✅ (Deno 2.9.6)                                                                    |
| `npx expo export` ios · web · android                                           | ✅                                                                                 |
| `npm run doctor -- --simulator` against the local stack                         | ✅ "All good." (repo and branch printed first; a nested clone warned when present) |
| `database.types.ts`                                                             | ✅ regenerated (`npx supabase gen types typescript --db-url`), additive diff only  |

## Log meal: custom time, edit and delete, g or ml (Mon 9 Nov 2026)

Branch `claude/log-meal-time-edit-units`. Criteria M1–M16 and the proof for each are in
`docs/PHASE2-SIGNOFF.md` › "M · Log meal: custom time, edit and delete, g or ml".

New tests:

- **core** `mealedit.test.ts` (18) and `logwindow.test.ts` (8): the picker's limits (14:40 at 13:40,
  23:59 on yesterday, struck-out values, held to the latest), its words, where it opens; day
  boundaries — yesterday 23:59 vs today 00:00, just after midnight, late evening, summer time, the
  October change (01:30 happens twice) and the March change (01:30 doesn't exist); 7k's move note,
  7l's sums and the plan note; the ≈ line, the formula and "bottle".
- **pgTAP** `09_log_meal_time_edit_units.test.sql` (63): units on foods, items, saved components
  and last portions (defaults g); the window in `log_meal` and on retime; `update_logged_meal` —
  name, time, units only, keys other than position/unit refused (amounts, kcal, food), unknown
  items refused; `delete_logged_meal`; direct updates and deletes of logs and items refused; meals
  before yesterday locked; another user; consent off for edits and deletes; SECURITY INVOKER,
  nothing for `anon`.
- **jest** `time-edit-units.test.tsx` (22): every new wireframe state (7a-T ×2, 7i ×3 including
  VoiceOver swipes, 7b-T, 1B before/after, 7j ×3, 7k ×4 including saving, 7l ×2 plus cancel, 7d-U ×2,
  7e-U), a link to a deleted meal, consent off; 7h-U in `saved-batches.test.tsx`; `amounts.test.ts`
  for units.
- **functions** `mapping.test.ts`: Open Food Facts' own basis (v3.5 input sets, `nutrition_data_per`)
  over the pack's unit; missing stays null.
- **e2e** (7 more, 29 in all): T1 custom time → London day and time order; T2 server refuses out of
  window (app and raw Data API); T3–T4 rename and retime touch only the log, totals move; T5
  crafted edits and raw writes can't change amounts; T6 delete, plan meal back as not eaten; T7–T8
  barcode drink per 100 ml (a fake 330 ml shake in the local Open Food Facts stand-in), unit switch
  changes no numbers; T9–T10 another user, consent off.

What looking at it found and what was fixed (headless Chrome, 390 × 844, web against the local
stack: 7a-T, 7i default / limit / yesterday, 7a-T chosen, 7b-T, 7d-U ml and g, 7j, 7k-U, 7k moved,
7l, 1B after the move and after "Ate it", 7e-U, the food list):

| Found                                                                                                                | Fix                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The g / ml switch on 7d-U was shorter than the big amount field                                                      | the switch is as tall as the field (7d-U, 7h-U); a full-width size for 7e-U                                       |
| 7k: "Change ›" wrapped under "Yesterday · Sun 8 Nov · 21:30"; auto-shrinking text isn't on the web (it hid the time) | 16 pt for that row; the time is never truncated                                                                   |
| The food list said "62 kcal per 100 g" for a drink                                                                   | per 100 ml (test added)                                                                                           |
| The serving hint on 7e said "per 100 g" with per 100 ml chosen                                                       | follows the label's unit                                                                                          |
| `expo start` writes typed routes (`.expo/types`) under which three existing lines in `_layout.tsx` don't typecheck   | not part of this change and not in CI (the file isn't generated there); left as is and the generated file removed |

### Checks (Mon 9 Nov 2026, this branch)

| Check                                                        | Result                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm run lint` · `format:check` · `typecheck`                | ✅                                                                                |
| `npm test` (core · functions · scripts · mobile)             | ✅ 119 · 45 · 13 · 193                                                            |
| `npm run test:db` (Postgres 16 + pgTAP, fresh database)      | ✅ 9 files; `09_log_meal_time_edit_units` 63                                      |
| `npm run test:integration` (real Supabase Auth, fresh stack) | ✅ 42                                                                             |
| `npm run test:e2e`, three runs back to back                  | ✅ 29 · 29 · 29 (~40 s each)                                                      |
| `deno check` food-lookup and auth-api                        | ✅                                                                                |
| `npx expo export` ios · web · android                        | ✅                                                                                |
| `npm run doctor -- --simulator` against the local stack      | ✅ "All good."                                                                    |
| `database.types.ts`                                          | ✅ regenerated (`npx supabase gen types typescript --db-url`), additive diff only |
| CI on PR #9 (lint/typecheck/unit, Deno check, database)      | ✅                                                                                |

Not run here: anything that needs the iPhone (M14 look and feel on the phone, M15 VoiceOver and
largest text) — the checklist in `docs/PHASE2-SIGNOFF.md`.

## Log meal: Saved tab and batches (Sun 8 Nov 2026)

Branch `claude/log-meal-saved-batches`. Criteria L1–L13 and the proof for each are in
`docs/PHASE2-SIGNOFF.md` › "L · Log meal: Saved tab and batches".

New tests:

- **core** `batch.test.ts` (40): the ratio table; `guessCooksAs` on 27 names (what counts, what
  doesn't); cooked-weight rounding; the estimate; a correction; impossible weights; whole batch =
  ingredients summed like a meal; per-100 g estimated and weighed (wireframe 7f: 1,310 g → 136 kcal,
  and 350 g of it = 7h's 476 kcal); cook again; liquids; half-away-from-zero rounding; empty batch.
- **pgTAP** `08_batches.test.sql` (42): SECURITY INVOKER, RLS on, nothing for `anon`; the stored
  per-100 g; tampered, missing and wrong-estimate numbers refused; "as added" must be × 1; too
  light; incomplete ingredient; batch in a batch; guards on direct writes; stars; weighed; cook
  again keeps logged snapshots and new logs need the new numbers; a batch in a saved meal; another
  user sees nothing and can't cook it again or attach ingredients (composite FK); consent off.
- **jest** `saved-batches.test.tsx` (19): every wireframe state (7a-S ×3, 7b-R ×2, 7b-B, 7f ×3 plus
  correction, refusal and "save and log some", 7g ×2 plus remove/delete, 7h ×2), star failure,
  consent off. `csrf.test.ts` (2) and two new row-mapping checks in `foods.test.ts`.
- **e2e** (3 more, 22 in all): L1; L2–L7 in one flow (create → server per-100 g = core, tampered
  per-100 g and estimate refused through the Data API, direct writes refused, log 100 g, as a
  component, cook again, stale client refused, star order after a relaunch, delete blocked while
  in a saved meal); L8–L9 (another user; consent off and back on).

What looking at it found and what was fixed:

| Found                                                                                                                                                                                                                                                                     | Fix                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Web: every Data API write was refused.** The web server needs `X-CSRF-Token` on non-GET `/api/supabase` calls; only auth-api calls sent it, so the consent check, log meal, save meal… all came back 403 `DEVICE_CHECK_FAILED` in a browser ("Couldn't load your data") | `webDataFetch` adds it (`src/lib/auth/csrf.ts`, shared with the auth client); jest `csrf.test.ts`. Seen and re-checked in Chrome          |
| The Log meal sheet header shrank to its content ("Ca… Log …", "Cook a…")                                                                                                                                                                                                  | `SheetHeader` fills its row                                                                                                               |
| Big number fields overflowed sideways on the web (an `<input>` won't shrink below its default width)                                                                                                                                                                      | `minWidth: 0` on the field                                                                                                                |
| "Save and log some" / "Log it instead" sat on the left; wrapped button labels were left-aligned                                                                                                                                                                           | centred, as drawn                                                                                                                         |
| Zero macros read "C 0.0"; the wireframes say "C 0"                                                                                                                                                                                                                        | 7b and 7f rows                                                                                                                            |
| An e2e assertion failed because the running stack had an older copy of the new migration                                                                                                                                                                                  | not a bug: restarted the stack (`npm run local-auth`), which applies migrations fresh; all checks below ran on a fresh stack and database |

The screens were looked at in Chrome (390 × 844) against the local stack: 7a both tabs, 7f
building and estimated, 7g changed, the ingredient "how much" with "In the pot", 7h.

### Checks (Sun 8 Nov 2026, this branch)

| Check                                                        | Result                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm run lint` · `format:check` · `typecheck`                | ✅                                                                                |
| `npm test` (core · functions · scripts · mobile)             | ✅ 93 · 42 · 13 · 168                                                             |
| `npm run test:db` (Postgres 16 + pgTAP, fresh database)      | ✅ 8 files; `08_batches` 42                                                       |
| `npm run test:integration` (real Supabase Auth, fresh stack) | ✅ 42                                                                             |
| `npm run test:e2e`, three runs back to back                  | ✅ 22 · 22 · 22 (~34 s each)                                                      |
| `deno check` food-lookup and auth-api                        | ✅                                                                                |
| `npx expo export` ios · web · android                        | ✅                                                                                |
| `npm run doctor -- --simulator` against the local stack      | ✅ "All good."                                                                    |
| `database.types.ts`                                          | ✅ regenerated (`npx supabase gen types typescript --db-url`), additive diff only |
| CI on PR #8 (lint/typecheck/unit, Deno check, database)      | ✅                                                                                |

Not run here: anything that needs the iPhone (L11 look and feel on the phone, L12 VoiceOver and
largest text) — the checklist in `docs/PHASE2-SIGNOFF.md`.

## Phase 2 sign-off run (Sun 8 Nov 2026)

What each acceptance criterion rests on is in `docs/PHASE2-SIGNOFF.md`. This run added:

- **Local fakes on the Docker-free stack** (`scripts/local-auth/fakes.mjs`, on by default,
  `LOCAL_FAKES=off` to leave out): JWKS for a fake Apple and Google from RSA keys generated on each
  start (same issuers and audiences as the integration harness; private halves in
  `.local-auth/fakes.json`, git-ignored) and an Open Food Facts stand-in that answers every barcode
  "not found". `food-lookup` reads `OPEN_FOOD_FACTS_URL` (default the real one). So the e2e test
  runs Apple and Google through the real `auth-api` in Deno, with no real account.
- **e2e phones are separate devices.** Each is a fresh copy of the app's modules (own device ID,
  Keychain and network address, `vi.resetModules`), so second-device flows are real: sign out one,
  sign out everywhere, step-up on a new device, other devices signed out after a password change or
  reset. The fake Apple sheet signs SHA-256(nonce) like Apple; the fake Google page returns a code
  that the test's fetch exchanges for an ID token like Google's token endpoint.
- **e2e: 19 tests** (was 7): B1, B3/C2 server side, B6 ×2, B7, B8, E1 ×2, E2/F2, E4, F1, F3, G1,
  G2, H1–H7, the reset → 0b-8i server side. Three runs back to back, all green (~31 s each).

What the tests found and what was fixed:

| Found                                                                                               | Fix                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G3: relaunching mid-onboarding always went back to 0c                                               | `resumeStep` picks up after the last saved answer; `/onboarding` redirects there; 0g saved → never again (`jest` phase2-screens, 5 failed before the fix) |
| I3: Health worked out "today" once and never rolled over at midnight                                | `useNow` (Today and Health): every minute and when the app comes back to the foreground                                                                   |
| A3: an empty `APPLE_BUNDLE_ID` was only a warning, so Apple failed on the phone with a green doctor | ✗ with the Expo Go fix; ids left in `supabase/.env` are ✗ "moved: copy it to supabase/functions/.env"                                                     |
| A2: fixes said `supabase …`, which isn't installed on the Mac                                       | every fix says `npx supabase …`; a test fails if a bare `supabase` command appears                                                                        |
| CI didn't run the doctor tests or `deno check` on auth-api                                          | both added to `.github/workflows/ci.yml`                                                                                                                  |

No server-side bug turned up: every new e2e flow (wrong method, reset, step-up, devices, change
password, export, consent, unknown barcode, "Ate it", tampered macros) passed on its first run;
two assertions were tightened so they fail for the right reason (consent refusals must be the
"Health data is off" refusal; the tampered meal must be refused as a macro mismatch).

### Checks (Sun 8 Nov 2026)

| Check                                                   | Result                                                |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `npm run lint` · `format:check` · `typecheck`           | ✅                                                    |
| `npm test` (core · functions · scripts · mobile)        | ✅ 53 · 42 · 13 · 146                                 |
| `npm run test:db` (Postgres 16 + pgTAP, fresh database) | ✅                                                    |
| `npm run test:integration` (real Supabase Auth)         | ✅ 42                                                 |
| `npm run test:e2e`, three runs back to back             | ✅ 19 · 19 · 19                                       |
| `deno check` food-lookup and auth-api                   | ✅                                                    |
| `npx expo export` ios · android · web                   | ✅                                                    |
| `npm run doctor -- --simulator` against the local stack | ✅ all ✓ (phone mode: ✗ on `127.0.0.1`, as it should) |
| CI on PR #7 (lint/typecheck/unit, Deno check, database) | ✅                                                    |

Not run here: anything that needs the iPhone, Apple's or Google's real sign-in, or the internet
(a real Open Food Facts product) — the 📱 items in `docs/PHASE2-SIGNOFF.md`.

## Phase 2 end to end on the real stack (Sat 7 Nov 2026)

Why: sign-in v3 passed its tests but failed on a phone (Expo Go, `supabase start`): "Couldn't load
your data — Session revoked" after signing up, earlier "Account pending deletion", and a "Try
again" that did nothing. The real path — phone → gateway → PostgREST with
`pgrst.db_pre_request = public.check_request` → Postgres, and → auth-api in Deno — had never run:
auth-api ran under Node and `check_request` only in pgTAP.

### The stack it ran on

Docker has no daemon in this environment, so `scripts/local-auth` now runs the whole phone path
from pinned, checksum-checked release binaries (`npm run local-auth`):

| Piece                  | Version                                      | Configured like Supabase                                                                                              |
| ---------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Postgres               | 16 (system) + pg_cron + pgTAP                | Supabase roles; API roles get `usage on schema auth` (found missing by the e2e test, see below)                       |
| Supabase Auth (GoTrue) | v2.197.0 — the version the Supabase CLI pins | `config-to-env.sh` mirrors `config.toml`, hooks included (`LOCAL_AUTH_HOOKS=off` leaves them out on purpose)          |
| PostgREST              | v16.5 — the version the Supabase CLI pins    | `authenticator`, anon role `anon`, Auth's JWT secret, in-database config, so the migration's `db_pre_request` applies |
| auth-api, food-lookup  | Deno v2.9.6, `index.ts` as deployed          | env = `supabase/functions/.env.example` as copied + the `SUPABASE_*` values the edge runtime injects                  |
| Gateway                | `scripts/local-auth/gateway.mjs`             | `/auth/v1`, `/rest/v1` (apikey required), `/functions/v1/<name>` (JWT check where `verify_jwt = true`), like Kong     |
| Mailpit                | v1.33.0                                      | SMTP :54325, API :54324                                                                                               |

`npm run test:e2e` (`e2e/phone.e2e.test.ts`) acts like the phone: it runs the app's **own**
`AuthClient`, supabase-js client and `supabaseBackend` (`apps/mobile/src/lib`) in Node, with the
handful of Expo modules they touch replaced by small stand-ins (in-memory Keychain, Node crypto).
Codes come from Mailpit. 7/7, three runs back to back:

| Step                                                                                                | Result |
| --------------------------------------------------------------------------------------------------- | ------ |
| `authenticator` has `pgrst.db_pre_request=public.check_request`; anon passes through it             | ✅     |
| Sign up → code from Mailpit → token with `lifeos_scope` + `session_id` → profile, settings, consent | ✅     |
| 0c consent → 0d → 0e → 0f nudges → 0g name + targets → `onboarding_completed_at`                    | ✅     |
| 7a empty roster · 7c barcode → food-lookup (cache) · search · 7e manual food (yours wins)           | ✅     |
| 7b build + save to plan + `log_meal` · 7d last-time amounts · one-off meal · "Ate it" · water +250  | ✅     |
| Today/Health: `dayProgress` over what `useDay` reads = 2 × 386 + 252 kcal, 250 ml                   | ✅     |
| Refresh rotates; replaying the old refresh token revokes the session; the app → 0a                  | ✅     |
| Sign out → the old token gets `SESSION_REVOKED` from the Data API                                   | ✅     |
| A Keychain token whose session is gone (db reset) → `SESSION_REVOKED` → the app → 0a                | ✅     |
| Delete account → `PENDING_DELETION` from the Data API → cancel → full access again                  | ✅     |

Not covered here: a barcode that isn't in the cache — Open Food Facts isn't reachable from this
environment (the proxy refuses it), so only the cached path of food-lookup ran.

### Root cause of `SESSION_REVOKED` after signing up

What the message means: it comes from `public.check_request` (PostgREST's pre-request), which
raises it when the token's `session_id` isn't in `auth.sessions`. So the phone was sending an
access token whose Supabase Auth session no longer existed.

What I could and couldn't reproduce:

- A **fresh** sign-up works end to end on the stack above (same Supabase Auth and PostgREST
  versions as `supabase start`), including with the phone's clock 15 minutes off. I couldn't make
  a just-issued session disappear.
- **"Account pending deletion"** is reproduced exactly by starting Supabase Auth without
  `config.toml`'s `[auth.hook.*]` (`LOCAL_AUTH_HOOKS=off`): auth-api happily handed out tokens
  with no `lifeos_scope`, and `check_request` treats a missing scope as `PENDING_DELETION`. That's
  what `supabase start` does when the stack was started on another branch: `config.toml` is only
  read at start (and `supabase start` on a running stack changes nothing).
- **"Session revoked"** is reproduced by any token that outlives its session: `supabase db reset`
  or a restart without a backup (every session goes), sign-out elsewhere, refresh-token reuse.
  The token from the hooks-off attempt is exactly that after the stack is restarted with the right
  config and reset.

Root cause, in two parts:

1. **App (the bug that made it a dead end):** the app only treated auth-api 401s as the end of a
   session. When the **Data API** refused the token, `SessionProvider` showed it as a load error
   with the raw message, and "Try again" re-sent the same dead token from the Keychain forever —
   no way back to Welcome short of deleting Expo Go's data. Spec 3.3 says SESSION_REVOKED /
   SESSION_EXPIRED anywhere go to 0a with no message.
2. **Setup (why the token was dead):** the stack had been started with an older `config.toml`
   (Auth hooks off). Tokens issued then lacked `lifeos_scope` (→ "Account pending deletion"), and
   after `supabase stop/start` + `db reset` their sessions were gone (→ "Session revoked"). Nothing
   said the hooks weren't running.

Fixes:

- `apps/mobile/src/lib/backend/sessionFetch.ts` wraps every Data API and function call: ended
  session (SESSION_REVOKED, SESSION_EXPIRED, a JWT PostgREST can't verify) → forget it, Keychain
  too → 0a, no message; "JWT expired" → refresh once and retry; PENDING_DELETION → ask auth-api
  (`GET /v1/me/deletion`, then refresh) → S-5h. The web cookie server drops its cookies on the
  same answers. `SessionProvider` shows "Couldn't load your data" only for network/server errors,
  in plain words, and "Try again" goes back to the spinner and loads again.
- `auth-api` refuses to issue or refresh a session whose token lacks `lifeos_scope`: it deletes
  that session, logs "Supabase Auth hooks aren't running — run `supabase stop && supabase start`"
  and returns `SERVER_ERROR`. It also no longer turns a Supabase Auth outage into
  SESSION_REVOKED (only a 4xx from Auth ends a session).
- `npm run doctor` checks the setup (hooks running, migrations, env files, Mailpit, the phone URL)
  and README "Run it on your phone" says to `supabase stop && supabase start && supabase db reset`
  when switching branches.

Found on the way: the Docker-free stack lacked `grant usage on schema auth` for the API roles, so
`save_meal` / `log_meal` (SECURITY INVOKER, call `auth.uid()`) failed there with 42501 —
Supabase's image has the grant, so this was local-stack only; `expo export -p web` failed with
`apps/mobile/.env.local` present (no origin during static rendering) — fixed.

### App behaviour tests (jest)

`apps/mobile/src/__tests__/session-errors.test.tsx` (11) runs the real `AuthClient` + supabase-js +
`sessionAwareFetch` against a scripted fake stack: Data API SESSION_REVOKED / SESSION_EXPIRED /
bad JWT clear the session; auth-api and refresh SESSION_* clear it; JWT expired refreshes once
and retries; PENDING_DELETION re-checks and switches scope; network/5xx keep the session; and in
the rendered app: revoked → 0a with no text, expired refresh → 0a, pending → S-5h, network error →
"Couldn't load your data" + "Check your connection" → Try again → 0c, server error keeps the
session. Removing the fetch wrapper makes the app tests fail.
`expo-go-google.test.tsx` (2): in Expo Go the Google button shows "Google sign-in needs a
development build" and nothing is called; in a development build it signs in as before.
`setup.integration.test.ts` (1): a second Supabase Auth with the hooks off → confirm returns
SERVER_ERROR, the log line is written, no session is left. `scripts/doctor/checks.test.mjs` (5).

### Expo Go and Google (D)

Google's iPhone flow (`ASWebAuthenticationSession`, code + PKCE + nonce) redirects to
`com.googleusercontent.apps.<id>:/oauth2redirect`; `app.config.ts` registers that scheme in a
development or store build. Expo Go is prebuilt and can't register it, and Expo's own guidance is
that Google sign-in on iOS needs a development build (SDK 49+). I couldn't run Expo Go here, so
the app now says so in Expo Go (`isRunningInExpoGo()`) instead of ending on 0b-8g. Apple works in
Expo Go with `APPLE_BUNDLE_ID=host.exp.Exponent` (the native sheet is in Expo Go). **Manual:**
confirm both on the phone.

### Checks after these changes

| Check                             | Result                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run lint` / `format:check`   | ✅ clean                                                                                                |
| `npm run typecheck`               | ✅ core, edge functions, app, e2e                                                                       |
| `npm test`                        | ✅ core 53 · edge functions 42 · scripts 5 · app 124 (15 suites)                                        |
| `npm run test:db`                 | ✅ all files (fresh database on the local Postgres 16)                                                  |
| `npm run test:integration`        | ✅ 42/42 (41 + hooks-off setup test)                                                                    |
| `npm run test:e2e`                | ✅ 7/7, three runs back to back                                                                         |
| `deno check` both functions       | ✅                                                                                                      |
| `npm run doctor`                  | ✅ against the Docker-free stack; ✗ with the right fix for hooks off, 127.0.0.1 on a phone, missing env |
| `expo export` ios / web / android | ✅ (web with Supabase env set, after the fix above)                                                     |
| Secret scan before each push      | ✅ no JWTs, private keys or `sb_secret_` values in any diff                                             |
| On a real phone                   | **Not run here** (no device). Follow README "Run it on your phone" and `npm run doctor`.                |

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
  instead. The integration tests run `auth-api` in-process under Vitest (Node); the e2e test runs it
  in Deno (not Supabase's edge runtime itself) behind the gateway.
- **PostgREST** wasn't part of the local stack for the original run; it is now (see "Phase 2 end to
  end on the real stack"), and `check_request` is exercised through the live Data API by the e2e test.
- **Real Apple / Google / Turnstile / App Attest**: no credentials (and none may be committed). Fake
  JWKS and ID tokens for the providers; device checks off in the integration run, with unit tests for
  the App Attest and Turnstile verifiers.
- **Real devices** (iPhone autofill, Face ID sheet, VoiceOver, Dynamic Type): not available overnight.
- **`npx expo install`** was blocked by the network proxy; packages were added with npm at the
  versions in Expo SDK 58's `bundledNativeModules.json` instead.
- Nothing needed approval and nothing was skipped for lack of it.
