# Sign-in v3 — spec gaps and open questions

Where the spec (`docs/sign-in-spec.md`) and Supabase disagreed, or the spec didn't say, the build
took the more secure option, the spec was updated to match, and the gap is logged here: what the
spec said, what Supabase allows, what was built, and why. "Open" items need a decision from you.

## Changes forced by Supabase (built, spec updated)

### Q-HASH · Password hashing (spec 5.4)

- **Spec:** Argon2id (m = 64 MiB, t = 3, p = 1) with a KMS-held pepper.
- **Supabase:** Supabase Auth stores passwords with bcrypt and has no setting to change it. Decision
  1 keeps Supabase Auth.
- **Built:** `auth-api` sends Supabase Auth `base64url(HMAC-SHA256(pepper, NFKC(password)))`
  instead of the password. The stored hash is bcrypt over that value. The pepper is an edge
  function secret (`AUTH_PASSWORD_PEPPER_V1`, `_V2`, …), its version is kept per account, and sign-in rehashes onto
  the newest version.
- **Why:** a database leak alone can't be cracked offline without the pepper; the fixed 43-character
  input also removes bcrypt's 72-byte cut-off, so a 128-character password counts in full.
- **Open:** move the pepper to a KMS-backed secret when hosting is chosen.

### Q-MINT · Issuing a session after our own checks

- **Spec:** the auth service issues tokens.
- **Supabase:** Supabase Auth has no admin call that issues a session for a user.
- **Built:** after `auth-api`'s checks pass, it writes a one-time `ISSUE_SESSION` permit, generates a
  link with the admin `generateLink` API (which sends nothing) and verifies it straight away on the
  server. The custom-access-token hook refuses any session without a permit, so the link mechanism
  can't be used from outside. Nothing is ever emailed — there are still no magic links for users.
- **Why:** the only server-side route to a real Supabase session that keeps all our rules in front.

### Q-REFRESH · Refresh-token reuse (spec 8.1)

- **Spec:** any reuse of an old refresh token revokes the family and pages someone.
- **Supabase:** rotation is built in, but the parent of the current token is still accepted (it
  returns the active token), even with the reuse interval at 0.
- **Built:** only `auth-api` refreshes (needs a `REFRESH_SESSION` permit). It records a hash of every
  refresh token it has handed out (`auth_refresh_hashes`); presenting any non-current one revokes the
  session and logs `auth.refresh.reuse`.
- **Why:** matches the spec exactly.

### Q-PWCHANGE · Password change response (spec 3.2 `POST /v1/me/password`)

- **Spec:** `204`, this session's tokens rotated, all others revoked.
- **Supabase:** changing a password through the admin API signs out every session, this one included.
- **Built:** `200 {tokens}` — fresh tokens for this device are minted in the same call. On web the
  cookie server turns them into cookies, so the browser still never sees them.
- **Why:** the only way to keep "this device stays signed in" (assumption 13).

### Q-LIFETIMES · Session lifetimes (spec 8.1)

- **Spec:** web idle 7 / absolute 30 days, phone 30 / 90.
- **Supabase:** time-box and inactivity settings are Pro-only and one value for all clients.
- **Built:** the custom-access-token hook and `auth-api`'s refresh check enforce per-platform lifetimes
  from `auth_session_meta`.

### Q-PREREQUEST · Revocation takes effect at once (spec 8.1)

- **Spec:** `token_epoch` and a revoked-session list checked on every API call.
- **Supabase:** access tokens stay valid until they expire. PostgREST's `db_pre_request` can check
  every Data API request, but Supabase notes it doesn't cover Storage or Realtime.
- **Built:** `public.check_request` refuses any request whose session no longer exists, and every
  `PENDING_DELETION` request. Sign-out, reset and "sign out everywhere" delete the Supabase sessions,
  so the next Data API call fails at once (pgTAP + integration tests).
- **Open:** when Storage or Realtime is used (not yet), call the same check from their RLS policies.

### Q-MINLEN · Password length (spec 5.1)

- **Supabase:** a minimum length setting, no maximum.
- **Built:** `minimum_password_length = 15`; `auth-api` enforces the 128 maximum, counted in NFKC
  code points, with the same core function the app uses.

### Q-BREACH · Breach dataset (spec 5.3)

- **Spec:** a locally hosted copy of Pwned Passwords, refreshed monthly.
- **Supabase:** leaked-password protection calls the HIBP API and needs the Pro plan.
- **Built:** `auth_breached_hashes` (SHA-1, k-anonymity range endpoint padded to a constant size).
  Locally it holds a fake fixture (`supabase/fixtures/breached-passwords.sql`).
- **Open:** load the real dataset. Source: the Pwned Passwords downloader
  (`github.com/HaveIBeenPwned/PwnedPasswordsDownloader`, SHA-1 mode), imported monthly into
  `auth_breached_hashes` by a job outside the app. It's about 1 billion rows (~40 GB), so check the
  hosted database size first; storing only hashes seen ≥ 2 times is a fallback.

### Q-GOOGLE-IOS · Google on iPhone (spec 2.7)

