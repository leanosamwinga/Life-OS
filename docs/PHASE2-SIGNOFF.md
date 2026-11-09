# Phase 2 sign-off

Branch `claude/phase2-sign-in-v3` · PR #7 (merged) · updated Sun 8 Nov 2026 on
`claude/log-meal-saved-batches`, which adds [section L](#l--log-meal-saved-tab-and-batches).

Each criterion is one of:

- ✅ **automated** — a test proves it; the test is named (file › test name).
- 📱 **manual on your phone** — needs a person and a real iPhone. The tests that back it are listed;
  the steps are in the [morning checklists](#morning-checklist-phase-2-sign-in) at the end.
- ☐ **open** — not done yet; says what's needed.
- ⏭ **deferred** — moved to a named later phase.

Where the tests live:

| Short name    | What                                                           | Runs with                                             |
| ------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| `e2e`         | `e2e/phone.e2e.test.ts` — the app's own code on the real stack | `npm run local-auth`, then `npm run test:e2e`         |
| `integration` | `supabase/functions/auth-api/test/*.integration.test.ts`       | `npm run local-auth`, then `npm run test:integration` |
| `jest`        | `apps/mobile/src/__tests__/*.test.tsx`                         | `npm run test:mobile` (CI)                            |
| `doctor`      | `scripts/doctor/checks.test.mjs`, `readme.test.mjs`            | `npm run test:scripts` (CI)                           |
| `pgTAP`       | `supabase/tests/*.test.sql`                                    | `npm run test:db` (CI)                                |

The `e2e` Apple and Google are the local stack's fakes (`scripts/local-auth/fakes.mjs`): ID tokens
signed with RSA keys generated on each start, the same issuers and audiences as the integration
tests. They prove everything on the server side of Apple/Google; only the real Apple sheet and
Google page need the phone.

## A · Setup

| ID  | Criterion                                                                                                                                                                         | Status | Proof                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `npm run doctor` passes on your Mac for a phone                                                                                                                                   | 📱     | Every check is unit-tested (`doctor`); `npm run doctor -- --simulator` passes against the local stack here (all ✓), and the phone mode correctly fails on `127.0.0.1`. Checklist step 1.                                    |
| A2  | doctor finds Docker and the stack when the CLI is only used through `npx supabase status -o env`; every fix it prints uses `npx supabase …`                                       | ✅     | `doctor` › "A2: finds the stack through `npx supabase status -o env` when the CLI is not installed" · "A2: every command the doctor prints spells the CLI `npx supabase …`"                                                 |
| A3  | empty `APPLE_BUNDLE_ID` is ✗ with "APPLE_BUNDLE_ID=host.exp.Exponent for Expo Go (local only)"; an id left only in `supabase/.env` is "moved: copy it to supabase/functions/.env" | ✅     | `doctor` › "A3: an empty APPLE_BUNDLE_ID is ✗ (not a warning)…" · "A3: an Apple id left only in supabase/.env is ✗ "moved…""; also run against the stack with the id blanked (prints ✗ with the fix)                        |
| A4  | after `npx supabase db reset` the phone returns to 0a by itself                                                                                                                   | 📱     | Server and app logic automated: `e2e` › "E1 ROOT CAUSE: a token kept in the Keychain whose session is gone…"; `jest` session-errors › "a stored session the Data API calls revoked → 0a with no message". Checklist step 9. |
| A5  | README "Run it on your phone" uses `npx supabase …` throughout; no command block has a comment line                                                                               | ✅     | `doctor` (readme.test.mjs) › "no command block contains a comment line or an inline # comment" · "every Supabase CLI command is `npx supabase …`" · ""Run it on your phone" uses npx supabase throughout"                   |

## B · Sign-in

| ID  | Criterion                                                                                                                                     | Status | Proof                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | email create → code → 0c                                                                                                                      | 📱     | `e2e` › "B1: sign up → code from Mailpit → data reads…"; `jest` sign-in-v3 › "paste fills all six boxes and submits → 0b-4g → Continue → 0c". Checklist step 2.                                                            |
| B2  | email sign-in; 0b-5d wrong password; 0b-5e unknown email                                                                                      | 📱     | `jest` sign-in-v3 › "signs in → Today", "0b-5d wrong password…", "0b-5e not recognised…", "0b-6d not recognised (real email)…"; `integration` flows › "signs in; not found → ACCOUNT_NOT_FOUND…". Checklist step 4.        |
| B3  | Apple create, sign out, sign in                                                                                                               | 📱     | Server side ✅ `e2e` › "B3, C2: Apple and Google create → sign out → sign in again (0b-8h on a second create)". Checklist step 5.                                                                                          |
| B4  | 0b-8i shows, in development only, "Local data was reset? `supabase db reset` erases every account — create it again."; release copy unchanged | ✅     | `jest` dev-notes › "B4: … development: explains that a db reset erases every account" · "release build: the wireframe copy only, no development note" · "0b-8h … never shows it"; server side `e2e` › "A4/B4 server side…" |
| B5  | Google in Expo Go shows the development-build note                                                                                            | 📱     | `jest` expo-go-google › "shows the development-build note and never calls Google or 0b-8g". Checklist step 6.                                                                                                              |
| B6  | wrong method: password account tried with Apple/Google, Apple account on the password form → `WRONG_METHOD` with the method                   | ✅     | `e2e` › "B6: a password account tried with Apple or Google → WRONG_METHOD (PASSWORD); nothing linked" · "B6: an Apple account tried on the password form → WRONG_METHOD (APPLE); Apple ↔ Google too"                       |
| B7  | forgot password: Mailpit link → new password works, old fails, other sessions end, the link never signs anyone in                             | ✅     | `e2e` › "B7: forgot password — Mailpit link → new password works, old fails, other sessions end, the link never signs anyone in"                                                                                           |
| B8  | new device: password from a second device → `STEP_UP_REQUIRED` → code from Mailpit → signed in                                                | ✅     | `e2e` › "B8: new device while the quiet check is set → STEP_UP_REQUIRED → code from Mailpit → signed in"; the quiet check itself: `integration` flows › "quiet check: 20 failures from 3 keys sets the flag…"              |

**Reading taken for B8.** The spec (1.3, 2.9) only asks a new device for a code while the account's
"unusual tries" flag is set; a new device on a quiet account signs straight in. The e2e test proves
both: a new device signs in without a code, then (flag set directly in the database, because
setting it for real takes 20 wrong passwords over hours) a known device still isn't challenged and
a new one goes through 0b-5h with the emailed code.

## C · Development build

| ID  | Criterion                                                       | Status    | Proof / what's needed                                                                                                                                      |
| --- | --------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | development build on your phone with your own `APPLE_BUNDLE_ID` | ⏭ phase 7 | Needs your paid Apple Developer account, your bundle id in `apps/mobile/app.json` and a development build. Moved to phase 7 (TestFlight) on Sun 8 Nov.     |
| C2  | Google create / sign in / wrong method / 0b-8h on iPhone        | ⏭ phase 7 | Server side ✅ `e2e` › "B3, C2: …" (Google create, sign out, sign in, 0b-8h one-tap) and "B6: …" (wrong method). Needs C1, so it moves to phase 7 with it. |

## D · Web

| ID  | Criterion                                                                                                                              | Status    | Proof                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | web email + password; tokens only in httpOnly cookies                                                                                  | ✅        | `integration` bff › "creates an account, confirms it and signs in with nothing but cookies" · "refreshes through the refresh cookie…" · "rejects a cross-site request even with valid cookies"                                            |
| D2  | web Apple without `EXPO_PUBLIC_APPLE_SERVICES_ID` (or Google without a web client id) → a development note, not 0b-8g; README explains | ✅        | `jest` dev-notes › "D2: … APPLE / GOOGLE: a development note instead of 0b-8g; the provider is never called" · "with the ids set, the provider goes ahead as usual" · "webProviderSetupMissing: …". README "Apple and Google on the web". |
| D3  | web Apple/Google with real ids on HTTPS                                                                                                | ⏭ phase 7 | Needs a hosted HTTPS address (Q-HOSTING). Recorded in `docs/SPEC-QUESTIONS.md` and README.                                                                                                                                                |

**Reading taken for D2.** The note shows on a development web build only; a release web build
keeps the spec's 0b-8g. Apple also counts as "not set up" when the return address isn't `https://`
(Apple refuses `http://` and `localhost`).

## E · Sessions and errors

| ID  | Criterion                                                                                      | Status | Proof                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | revoked/expired → 0a, no message                                                               | ✅     | `e2e` › "refresh rotates; reusing the old refresh token revokes the session; then → 0a" · "E1 ROOT CAUSE…"; `jest` session-errors › "a stored session the Data API calls revoked → 0a with no message" · "SESSION_EXPIRED from a refresh at start-up → 0a with no message" |
| E2  | pending deletion → S-5h, Keep my account                                                       | ✅     | `e2e` › "E2, F2: delete account → PENDING_DELETION from the Data API → S-5h; other devices out; Keep my account"; `jest` session-errors › "PENDING_DELETION from the Data API → auth-api says pending → S-5h"; sign-in-v3 › "S-5 delete: … S-5h, Keep → S-5i"              |
| E3  | network error → "Couldn't load your data", Try again works                                     | 📱     | `jest` session-errors › "a network error shows "Couldn't load your data"; Try again really retries" · "a server error … keeps the session". Checklist step 8 (Wi-Fi off/on).                                                                                               |
| E4  | signed-in devices: list, sign out one, sign out everywhere; ended tokens get `SESSION_REVOKED` | ✅     | `e2e` › "E4: signed-in devices — list, sign out one, sign out everywhere; ended tokens get SESSION_REVOKED"; `jest` sign-in-v3 › "S-4 devices: …"                                                                                                                          |

## F · Me → Security

| ID  | Criterion                                                                         | Status | Proof                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | change password: old refused, this device keeps working, other devices signed out | ✅     | `e2e` › "F1: change password — wrong current refused; this device keeps working; other devices signed out; old password fails"; `jest` sign-in-v3 › "S-2 …" |
| F2  | delete + Keep my account                                                          | ✅     | `e2e` › "E2, F2: …"; `integration` flows › "S-5: delete …" · "day-30 job: data gone…"                                                                       |
| F3  | export: JSON and CSV with this user's data only                                   | ✅     | `e2e` › "F3: export returns JSON and CSV with this user's data only" (two users with data; the other's id, email and name appear in neither file)           |

## G · Onboarding and consent

| ID  | Criterion                                                                                       | Status | Proof                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 0c → 0d → 0e → 0f → 0g → Today, each choice saved                                               | 📱     | `e2e` › "G1, H1–H6: onboarding 0c–0g…"; `jest` auth-onboarding › "iPhone: consent → Apple Health → Screen Time → nudges → finish → Today". Checklist step 3.                                                                                  |
| G2  | consent "Not now": health writes refused, the rest works; withdrawing later stops health writes | ✅     | `e2e` › "G2: consent "Not now" — health writes refused, everything else works; withdrawing later stops health writes"; `pgTAP` 03_health_consent                                                                                              |
| G3  | relaunch mid-onboarding resumes at the right step; never after 0g                               | ✅     | `jest` phase2-screens › "G3: relaunching mid-onboarding resumes at the right step" (6 cases incl. web) · "after 0g onboarding never shows again, even deep-linked" · "resumeStep: …". **Fixed:** a relaunch used to go back to 0c every time. |

**Reading taken for G3.** "The right step" = the step after the last answer that was saved.
Answers that save nothing — "Not now" on 0c, Skip on 0f — are asked again after a relaunch, which
records nothing new and changes nothing.

## H · Log meal

| ID  | Criterion                                                                            | Status | Proof                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | 7a roster/new, 7b build and save to plan                                             | 📱     | `e2e` › "G1, H1–H6 …"; `jest` log-meal › "7a: roster…", "7b: build from scratch…, save to roster and log". Checklist step 7.                                                                      |
| H2  | a real barcode through Open Food Facts, with the ODbL credit shown                   | 📱     | `jest` add-foods › "a found product opens "how much" … with pack chips and the ODbL credit"; `test:functions` food-lookup mapping tests. Needs the internet and a real product. Checklist step 7. |
| H3  | unknown barcode with no food → your own food saves and is found by barcode next time | ✅     | `e2e` › "H3: an unknown barcode → not found → your own food saves and is found by barcode next time (only for you)"; `jest` add-foods › "7e … not found: add it from the label…"                  |
| H4  | 7d last-time amount                                                                  | ✅     | `e2e` › "G1, H1–H6 …" (80 g and 150 g come back as last time); `jest` add-foods › "… pre-filled from last time…"                                                                                  |
| H5  | "Ate it" logs once                                                                   | ✅     | `e2e` › "H5, H6, H7: "Ate it" logs the plan meal once and Today stops offering it…"; `jest` log-meal › ""Ate it" saves the plan meal via log_meal and updates the ring"                           |
| H6  | water                                                                                | ✅     | `e2e` › "H5, H6, H7 …" (+250 ml twice = 500 ml in Health's total); `jest` log-meal › "Health "+ 250 ml" saves water"                                                                              |
| H7  | the server recomputes macros and refuses mismatches                                  | ✅     | `e2e` › "H5, H6, H7 …" (tampered kcal through the Data API → 400 "nutrition … has changed", nothing saved); `pgTAP` 05_log_meal                                                                   |

**Reading taken for H5.** "Logs once" = one tap writes exactly one meal log (with the plan meal's
components snapshotted), and Today then stops offering "Ate it" for that plan meal, so it can't be
logged twice by accident. The server doesn't refuse a deliberate second log of the same meal (you
can eat the same thing twice).

## I · Today and Health

| ID  | Criterion                                                                          | Status | Proof                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Today rings and timeline match the logs by London day                              | 📱     | `e2e` › "G1, H1–H6 …" (`dayProgress` over what `useDay` reads); `jest` log-meal › "Today shows your own meals…". Checklist step 7.                                                                                                                                                                                                |
| I2  | Health shows no fake steps/sleep numbers (Phase 3)                                 | ✅     | `jest` phase2-screens › "I2: … Today: the steps and sleep rings are empty and say why" · "Health: Steps and Sleep cards show no numbers…"                                                                                                                                                                                         |
| I3  | Today's totals roll over at Europe/London midnight, incl. the clock-change weekend | ✅     | `jest` phase2-screens › "I3: Today rolls over at Europe/London midnight" (an ordinary night; Sun 25 Oct 2026, 25 hours; Sun 29 Mar 2026, 23 hours) · "londonDayRange: 24, 25 and 23 hours". **Fixed:** Health never rolled over (no clock); both screens now refresh on the minute and when the app comes back to the foreground. |

## J · Accessibility and checks

| ID  | Criterion                         | Status | Proof                                                                                                                                                                                                                                                                                                |
| --- | --------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | VoiceOver                         | ✅     | Passed on your iPhone, Sun 8 Nov. Every control has a role and label (jest tests find them by role and name).                                                                                                                                                                                        |
| J2  | largest text size                 | ✅     | Passed on your iPhone, Sun 8 Nov.                                                                                                                                                                                                                                                                    |
| J3  | all automated checks and CI green | ✅     | Sun 8 Nov 2026: lint, format:check, typecheck, `npm test` (53 + 42 + 13 + 146), test:db, test:integration (42), test:e2e (19, three runs back to back), deno check both functions, expo export ios/android/web, doctor against the local stack; CI on PR #7 green. Details in `docs/TEST-REPORT.md`. |

## K · Close-out

| ID  | Criterion                                      | Status | Notes                                                                   |
| --- | ---------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| K1  | every ☐ ticked or moved to a named later phase | ✅     | C1 and C2 moved to phase 7 (Sun 8 Nov); J1 and J2 passed on your phone. |
| K2  | PR #7 merged by you                            | ✅     | Merged Sun 8 Nov.                                                       |
| K3  | deferred items recorded                        | ✅     | Below and in `docs/SPEC-QUESTIONS.md`.                                  |

**Deferred (K3)**

| Item                                            | Where it's described                  | Phase                                                                        |
| ----------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| App Attest native module                        | SPEC-QUESTIONS Q-DEVICECHECK-IOS      | 7 (TestFlight: device checks on in production)                               |
| Real breach dataset on the hosted database      | SPEC-QUESTIONS Q-BREACH               | 7 (before anyone but you signs up)                                           |
| Email provider                                  | SPEC-QUESTIONS "Open questions" 2     | 7 (Mailpit is local only; real email is needed for TestFlight)               |
| Web hosting, web Apple/Google (D3)              | SPEC-QUESTIONS Q-HOSTING              | 7                                                                            |
| Development build and Google on iPhone (C1, C2) | your Apple Developer account          | 7 (TestFlight)                                                               |
| Android Apple/Google screens                    | SPEC-QUESTIONS Q-ANDROID (decision 9) | the Android release, after phase 7 (the plan is iOS, then web, then Android) |

## Morning checklist (Phase 2 sign-in)

About 30 minutes. Mac on the same Wi-Fi as the iPhone; Docker Desktop running; Expo Go on the
iPhone. Mailpit (for codes) is `http://127.0.0.1:54324` on the Mac. "→ 0x" is the screen you
should see next.

1. **Set up (A1).** In `supabase/functions/.env` make sure `APPLE_BUNDLE_ID=host.exp.Exponent`.
   In `apps/mobile/.env.local` set `EXPO_PUBLIC_SUPABASE_URL=http://<ipconfig getifaddr en0>:54321`,
   the Publishable key from `npx supabase status`, and `EXPO_PUBLIC_DEVICE_CHECKS=off`. Then, from
   the repo root:

   ```bash
   git pull
   npm install
   npx supabase stop
   npx supabase start
   npx supabase db reset
   ```

   In a second window, and leave it running:

   ```bash
   npx supabase functions serve --env-file supabase/functions/.env
   ```

   In a third window:

   ```bash
   npm run doctor
   npm run mobile -- --clear
   ```

   ✔ doctor ends "All good." (every line ✓). Scan the QR code with the iPhone camera → **0a**.

2. **Email create (B1).** Tap **Create account** → **0b-1** → **Continue with email** → **0b-3**.
   Type `you+1@example.test`, a 15+ character password twice → **Create account** → **0b-4**. Copy
   the code from Mailpit, paste it into the first box → **0b-4g** "Email confirmed" → **Continue** →
   **0c**.
3. **Onboarding (G1).** **0c** tap **Yes, use my health data** → **0d** **Continue** → **0e**
   **Continue** → **0f** **Allow notifications** (allow in the iOS prompt) → **0g** type a first
   name → **Go to Today** → **Today (1B)** with your name. Me shows Apple Health, Screen Time and the
   nudges as you chose.
4. **Email sign-in (B2).** Me → **Sign out** → **0a** → **Sign in** → **0b-2** → **Continue with
   email** → **0b-5**. Your email, a wrong password → **Sign in** → **0b-5d** (password cleared,
   email kept). Right password → **Today**. Sign out, then `nobody+1@example.test` with any password
   → **0b-6d** "We don't recognise that account" (0b-5e is the short form for an Apple relay
   address).
5. **Apple (B3).** Sign out → **0a** → **Create account** → **Continue with Apple** → Apple's sheet →
   Face ID → **0c** (go through to Today as in step 3, or **Not now** → **0e**). Me → **Sign out** →
   **Sign in** → **Continue with Apple** → **Today**.
6. **Google in Expo Go (B5).** Sign out → **Sign in** → **Continue with Google** → the note "Google
   sign-in needs a development build", still on **0b-2**; no Google page opens.
7. **Log meal, Today, barcode (H1, H2, I1).** Signed in (step 2's account). **+ Log meal** → **7a** →
   **+ Build a meal from scratch** → **7b**. Add a food by search, then **Scan** a real product
   from your cupboard → **7d** "how much" with the credit "Food data from Open Food Facts (ODbL)" →
   add it. Name the meal, turn on **In my daily plan**, set a time → **Save to my roster** → **Done ·
   log meal**. ✔ Today's kcal ring and timeline show it at the right time. Health → **+ 250 ml** →
   water goes up by 250 ml on Today too.
8. **Network error (E3).** Expo Go loads the app itself over Wi-Fi from your Mac, so turning Wi-Fi
   off would stop the app, not test it. Cut only the API instead (same network error in the app).
   On the Mac:

   ```bash
   docker stop supabase_kong_life-os
   ```

   In the Metro window press `r` (reload) → "Couldn't load your data" → **Try again** → still
   there. Then:

   ```bash
   docker start supabase_kong_life-os
   ```

   **Try again** → **Today**. (In a development build, Wi-Fi off/on in Control Centre works the
   same way.)

9. **After a reset (A4).** On the Mac: `npx supabase db reset`. Back in the app tap the **Health** tab → **0a**
   by itself, no message. Sign in with Apple → **0b-8i** "We don't recognise
   that account" with the development note "Local data was reset? …" — correct, the reset erased it.
   **Create account with Apple** → **0c**.
10. **Google on iPhone (C2) — only with a development build (C1).** In the development build:
    **Create account** → **Continue with Google** → Google's page → **0c**. Sign out → **Sign in** →
    **Continue with Google** → **Today**. Sign out → **Create account** → **Continue with Google**
    with the same Google account → **0b-8h** "An account already exists for this email" → **Sign in
    with Google** → **Today**. With step 2's email as a Google account: **Sign in** → **Continue with
    Google** → **0b-6e** "This email uses a password".
11. **VoiceOver (J1).** Settings → Accessibility → VoiceOver on. On 0a, 0b-5, 0c, Today and 7a
    swipe through every control: each is read with a name and a role ("button", "tab"); the rings
    read "Calories: … of …". VoiceOver off.
12. **Largest text (J2).** Settings → Accessibility → Display & Text Size → Larger Text → largest
    size. 0a, 0b-5, 0c, Today, 7a and Me: nothing cut off or overlapping; buttons still tappable.
    Back to the default size.

Done: J1 and J2 passed on Sun 8 Nov; C1 and C2 moved to phase 7; K1 and K2 done.

## L · Log meal: Saved tab and batches

Follow-up to 7a–7e, built on `claude/log-meal-saved-batches` from the decisions doc
(`claude/log-meal-saved-and-batches-decisions.md`, Sun 8 Nov) and the 14 wireframes "Log meal
Saved & batches". Tests: `jest` = `apps/mobile/src/__tests__/saved-batches.test.tsx`; `core` =
`packages/core/src/batch.test.ts`; `pgTAP` = `supabase/tests/08_batches.test.sql`; `e2e` as above.

| ID  | Criterion                                                                                                                                                                        | Status | Proof                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | 7b "Save to roster only" saves through `save_meal` with the plan switch and usual time, and writes no meal log                                                                   | ✅     | `e2e` › "L1: …"; `jest` › "7b-R … save-only chosen: plan switch and usual time; saves through save_meal and logs nothing" · "default: …"                                                                                     |
| L2  | a batch is your own food with per-100 g = ingredient totals ÷ cooked weight; the server's numbers equal core's (estimated and weighed)                                           | ✅     | `e2e` › "L2–L7: …" (`listBatches` = `summariseBatch`, 1,020 g estimated → 140 kcal; weighed 1,310 g → 109 kcal); `pgTAP` 08_batches; `core` › "per 100 g"                                                                    |
| L3  | the server doesn't trust client maths: tampered per-100 g or estimate refused; batch rows and ingredients can't be changed outside `save_batch`                                  | ✅     | `e2e` › "L2–L7: …" (Data API `rpc/save_batch` 400 "nutrition for this batch has changed"; direct PATCH/POST 42501); `pgTAP` 08_batches (tampered, missing, wrong estimate, "as added" ≠ × 1, too light, guard, composite FK) |
| L4  | log a batch on its own in grams (7h), last time pre-filled; liquids: 1 ml = 1 g                                                                                                  | ✅     | `e2e` › "L2–L7: …" (100 g → 109 kcal, last time 100 g); `jest` › "7h … solid" · "liquid"                                                                                                                                     |
| L5  | a batch is a component of a meal like any food, with the BATCH tag (7b-B)                                                                                                        | ✅     | `e2e` › "L2–L7: …" (meal with 350 g of the batch + eggs); `jest` › "7b-B …"                                                                                                                                                  |
| L6  | cook again (7g): last time's ingredients pre-filled; totals and per-100 g recalculate; meals already logged keep their snapshot; nothing in history is rewritten                 | ✅     | `e2e` › "L2–L7: …" (past log stays 109 kcal, new log 140, stale client refused); `pgTAP` (snapshot kept); `jest` › "7g … unchanged" · "one ingredient changed" · "taken out … deleted"                                       |
| L7  | Saved tab (7a-S): saved meals and batches together, starred first then A–Z; a star per row, read by VoiceOver as "… : starred" / "… : not starred"                               | ✅     | `e2e` › "L2–L7: …" (stars saved, order after a relaunch); `jest` › "7a-S … Saved — filled" · "Saved — empty" · "Plan & recent" · `sortSaved`                                                                                 |
| L8  | another user can't see, search, star, cook again or log any of it                                                                                                                | ✅     | `e2e` › "L8, L9: …"; `pgTAP` 08_batches (B sees nothing, can't cook again, can't attach ingredients)                                                                                                                         |
| L9  | consent off refuses batch writes and hides batches (health data); turned back on, they're all still there                                                                        | ✅     | `e2e` › "L8, L9: …"; `pgTAP` 08_batches; `jest` › "consent off: no Saved tab, no batches loaded"                                                                                                                             |
| L10 | cooked weight: a small, conservative ratio table; how each ratio was chosen is shown and can be corrected per ingredient; "I weighed it" replaces the estimate; nothing invented | ✅     | `core` › "the ratio table" · "guessCooksAs" (27 names) · "cooked weight" · "explainEstimate"; `jest` › "7f … building → estimated → weighed" · "the ratio is visible and correctable"                                        |
| L11 | every new wireframe state: layout, hierarchy and copy                                                                                                                            | 📱     | `jest` saved-batches (one or more tests per state, 19 in all); looked at in a browser against the local stack. Checklist below.                                                                                              |
| L12 | VoiceOver and the largest text size on the new screens                                                                                                                           | 📱     | Role and label on every control (the jest tests find them by role and name). Checklist steps 8–9.                                                                                                                            |
| L13 | all automated checks and CI green                                                                                                                                                | ✅     | `docs/TEST-REPORT.md` › "Log meal: Saved tab and batches".                                                                                                                                                                   |

**Readings taken** (also in the PR):

- **Ratios.** As briefed, only clear cases: dry rice × 2.5, dry pasta × 2.25, oats × 2.5, dry
  lentils × 2.5, couscous × 2.25, quinoa × 2.75; raw meat and raw poultry × 0.75, raw fish × 0.8.
  Everything else counts as its own weight — including eggs and peas, which the wireframe shows at
  × 0.9, so the wireframe's "≈ 1,240 g" example comes out as ≈ 1,270 g. A dry staple counts unless
  its name says cooked, tinned, fresh or another product (rice cakes, oat milk, noodles); meat,
  poultry and fish only when the name says "raw" (shops sell both). Estimates are rounded to the
  nearest 10 g, as in the wireframes.
- **Correcting a ratio.** 7f shows "How we worked it out: …" as drawn, plus "Tap an ingredient to
  change this."; the ingredient's "how much" screen has an "In the pot" row (As added, Dry rice ×
  2.5, …). The choice is stored per ingredient (`batch_ingredients.cooks_as`, `cooked_ratio`).
- **"Building" vs "estimated" (7f).** A new batch uses the building layout (grey "Add ingredient"
  panel, "Batch so far", "≈ … g so far") until it has three ingredients, then the full card with
  "I weighed it". Cook again always shows the full card.
- **Counts.** The wireframes show "Test eggs, large · 2 (120 g)" and "2 → 1". The app has no count
  units, so batches are in grams like everything else ("120 g → 60 g"); soy sauce shows 30 g (1 ml =
  1 g). "One egg fewer" becomes "Test eggs, large 120 g → 60 g."
- **Liquid batches** (7h's "1 ml counts as 1 g") are those whose name says soup, broth, stock,
  smoothie, shake, juice, drink, gravy or sauce. It only changes that line.
- **Per-100 g rounding.** Stored like every macro: whole kcal and 1 dp (that's what reproduces 7h's
  "350 g → 476 kcal · P 14.0"). Fibre, sugar and salt stay unknown (`null`) for batches.
- **Cook again** updates the batch in place (same food, so "last time" amounts and roster meals
  using it carry on). The weighed field starts empty for the new pot, with "Last time you weighed
  1,310 g." A batch can't contain another batch. "Delete batch" is a small link at the bottom of 7g
  (the decisions say batches stay until deleted; no wireframe shows where); a batch used in a saved
  meal must be taken out of that meal first.
- **Saved tab rows**: plan meals read "In plan · 19:00 · 850 kcal · P 52", other meals "2 components ·
  …", batches "136 kcal per 100 g · cooked Sun 8 Nov". Tapping a meal opens it for editing (7b
  edit, as from the roster), tapping a batch opens 7g. "Log" on a batch opens 7h.
- **Save to roster only** starts with "In my daily plan" off; turning it on fills the usual time
  with the slot's time. After saving you land on the Saved tab with the new meal.
- After "Save and log some" the app goes to 7h for the new batch; "Save batch only" and "Save batch"
  go back to 7a on the Saved tab ("Updated per 100 g").

### Morning checklist (Saved tab and batches)

About 15 minutes, signed in on your iPhone with health data on. First bring your local database up
to date (from the repo root):

```bash
git pull
npm install
npx supabase stop
npx supabase start
npx supabase db reset
```

In a second window, and leave it running:

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

In a third window:

```bash
npm run doctor
npm run mobile -- --clear
```

`db reset` erases local accounts: create one again (email → code from Mailpit → 0c → … → Today).

1. **Save to roster only (7b-R).** Today → **+ Log meal** → **7a** (Plan & recent tab) → **+ Build a
   meal from scratch** → **7b**. Name it "Chicken stir-fry", add two foods. ✔ Under "Done · log
   meal" there's **Save to roster only**. Tap it → header says **Not logging**, the card says "Not
   added to today. Log it from Saved when you eat it." Turn on **In my daily plan**, set **19:00** →
   **Save meal** → **7a, Saved tab** with Chicken stir-fry. ✔ Today's kcal ring hasn't moved.
2. **Saved tab (7a-S).** ✔ Meals and the stir-fry together; **A–Z** heading. Tap the ☆ next to
   Chicken stir-fry → it moves under **STARRED**. Tap ★ → back into A–Z.
3. **New batch (7f building).** On 7a tap **+ Cooked a batch** → **7f** ("New batch" top right).
   Name it "Egg fried rice". **Search** → a rice whose name says dry, e.g. add it from the label as
   "Rice, dry" (350 kcal, P 7, C 78, F 0.6) → 360 g; ✔ "In the pot" shows **Dry rice × 2.5**
   selected → **Add ingredient**. Add eggs 120 g. ✔ "BATCH SO FAR" and "≈ 1,020 g so far".
4. **Estimated → weighed (7f).** Add a third ingredient (e.g. peas 200 g). ✔ "WHOLE BATCH", "≈ … g
   estimated", "How we worked it out: dry rice × 2.5 (it soaks up water), the rest as added." and
   "Per 100 g cooked: …". Type **1310** in **I weighed it** → ✔ "1,310 g weighed", "Using your
   weight. Estimate was ≈ … g." (struck through), per 100 g changes. Clear it → back to the estimate;
   type 1310 again.
5. **Save and log some (7h).** **Save and log some** → **7h** "Egg fried rice BATCH · Your batch ·
   cooked Sun 8 Nov · weighed 1,310 g". Type **350** → ✔ tiles and "350 g × per-100 g values ÷ 100 ·
   weigh what's on your plate"; **Log it · … kcal** → **Today**: the kcal ring and timeline show it.
6. **Batch as a component (7b-B).** **+ Log meal** → **+ Build a meal from scratch**. ✔ "+ Egg fried
   rice BATCH · 350 g" is suggested, with "Your batches show up in suggestions and search, like any
   food." Tap it, add one more food → **Done · log meal** → Today.
7. **Cook again (7g).** **+ Log meal** → **Saved** → tap **Egg fried rice** → **7g** ("‹ Saved",
   "Cook again"). ✔ "INGREDIENTS · SAME AS LAST TIME", "Last time you weighed 1,310 g.". Tap the eggs
   row → 60 → **Update ingredient** → ✔ the row is shaded "120 g → 60 g", "INGREDIENTS · 1 CHANGED",
   "Was 1,… kcal …", "Was ≈ … g. Test eggs … 120 g → 60 g." → **Save batch** → Saved tab. ✔ Today's
   totals from steps 5–6 didn't change.
8. **VoiceOver (L12).** VoiceOver on. On 7a's Saved tab swipe through: the tabs read "Plan & recent,
   tab" / "Saved, tab, selected"; each star reads "Egg fried rice: starred, button" (or "not
   starred"); "Cook Egg fried rice again, button"; "Log Egg fried rice, button". On 7f and 7h every
   control is read with a name. VoiceOver off.
9. **Largest text (L12).** Largest text size: 7a Saved tab, 7f, 7g and 7h — nothing cut off or
   overlapping, buttons still tappable. Back to the default size.

Tick 📱 → ✅ for L11 and L12 when done.

## M · Log meal: custom time, edit and delete, g or ml

Follow-up to 7a–7h, built on `claude/log-meal-time-edit-units` from the decisions doc
(`claude/log-meal-time-edit-units-decisions.md`, Mon 9 Nov) and the wireframes "Log meal Custom
time & edit" (7a-T, 7i, 7b-T, 7j, 7k, 7l, 1B before/after, flow strip) and the "-U" frames for g
or ml (7d-U, 7e-U, 7h-U, 7j-U, 7k-U, flow strip). Tests: `jest` =
`apps/mobile/src/__tests__/time-edit-units.test.tsx` (7h-U in `saved-batches.test.tsx`); `core` =
`packages/core/src/mealedit.test.ts` and `logwindow.test.ts`; `pgTAP` =
`supabase/tests/09_log_meal_time_edit_units.test.sql`; `functions` =
`supabase/functions/food-lookup/mapping.test.ts`; `e2e` as above (T1–T10).

| ID  | Criterion                                                                                                                                                           | Status | Proof                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | "Other time…" beside Now and the slots (7a-T); a bottom sheet with 24-hour hour and minute wheels and Today / Yesterday (7i); the chosen time in 7b's header (7b-T) | ✅     | `jest` › "7a-T “Other time…” offered …" · "7i default …" · "7i a past time on Yesterday …" · "7a-T custom time chosen → 7b-T time in the header → 1B …"                                      |
| M2  | earliest yesterday 00:00, latest one hour from now; later times greyed out and held to the limit in the app                                                         | ✅     | `jest` › "7i more than an hour ahead …"; `core` › "7i Pick a time" · "day boundaries" (midnight, 23:59, summer time, both 2026 clock changes)                                                |
| M3  | the same window enforced by the server, whatever the client sends                                                                                                   | ✅     | `e2e` › "T2: …" (app and raw Data API refused); `pgTAP` 09 (log_meal, retime, direct writes)                                                                                                 |
| M4  | a meal at a custom time counts towards its Europe/London day and sits on the timeline in time order                                                                 | ✅     | `e2e` › "T1: …"; `jest` › "… 1B placed in time order" · "a meal logged for yesterday counts towards yesterday, not today"                                                                    |
| M5  | tapping a logged meal on Today opens it read-only (7j) with "Edit meal" and a quiet "Delete meal"; from the plan it says so                                         | ✅     | `jest` › "7j … ordinary …" · "from the plan …" · "logged meals open with a chevron …"                                                                                                        |
| M6  | edit (7k) changes name, time and each item's unit only; no edited label anywhere                                                                                    | ✅     | `jest` › "7k default …" · "name changed …" · "moved to yesterday (with saving) …"; `pgTAP` 09                                                                                                |
| M7  | rename and retime change only the log — the saved or plan meal it came from is untouched; moving to yesterday moves the totals                                      | ✅     | `e2e` › "T3, T4: …"; `jest` › "name changed …" · "moved to yesterday …"                                                                                                                      |
| M8  | amounts, components and macros can't be changed, even with a crafted request or straight to the Data API                                                            | ✅     | `e2e` › "T5: …" (extra keys in `update_logged_meal`, PATCH items, PATCH log, raw DELETE: all 42501, meal unchanged); `pgTAP` 09                                                              |
| M9  | delete (7l) with a confirmation; a meal logged from the plan makes that plan meal show as not eaten again                                                           | ✅     | `e2e` › "T6: …"; `jest` › "7l ordinary …" · "from the plan …" · "Cancel keeps the meal"; `pgTAP` 09                                                                                          |
| M10 | each food is per 100 g or per 100 ml: barcodes from Open Food Facts, manual entry has the choice, existing foods stay g                                             | ✅     | `e2e` › "T7, T8: …" (fake 330 ml shake → `nutrition_unit` ml, pack 330); `functions` › "Open Food Facts’ own basis wins …"; `jest` › "7e-U manual entry per 100 ml …"; `pgTAP` 09 (defaults) |
| M11 | "how much" (7d, 7h) has a g / ml switch defaulting to the food's unit; the other unit counts 1 ml as 1 g with the quiet "≈" line                                    | ✅     | `jest` › "7d-U drink in ml …" · "7d-U drink switched to g …" · "7h-U soup in ml …"; `core` › "g or ml"                                                                                       |
| M12 | last-time amounts, logged items, the timeline, 7j and 7k show amounts in their own unit; switching a logged item's unit in 7k changes no numbers                    | ✅     | `e2e` › "T7, T8: …"; `jest` › "7j-U …" · "7k-U …" · "7d-U drink switched to g …" (last time stays in ml)                                                                                     |
| M13 | another user can't see, edit or delete any of it; consent off refuses edits and deletes                                                                             | ✅     | `e2e` › "T9, T10: …"; `pgTAP` 09; `jest` › "consent off: edits and deletes are refused by the backend"                                                                                       |
| M14 | every new wireframe state: layout, hierarchy and copy                                                                                                               | 📱     | `jest` (one or more tests per state, 22 + 7h-U); looked at in a browser against the local stack. Checklist below.                                                                            |
| M15 | VoiceOver (the wheels adjustable by swiping) and the largest text size on the new screens                                                                           | 📱     | Role and label on every control; the wheels are `adjustable` (jest swipes them). Checklist steps 9–10.                                                                                       |
| M16 | all automated checks and CI green                                                                                                                                   | ✅     | `docs/TEST-REPORT.md` › "Log meal: custom time, edit and delete, g or ml".                                                                                                                   |

**Readings taken** (also in the PR):

- **The wheels** are built from React Native's `ScrollView` (snaps to rows; tap a row; mouse wheel
  and trackpad on the web; one `adjustable` control each for VoiceOver). The Expo date-time picker
  has no web version and the Expo picker can't strike out times past the limit, as 7i draws.
- **Slots more than an hour ahead** (e.g. Dinner 18:15 at 13:40) are shown but greyed and can't be
  chosen, and the default slot is never one of them (it was Snack 16:00 at 13:40 before): the
  server would refuse them. 7a-T draws them like the others.
- **The window applies to edits and deletes too**: a meal from before yesterday is history (7j
  shows it without Edit or Delete). The new time must also be in the window.
- **7k toggles**: the plain 7k frames have no unit switch; 7k-U does. The edit screen always shows
  the per-item g / ml switch with 7k-U's "COMPONENTS · AMOUNTS LOCKED" header; the "≈ 1 ml counts
  as 1 g, so switching only fixes the label." line appears once an item has been switched.
- **Where Save goes**: a new time goes back to Today (to see the meal in its place, as the main
  flow strip shows); a name or unit change goes back to 7j (as the -U strip shows). Cancel goes
  back.
- **7j "From your plan"**: there are no plan names in the data ("Plan A" is sample-only) and the
  app doesn't record whether a plan meal was logged with "Ate it" or from 7a, so 7j says "From your
  plan · Lunch" / "Logged from your plan". A meal from a saved (non-plan) meal says "From your
  saved meals".
- **7l wording for yesterday**: "Sun 8 Nov now / after" instead of "Today now / after".
- **The "after this meal" bars** (7b, 7d, 7h) follow the meal's own day: "Sun 8 Nov after this
  meal" for a time picked on yesterday.
- **7d-U footer**: "From Open Food Facts · nutrition per 100 ml." as drawn, keeping the existing
  "Wrong values? …", "Edit values" and the ODbL credit. A drink's pack is a "bottle" ("330 ml
  bottle", "Half bottle · 165 ml").
- **Batch ingredients stay in grams** (there's no unit on `batch_ingredients`); the switch is on
  meal components and on logging a batch (7h-U).
- **Pack and serving sizes in ml are kept** (in the food's unit) instead of being dropped.
- **Open Food Facts basis**: its stated basis wins (v3.5 packaging input set, or
  `nutrition_data_per` "100ml"); "100g" is OFF's generic word, so then the pack's unit decides.
- **1B's dashed box** is the designer's highlight and isn't built.
- **Edits and deletes only through functions**: besides `update_logged_meal` and
  `delete_logged_meal`, guard triggers refuse any direct update or delete of logged meals or their
  items by app users (the account-erase job and foreign-key actions run as the owner and are
  unaffected).

### Morning checklist (custom time, edit and delete, g or ml)

About 15 minutes, signed in on your iPhone with health data on. First bring your local database up
to date (from the repo root):

```bash
git pull
npm install
npx supabase stop
npx supabase start
npx supabase db reset
```

In a second window, and leave it running:

```bash
npx supabase functions serve --env-file supabase/functions/.env
```

In a third window:

```bash
npm run doctor
npm run mobile -- --clear
```

`db reset` erases local accounts: create one again (email → code from Mailpit → 0c → … → Today).

1. **Other time… (7a-T).** Today (`screen-today`) → **+ Log meal** → `screen-log-meal`. ✔ Under
   WHEN: **Now · hh:mm** (selected), the four slots, **Other time…**; slots more than an hour away
   are greyed.
2. **Pick a time (7i).** Tap **Other time…** → `sheet-7i` "Time eaten". ✔ **Today** selected, the
   wheels on now, "Any time from yesterday 00:00 up to …" (an hour from now). Spin the hour wheel
   past the limit → ✔ later hours struck through; it settles on the latest and "Latest is …. That's
   an hour from now, …" appears.
3. **Yesterday.** Tap **Yesterday** → set **21:15** → ✔ "Yesterday · Sun … · 21:15" and "Counts
   towards …'s totals, not today's." Tap **Today**, set **06:40** → **Done** → ✔ the chip reads
   **Today · 06:40 ▾**.
4. **Chosen time in the header (7b-T).** **+ Build a meal from scratch** → `screen-build-meal`. ✔
   Top right **Today · 06:40 ▾** (tap it: the sheet opens on 06:40; **Cancel**). Add a food →
   **Done · log meal** → `screen-today`. ✔ The meal sits at 06:40 in time order; the kcal ring
   includes it.
5. **Open it (7j).** ✔ Logged meals have a **›**. Tap the 06:40 meal → `screen-7j`: "‹ Today",
   LOGGED MEAL, the name, "Mon 9 Nov · 06:40", components, MEAL TOTALS, **Edit meal** and a quiet
   **Delete meal**.
6. **Edit (7k) and move to yesterday.** **Edit meal** → `screen-7k`. ✔ **Save changes** is grey.
   Change the name; **Change ›** → **Yesterday** → 21:30 → **Done** → ✔ the grey note "Moves to Sun
   …. Today goes down by … kcal (… → …). Sun … goes up by … kcal." **Save changes** → ✔ "Saving…",
   then Today without the meal and the kcal ring down by that much.
7. **A plan meal (7j, 7l).** On Today tap **Ate it** on a plan meal → tap it → `screen-7j` ✔ "From
   your plan · Lunch" and "Renaming or retiming here doesn't change the plan meal." **Delete meal**
   → `sheet-7l` ✔ "Delete …?", Today now / Goes down by / Today after, "Lunch goes back on your plan
   as not eaten." and when "Ate it" comes back → **Delete meal** → ✔ Today shows **Ate it** again.
8. **g or ml (7d-U, 7k-U, 7e-U).** **+ Log meal** → **+ Build a meal from scratch** → **Scan** → a
   real drink (or type a barcode) → `screen-how-much`. For a drink sold in ml: ✔ "Per 100 ml: …",
   the field in **ml** with the **g | ml** switch beside it. Tap **g** → ✔ "≈ 1 ml counts as 1 g",
   same kcal. Add it, log the meal, open it → **Edit meal** → switch that item to **ml** → ✔ the
   numbers don't change; **Save changes** → 7j shows "… · 330 ml". Back on 7b, **Manual** → "Not
   found? Add it from the label" → `screen-manual-entry`: ✔ "The label gives values" with **per 100
   g | per 100 ml**; pick ml → the amount is in ml and "Saved as per 100 ml".
9. **VoiceOver (M15).** VoiceOver on. In 7i: the tabs read "Today, Mon 9 Nov, tab, selected"; each
   wheel reads "Hour, 13, adjustable" — swipe up/down to change it (it stops at the latest); "Done,
   Today · Mon 9 Nov · 13:40, button". In 7k each item reads "…, 330 g, locked" and the switch "…
   in grams, radio button, checked". On Today a logged meal reads its time, name and "Opens the
   meal". VoiceOver off.
10. **Largest text (M15).** Largest text size: 7a, 7i, 7j, 7k, 7l and how much — nothing cut off or
    overlapping, buttons still tappable. Back to the default size.

Tick 📱 → ✅ for M14 and M15 when done.
