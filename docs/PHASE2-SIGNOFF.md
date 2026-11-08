# Phase 2 sign-off

Branch `claude/phase2-sign-in-v3` · PR #7 · updated Sun 8 Nov 2026.

Each criterion is one of:

- ✅ **automated** — a test proves it; the test is named (file › test name).
- 📱 **manual on your phone** — needs a person and a real iPhone. The tests that back it are listed;
  the steps are in the [morning checklist](#morning-checklist) at the end.
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

| ID  | Criterion                                                       | Status | Proof / what's needed                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | development build on your phone with your own `APPLE_BUNDLE_ID` | ☐      | Needs your paid Apple Developer account, your bundle id in `apps/mobile/app.json` and `npx expo run:ios --device` (or `npx eas-cli@latest build --profile development`). Nothing here can do that for you. If it isn't done before you merge, it moves to phase 7 (TestFlight). |
| C2  | Google create / sign in / wrong method / 0b-8h on iPhone        | 📱     | Server side ✅ `e2e` › "B3, C2: …" (Google create, sign out, sign in, 0b-8h one-tap) and "B6: …" (wrong method). Needs C1 first. Checklist step 10.                                                                                                                             |

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
| J1  | VoiceOver                         | 📱     | Every control has a role and label (jest tests find them by role and name). Checklist step 11.                                                                                                                                                                                                       |
| J2  | largest text size                 | 📱     | Checklist step 12.                                                                                                                                                                                                                                                                                   |
| J3  | all automated checks and CI green | ✅     | Sun 8 Nov 2026: lint, format:check, typecheck, `npm test` (53 + 42 + 13 + 146), test:db, test:integration (42), test:e2e (19, three runs back to back), deno check both functions, expo export ios/android/web, doctor against the local stack; CI on PR #7 green. Details in `docs/TEST-REPORT.md`. |

## K · Close-out

| ID  | Criterion                                      | Status | Notes                                                                |
| --- | ---------------------------------------------- | ------ | -------------------------------------------------------------------- |
| K1  | every ☐ ticked or moved to a named later phase | ☐      | Open: C1 (yours: development build). Everything else is ✅, 📱 or ⏭. |
| K2  | PR #7 merged by you                            | ☐      | Yours, after the checklist.                                          |
| K3  | deferred items recorded                        | ✅     | Below and in `docs/SPEC-QUESTIONS.md`.                               |

**Deferred (K3)**

| Item                                       | Where it's described                  | Phase                                                                        |
| ------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| App Attest native module                   | SPEC-QUESTIONS Q-DEVICECHECK-IOS      | 7 (TestFlight: device checks on in production)                               |
| Real breach dataset on the hosted database | SPEC-QUESTIONS Q-BREACH               | 7 (before anyone but you signs up)                                           |
| Email provider                             | SPEC-QUESTIONS "Open questions" 2     | 7 (Mailpit is local only; real email is needed for TestFlight)               |
| Web hosting, web Apple/Google (D3)         | SPEC-QUESTIONS Q-HOSTING              | 7                                                                            |
| Android Apple/Google screens               | SPEC-QUESTIONS Q-ANDROID (decision 9) | the Android release, after phase 7 (the plan is iOS, then web, then Android) |

## Morning checklist

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

Tick 📱 → ✅ above as you go. C1 open after this → it moves to phase 7, and K1 is done.