- **Spec:** Google Sign-In SDK with PKCE + nonce.
- **Supabase/Expo:** the Google Sign-In package for Expo (`@react-native-google-signin`) has no way to
  pass a nonce, and the old setup needed `skip_nonce_check`, which the brief removes.
- **Built:** iPhone uses Google's browser flow in `ASWebAuthenticationSession` (code + PKCE +
  nonce). The ID token is verified with the server's nonce like every other provider. The package
  was removed.
- **Why:** a nonce on every ID token. The permission alert (0b-8b) and sheet (0b-8c) still appear.

### Q-KEYCHAIN · iPhone token storage (spec 8.2)

- **Spec:** `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.
- **Built:** `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (expo-secure-store) — stricter. Nothing refreshes in the
  background yet. Revisit in phase 6 if notifications need a token while the phone is locked.

### Q-WEBCOOKIE · Web cookies (spec 8.2)

- **Spec:** one `__Host-lifeos_sid` cookie, `SameSite=Lax`.
- **Built:** `__Host-lifeos_at` and `__Host-lifeos_rt` (httpOnly, Secure, `SameSite=Strict`), an
  httpOnly device-ID cookie and a readable double-submit CSRF cookie, plus an Origin check. The web
  server swaps every token body for `{session: {user, scope}}`.
- **Why:** Strict is safer and nothing needs cross-site navigation into a signed-in page (the reset
  link opens a page that needs no session).

### Q-DEVICECHECK-IOS · App Attest on iPhone (spec 6)

- **Built:** the server side in full (attestation, receipts of the key, counter-checked assertions over
  `METHOD path\nbody`), one `DeviceCheck` interface, and the flag. The app sends no assertion yet,
  because no maintained Expo module for `DCAppAttestService` fits SDK 58, so iPhone requests count as
  "unsupported" and get the stricter 3-an-hour limits (spec 6.2).
- **Open:** add a small native module (Expo Modules API) in a dev build; the client already accepts one
  (`appAttestClient(module)`).

### Q-IP · Client IP

- Supabase Auth only sees `auth-api`'s IP. Our own limits use the IP `auth-api` receives
  (`X-Forwarded-For`, first hop). The web server forwards only the host-set client IP, never what a
  browser sent. On the hosted project, turn on Auth's **IP Address Forwarding** (`Sb-Forwarded-For`)
  as well.
- Supabase Auth keeps the IP and user agent in `auth.sessions`. We can't turn that off; it's listed in
  `docs/PRIVACY-POLICY-CHANGES.md`.

### Q-DELETE · Erasure

- **Built:** the day-30 job deletes the `auth.users` row; every user table cascades from it (pgTAP
  checks that no table is missed). The Apple revocation and "deleted" email are queued first.

## Gaps in the spec (decided, spec updated where it matters)

| ID        | Gap                                                                 | What was built                                                                                                                                              |
| --------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-GEOIP   | 8.4 wants a town from an on-premise GeoIP database. None is chosen. | No location yet; S-4 shows the label and last active time. **Open:** pick a database (e.g. a GeoLite2 City licence).                                        |
| Q-RISC    | 9.4 recommends Google RISC.                                         | Not built (recommended, not required).                                                                                                                      |
| Q-0B7J    | 0b-7j's button copy isn't given in the spec.                        | "Send a new link", which opens 0b-7a with the email filled in. Check against the canvas.                                                                    |
| Q-S3      | S-3b/S-3c settings paths for Apple and Google (assumption 16).      | Copy follows the spec's paths as of late 2026. Check before mid-fi.                                                                                         |
| Q-ANDROID | Decision 9: Android keeps building, sign-in screens later.          | Android builds and email sign-in works; Apple/Google buttons show 0b-8g ("That didn't work") until the Android flows are built; Play Integrity isn't built. |

## Open questions for you

1. **Q-HOSTING · Where the web app and its cookie server run.** The cookie server is Expo Router API
   routes (`web.output = "server"`). Options: **EAS Hosting** (Expo's own; simplest; check it can be
   kept in a UK/EU region for the privacy policy), **Cloudflare Workers** via `expo-server`'s adapter
   (UK/EU data localisation is an enterprise feature), or a **small Node server in London** with
   `expo-server`'s Node adapter. Recommendation: a Node server in the same region as Supabase, so
   tokens and IPs never leave the UK. **Phase 7**, with web Apple/Google (they need a real HTTPS
   address and an Apple Services ID; until then a development web build says so instead of 0b-8g).
2. **Email provider** (decision 11): needs a UK/EU region, a DPA, SPF/DKIM/DMARC `p=reject`, and
   registration with Apple's Private Email Relay. Anything that implements `EmailSender`. **Phase 7**
   (before TestFlight).
3. **Breach dataset size** on the hosted database (Q-BREACH). **Phase 7.**
4. **App Attest module** (Q-DEVICECHECK-IOS). **Phase 7** (device checks on for TestFlight).
5. **Android Apple/Google screens** (Q-ANDROID). With the Android release, after phase 7.

Phase 2 sign-off status for every criterion: `docs/PHASE2-SIGNOFF.md`.
