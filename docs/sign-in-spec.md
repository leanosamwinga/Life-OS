# Life OS — Sign-in spec

Version 1 · 7 November 2026 · Status: ready for build review

This is the build spec for sign up, sign in and Me → Security. It is written for:

- the **Java backend engineer** building the auth service, and
- the **iOS, web and Android** engineers building the screens.

It follows the agreed decisions in `claude/sign-in-decisions.md`, which are fixed and not reopened here. Screen IDs (0a, 0b-1 … 0b-8i, S-1a … S-5j) refer to the canvas **Life OS — Sign up / Sign in wireframes v3**. Where this spec and a screen disagree, the screen's copy wins for wording and this spec wins for behaviour. Raise a flag if you find one.

UK only. British English in all copy.

---

## 0. Ground rules (read first)

1. **One sign-in method per email.** The method used to create the account (password, Apple or Google) is the only way in. Methods are **never linked automatically**, even when Apple or Google say the email matches.
2. **Never redirect on its own.** Branch messages (wrong method, not recognised, already exists) show a message plus a button. The person taps to move.
3. **Passwords are never shown, sent or carried.** Not in emails, links, error messages, logs, analytics, crash reports or confirmation screens. They are not carried between screens, and **both password fields clear after any error**. Only the email is kept.
4. **Errors never hint at the password.** No "close", no "tries left", no partial reveal.
5. **Branch messages appear only after a button is tapped**, never while typing.
6. **Security wins ties.** Where a choice affects security, this spec picks the more secure option and says why.
7. **Copy lives in the apps.** The API returns stable error codes, never display text. Section 3 gives the exact on-screen text for each code.

---

## 1. Account model and states

### 1.1 Tables

| Table | Key fields | Notes |
|---|---|---|
| `account` | `id` (UUIDv7), `email`, `email_norm`, `method` (`PASSWORD` · `APPLE` · `GOOGLE`), `status`, `step_up_required` (bool), `step_up_set_at`, `display_name` (nullable), `created_at`, `confirmed_at`, `password_changed_at`, `deletion_requested_at`, `deletion_due_at`, `email_deliverable` (bool, default true), `token_epoch` (int) | `email_norm` = trimmed, lower-cased email. Do not strip dots or `+tags`. Unique index on `email_norm` where `status <> 'DELETED'`. |
| `password_credential` | `account_id`, `hash` (PHC string), `updated_at` | Only for `method = PASSWORD`. |
| `federated_identity` | `account_id`, `provider` (`APPLE` · `GOOGLE`), `subject` (`sub`), `email_at_provider`, `is_private_relay` (bool), `apple_refresh_token_enc` (nullable), `created_at` | Unique on (`provider`, `subject`). Identity is always matched by `sub`, never by email. |
| `known_device` | `account_id`, `device_id_hash`, `platform`, `label`, `coarse_location`, `first_seen_at`, `last_seen_at` | `device_id` is a random 128-bit value the client creates once and keeps in secure storage (iOS Keychain, Android Keystore-encrypted storage, web `__Host-` cookie). Stored only as a SHA-256 hash. |
| `session` | `id`, `account_id`, `device_id_hash`, `refresh_family_id`, `refresh_hash`, `scope` (`FULL` · `PENDING_DELETION`), `created_at`, `last_used_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `revoke_reason`, `push_token_id` (nullable) | Backs S-4 (Signed-in devices). |
| `one_time_code` | `id` (= `challenge_id`), `account_id`, `purpose` (`CONFIRM_EMAIL` · `NEW_DEVICE`), `code_hmac`, `device_id_hash`, `expires_at`, `attempts`, `consumed_at`, `superseded_at` | The code is stored as HMAC-SHA256 under a server key, never in plain text. |
| `reset_token` | `token_hash` (SHA-256), `account_id`, `expires_at`, `used_at`, `superseded_at` | The token is 256 random bits, base64url. Only the hash is stored. |
| `auth_ticket` | `ticket_hash`, `kind` (`SIGN_IN_EXISTING` · `CREATE_FEDERATED`), `provider`, `subject`, `email`, `device_id_hash`, `expires_at`, `used_at` | Short-lived (2 minutes), single use, bound to the device. Used by 0b-8h and 0b-8i so the person doesn't pick their account twice. |
| `auth_nonce` | `nonce_id`, `nonce_hash`, `device_id_hash`, `expires_at`, `used_at` | For Apple and Google ID tokens (section 9). |

### 1.2 Account status

| Status | Meaning | Can sign in? | Screens |
|---|---|---|---|
| `UNCONFIRMED` | Email and password account created, 6-digit code not yet entered. | Correct password → 0b-5g (a new code is sent). Wrong password → 0b-5d. | 0b-4a–f, 0b-5g |
| `ACTIVE` | Normal. | Yes. | — |
| `PENDING_DELETION` | Deletion requested. 30-day grace period. | Yes, but only into the restricted `PENDING_DELETION` scope, which shows S-5h. | S-5h, S-5i |
| `DELETED` | Data erased. The row is hard-deleted by the deletion job; this status exists only in flight. | No. Looks exactly like "not recognised". | — |

Apple and Google accounts are created `ACTIVE`. The provider has already checked the email, so there's no 6-digit code step.

**Unconfirmed accounts can't be squatted.** If someone creates an account for an email that is still `UNCONFIRMED`, we replace the pending password and send a new code, as if it were new. Nobody has proved they own that inbox yet, so nobody owns the account. Unconfirmed accounts are purged after **7 days**.

**A completed password reset also confirms the email.** Using the link proves the inbox, so an `UNCONFIRMED` account becomes `ACTIVE`.

### 1.3 "Needs an email code on a new device" (`step_up_required`)

This flag sits alongside `ACTIVE`; it is not a separate status.

- **Set by** the quiet account-wide check (section 4.2) when wrong-password guesses are spread across many devices or IPs. Nothing is shown to anyone when it's set.
- **Effect:** the next correct-password sign-in from a device not in `known_device` must also enter a 6-digit code sent to the account email (0b-5h). Known devices are not affected.
- **Cleared by** a successful 0b-5h sign-in, or a completed password reset. The check can set it again at any time.
- **Applies to** password accounts only. Apple and Google run their own risk checks.

### 1.4 Sign-in method per email

| `method` | Stored email | How identity is matched | Wrong-method screens |
|---|---|---|---|
| `PASSWORD` | What the person typed | `email_norm` + password | 0b-6e (Google tapped), 0b-6f (Apple tapped) |
| `GOOGLE` | Google's verified `email` | (`GOOGLE`, `sub`) | 0b-6a (email form), 0b-6h (Apple tapped), 0b-3h (create with email) |
| `APPLE` | Apple's `email`. This may be a **Hide My Email** relay address (`…@privaterelay.appleid.com`, `is_private_relay = true`). | (`APPLE`, `sub`) | 0b-6b (email form, real address), 0b-6c (email form, relay address), 0b-6g (Google tapped), 0b-3h Apple variant |

- A relay address only ever matches itself. If someone types the real email that sits behind a relay, we can't match it. They get "not recognised" with the Apple hint (0b-6d), and we don't try to guess.
- **Duplicate accounts behind Hide My Email are accepted** (decision 6). Support merges them only after both accounts are verified.
- **Federated email changes:** if a later Apple or Google ID token for the same `sub` has a different email, update `account.email` (subject to the unique index). Never match on the new email first.

---

## 2. Flows

Every step says which screen the person sees. "Tap" means the screen's button; "API" means the call in section 3.

### 2.1 Create with email (0b-1 → 0b-3 → 0b-4 → 0c)

1. 0a → **Create account** → 0b-1 → **Continue with email** → 0b-3a (empty). The password rules show before typing.
2. As the person types, the client ticks the rules live (0b-3b):
   - length 15–128 (section 5);
   - the email isn't inside the password;
   - the breach check (section 5.3, a client-side k-anonymity lookup with a 300 ms debounce; the password never leaves the device).
3. **Passwords don't match** is checked on the device only. Clear both password fields and show 0b-3d.
4. Tap **Create account** → 0b-3c (button shows "Creating account…") → API `POST /v1/accounts`.
5. Results:
   - `202 CODE_SENT` → 0b-4a. The response carries a `challenge_id`.
   - `PASSWORD_TOO_SHORT` → 0b-3e · `PASSWORD_BREACHED` → 0b-3f · `PASSWORD_CONTAINS_EMAIL` / `PASSWORD_TOO_LONG` → same layout as 0b-3e with their own copy. Both password fields clear; the email is kept.
   - `ACCOUNT_EXISTS` → 0b-3g. **Sign in instead** opens 0b-5b with the email filled in and the password empty. In the background the owner gets the "someone tried to create an account" email (7.5).
   - `WRONG_METHOD` (`method = GOOGLE`) → 0b-3h · (`method = APPLE`) → 0b-3h Apple variant: the same layout with "This email uses Apple to sign in" and a **Continue with Apple** button. The owner alert email is sent here too.
   - `RATE_LIMITED`, `DEVICE_CHECK_FAILED` → section 3.4.
6. The server always hashes the submitted password with Argon2id, even when it then returns `ACCOUNT_EXISTS`, so every branch takes the same time (section 6.3).

### 2.2 Confirm the email (0b-4)

1. 0b-4a: "We've sent a 6-digit code to sam@example.com. It expires in 10 minutes." **Resend** stays disabled for 30 s.
2. The code field supports paste and iOS/Android one-time-code autofill. On iOS and web, mark the first digit `autocomplete="one-time-code"` and spread a pasted 6-digit value across the boxes.
3. On the 6th digit (or **Confirm**) → 0b-4b (Checking…) → API `POST /v1/accounts/confirm {challenge_id, code}`.
4. Results:
   - `200` with tokens → 0b-4g → **Continue** → **0c** (onboarding).
   - `CODE_INCORRECT` → 0b-4c (digits kept, thick borders).
   - `CODE_EXPIRED` → 0b-4d.
   - `CODE_ATTEMPTS_EXCEEDED` (the 5th wrong try on that code) → 0b-4e. The code is dead; **Send a new code** is the only way on.
5. **Resend** → API `POST /v1/codes/resend {challenge_id}` → 0b-4f ("Use the newest code. Older codes no longer work."). Each new code cancels the old one. Limits: 30 s between sends, at most 5 an hour (`RESEND_TOO_SOON`, `RESEND_LIMIT`).
6. **Wrong email? Change it** → back to 0b-3 with the email kept and both passwords empty. Submitting again replaces the unconfirmed account (1.2).

### 2.3 Sign in with email (0b-2 → 0b-5 → Today)

1. 0a → **Sign in** → 0b-2 → **Continue with email** → 0b-5a. Fill email and password (0b-5b). Masked, with Show/Hide.
2. Tap **Sign in** → 0b-5c → API `POST /v1/sessions/password`.
3. The server checks in this order, so the messages stay consistent:
   1. Device check and look-up rate limits → `DEVICE_CHECK_FAILED` / `RATE_LIMITED`.
   2. Is this device or IP paused for this email? → `SIGN_IN_PAUSED` (0b-5f, `retry_after_seconds`).
   3. Find the email. None → `ACCOUNT_NOT_FOUND` (0b-5e). A dummy Argon2 verify runs so the timing matches.
   4. Method isn't `PASSWORD` → `WRONG_METHOD` with `method` and `is_private_relay` → 0b-6a / 0b-6b / 0b-6c.
   5. Verify the password. Wrong → `WRONG_PASSWORD` (0b-5d), and count it towards the per-device pause and the account-wide check. If that wrong try is the **5th in 15 minutes** on this device or IP, return `SIGN_IN_PAUSED` instead (0b-5f).
   6. Correct but `UNCONFIRMED` → send a new confirm code → `EMAIL_NOT_CONFIRMED` + `challenge_id` (0b-5g → **Enter code** → 0b-4a).
   7. Correct, `step_up_required`, and the device isn't known → send a new-device code → `STEP_UP_REQUIRED` + `challenge_id` (0b-5h).
   8. Correct and `PENDING_DELETION` → tokens with scope `PENDING_DELETION` → S-5h.
   9. Correct → tokens (scope `FULL`) → **Today**. Add or refresh the `known_device` row.
4. After every error the password field clears and the email stays.

### 2.4 Wrong method: every combination

| The person… | …and the email's account uses | Screen | Button |
|---|---|---|---|
| Signs in with email | Google | 0b-6a | Continue with Google |
| Signs in with email | Apple (real email) | 0b-6b | Continue with Apple |
| Signs in with email | Apple (types the relay address) | 0b-6c | Continue with Apple |
| Signs in with email | Apple, but types the real email behind a relay | 0b-6d (not recognised + Apple hint) | Continue with Apple / Create account with this email |
| Creates with email | Google | 0b-3h | Continue with Google |
| Creates with email | Apple | 0b-3h (Apple variant) | Continue with Apple |
| Taps Google (create or sign in) | Password | 0b-6e | Sign in with email (email filled in) |
| Taps Apple (create or sign in) | Password | 0b-6f | Sign in with email (email filled in) |
| Taps Google (create or sign in) | Apple | 0b-6g | Continue with Apple |
| Taps Apple (create or sign in) | Google | 0b-6h | Continue with Google |
| Taps Google or Apple to **create**, and that same Google/Apple identity already has an account | — | 0b-8h | Sign in with Google/Apple (one tap, using the ticket) |
| Taps Google or Apple to **sign in**, and that identity has no account and its email matches nothing | — | 0b-8i | Create account with Google/Apple (one tap, using the ticket) |

Notes:

- For Google and Apple, the email match only uses the provider's **verified** email (`email_verified = true`). Unverified → treat as no match.
- **Same email, same provider, different `sub`** (for example a re-created Google account): return `PROVIDER_ACCOUNT_MISMATCH`. Show 0b-8g with "We couldn't sign you in with Google. Contact support and we'll sort it out." Never link or replace the identity.
- The wrong-method check exposes which method an email uses. That's accepted (decision 10) and protected by section 6.

### 2.5 Not recognised (0b-5e, 0b-6d, 0b-8i)

1. Email form: `ACCOUNT_NOT_FOUND` → 0b-5e. Email kept ("Typo? Fix it here and sign in again."). **Create account with this email** → 0b-3a with the email carried over and the passwords empty.
2. Every 0b-5e shows the Apple hint, because we can't tell whether a relay hides the account. 0b-6d is the same response drawn with a fuller hint. The client shows the fuller 0b-6d version whenever the typed domain isn't `privaterelay.appleid.com`. *(Assumption: the two differ only in emphasis.)*
3. Google or Apple sign-in with no account → 0b-8i (section 2.7).

### 2.6 Already exists (0b-3g, 0b-8h)

- Email create → 0b-3g. **Sign in instead** → 0b-5b with the email carried, password empty.
- Google/Apple create → 0b-8h. **Sign in with Google** exchanges the `SIGN_IN_EXISTING` ticket (`POST /v1/sessions/ticket`) → 0b-8f → Today. **Use a different account** → 0b-1.
- The owner alert email (7.5) goes out for email creates only. For 0b-8h the person has just proved they own the Google/Apple account, so no alert is needed.

### 2.7 Apple and Google on iPhone, web and Android

| Platform | Apple | Google | Cancel |
|---|---|---|---|
| iPhone | Native `ASAuthorizationAppleIDProvider` sheet with Face ID (0b-8a). Ask for `fullName` and `email` scopes. Pass `SHA256(raw_nonce)` as the request nonce. | Google Sign-In SDK: iOS permission alert (0b-8b), then `ASWebAuthenticationSession` sheet (0b-8c). PKCE + nonce. | Back to 0b-1/0b-2, no message. |
| Web | Sign in with Apple JS in a pop-up (0b-8d); full-page redirect if pop-ups are blocked. `response_type=code id_token`, `response_mode=form_post` to our backend. | Google Identity Services in a pop-up (0b-8c), redirect fallback. ID token with nonce. | Same. |
| Android | Chrome Custom Tab to Apple's authorise URL (0b-8d). Apple posts back to our backend (`form_post`). The backend checks it, creates a ticket and returns through an App Link `https://lifeos.app/auth/apple/return#t=<ticket>`. | Credential Manager "Sign in with Google" bottom sheet (0b-8e) returns an ID token with nonce. | Same. |

Steps (all platforms):

1. The client asks for a nonce: `POST /v1/auth/nonce` → `{nonce_id, nonce}` (single use, 10 minutes, bound to the device).
2. Run the provider UI with that nonce. Apple native gets `SHA256(nonce)`.
3. While waiting, show 0b-8f (Signing you in…). **Cancel** returns to the method screen.
4. `POST /v1/sessions/federated {provider, id_token | authorization_code, nonce_id, intent: CREATE|SIGN_IN, given_name?, device_id}`.
5. Results:
   - `200` tokens → Today (existing) or 0c (`account_created: true`).
   - `ACCOUNT_EXISTS` + ticket → 0b-8h.
   - `ACCOUNT_NOT_FOUND` + ticket → 0b-8i.
   - `WRONG_METHOD` → 0b-6e / 0b-6f / 0b-6g / 0b-6h.
   - `PROVIDER_ERROR`, `TOKEN_INVALID` or a network failure → 0b-8g ("That didn't work").
6. **Apple only sends the name on the first authorisation.** Capture it from the client on that first sign-in, pass it as `given_name`, and pre-fill onboarding 0g ("What should we call you?"). Never ask Apple for it again.

### 2.8 Forgot password (0b-7)

1. 0b-5 → **Forgot password?** → 0b-7a, with the email carried over ("Filled in from the sign-in screen.").
2. **Send reset link** → 0b-7b → API `POST /v1/password-resets {email}` → always `202` → 0b-7c ("If sam@example.com has a Life OS password, we've sent a link…"). The screen never says which case applied.
3. In the background, by account:
   - **Password account** → email 7.3 with a single-use link, valid 30 minutes. A newer link cancels older ones.
   - **Google or Apple account** → email 7.4 ("your account uses Google/Apple"), no link to reset (0b-7e).
   - **No account** → nothing is sent.
   - Pending-deletion accounts are treated like password/federated accounts as normal. Deleted accounts get nothing.
4. The link `https://lifeos.app/reset#t=<token>` opens the app (Universal Link / App Link) or the web page. The token sits in the URL **fragment** so it never reaches server logs or a `Referer` header. The page also sets `Referrer-Policy: no-referrer`.
5. The app or page calls `POST /v1/password-resets/verify {token}`.
   - Valid → 0b-7f ("Set a new password · For sam@example.com.").
   - Expired, used or superseded → `RESET_LINK_INVALID` → 0b-7j.
6. Fill in (0b-7g) → **Save password** → 0b-7h → `POST /v1/password-resets/complete {token, new_password}`. Errors: the password errors from 2.1. "Don't match" is checked on the device (0b-7i).
7. On success the server, in one transaction:
   - updates the hash;
   - revokes **every** session and bumps `token_epoch`;
   - clears `step_up_required`;
   - sets `UNCONFIRMED` → `ACTIVE`;
   - invalidates all other reset tokens and codes;
   - queues email 7.6 ("password changed").
8. → 0b-7k. **Sign in** → 0b-5a with the email filled in. The link never signs you in by itself (more secure: a leaked link only lets someone set a password, never use the account straight away, and the owner is told).

### 2.9 New-device check (0b-5h)

1. This only happens on 2.3 step 3.7: correct password, the flag is set, and the device is unknown.
2. Email 7.2 is sent. 0b-5h: "Check it's you · We've noticed unusual sign-in attempts on this account, so we've sent a 6-digit code to sam@example.com."
3. `POST /v1/sessions/step-up {challenge_id, code}`. The same rules apply as for the confirm code: 6 digits, 10 minutes, 5 tries per code, resend after 30 s, at most 5 an hour. The errors map to the 0b-4c/4d/4e copy.
4. Success → tokens → the device is added to `known_device` → the flag clears → Today.
5. **Residual risk, accepted:** reaching 0b-5h tells a guesser that the password was right. They still can't get in without the inbox, and the owner's email (7.2) tells them to change their password. The screen copy no longer says "your password was right" (fixed in Task 1).

### 2.10 Sign out (any screen in Me)

`POST /v1/sessions/current/sign-out` revokes this session's refresh family, unregisters the push token and clears local storage. → 0a.

---

## 3. API contract

### 3.1 Conventions

- Base path `/v1`, JSON over HTTPS only, TLS 1.2+ (prefer 1.3), HSTS with preload.
- Every unauthenticated auth call sends:
  - `X-Device-Id: <device_id>`;
  - one device-check header: `X-App-Attest` (iOS assertion), `X-Play-Integrity` (Android token) or `X-Turnstile` (web token);
  - `Idempotency-Key` on POSTs that send email.
- Authenticated calls: `Authorization: Bearer <access_token>` (mobile) or the session cookie plus `X-CSRF-Token` (web, section 8).
- Error body. There is never free text for the user, and `details` never holds passwords, codes or which rule a password "nearly" met:

```json
{ "error": { "code": "WRONG_METHOD", "retry_after_seconds": null,
             "details": { "method": "GOOGLE", "is_private_relay": false } },
  "request_id": "01JC…" }
```

- Unknown codes on the client → the generic error (3.4 `SERVER_ERROR`).

### 3.2 Endpoints

| Endpoint | Request | Success | Errors (HTTP · code → screen) |
|---|---|---|---|
| `POST /v1/auth/nonce` | `{}` | `200 {nonce_id, nonce}` | 429 `RATE_LIMITED` |
| `GET /v1/password/breach-range/{prefix}` | `prefix` = first 5 hex chars of the SHA-1 of the password | `200` text list of `SUFFIX:COUNT`, padded to a constant size | 429 `RATE_LIMITED` (the client fails open on the live tick; the server still checks on submit) |
| `POST /v1/accounts` | `{email, password}` | `202 {challenge_id, code_expires_at, resend_available_at}` | 422 `PASSWORD_TOO_SHORT` → 0b-3e · 422 `PASSWORD_TOO_LONG` · 422 `PASSWORD_BREACHED` → 0b-3f · 422 `PASSWORD_CONTAINS_EMAIL` · 422 `EMAIL_INVALID` · 409 `ACCOUNT_EXISTS` → 0b-3g · 409 `WRONG_METHOD {method}` → 0b-3h · 429 `RATE_LIMITED` · 403 `DEVICE_CHECK_FAILED` |
| `POST /v1/accounts/confirm` | `{challenge_id, code}` | `200 {tokens, account_created: true}` → 0b-4g | 422 `CODE_INCORRECT` → 0b-4c · 410 `CODE_EXPIRED` → 0b-4d · 423 `CODE_ATTEMPTS_EXCEEDED` → 0b-4e · 404 `CHALLENGE_NOT_FOUND` (treat as expired) · 429 `RATE_LIMITED` |
| `POST /v1/codes/resend` | `{challenge_id}` | `202 {challenge_id, code_expires_at, resend_available_at}` → 0b-4f | 429 `RESEND_TOO_SOON {retry_after_seconds}` · 429 `RESEND_LIMIT {retry_after_seconds}` · 404 `CHALLENGE_NOT_FOUND` |
| `POST /v1/sessions/password` | `{email, password}` | `200 {tokens, scope}` → Today / S-5h | 401 `WRONG_PASSWORD` → 0b-5d · 404 `ACCOUNT_NOT_FOUND` → 0b-5e/6d · 409 `WRONG_METHOD {method, is_private_relay}` → 0b-6a/6b/6c · 403 `EMAIL_NOT_CONFIRMED {challenge_id}` → 0b-5g · 403 `STEP_UP_REQUIRED {challenge_id}` → 0b-5h · 429 `SIGN_IN_PAUSED {retry_after_seconds}` → 0b-5f · 429 `RATE_LIMITED` · 403 `DEVICE_CHECK_FAILED` |
| `POST /v1/sessions/step-up` | `{challenge_id, code}` | `200 {tokens, scope}` | Same code errors as `/accounts/confirm` |
| `POST /v1/sessions/federated` | `{provider, id_token?, authorization_code?, nonce_id, intent, given_name?}` | `200 {tokens, scope, account_created}` | 409 `ACCOUNT_EXISTS {ticket}` → 0b-8h · 404 `ACCOUNT_NOT_FOUND {ticket}` → 0b-8i · 409 `WRONG_METHOD {method}` → 0b-6e–6h · 409 `PROVIDER_ACCOUNT_MISMATCH` → 0b-8g (support copy) · 401 `TOKEN_INVALID` → 0b-8g · 502 `PROVIDER_ERROR` → 0b-8g · 429 · 403 |
| `POST /v1/sessions/ticket` | `{ticket}` | `200 {tokens, scope, account_created}` | 410 `TICKET_EXPIRED` → 0b-8g |
| `POST /v1/password-resets` | `{email}` | `202 {}` always → 0b-7c | 429 `RATE_LIMITED` (per device/IP only; the 3-an-hour-per-email limit is **silent** and still returns 202) · 403 `DEVICE_CHECK_FAILED` |
| `POST /v1/password-resets/verify` | `{token}` | `200 {email_masked: false, email}` → 0b-7f | 410 `RESET_LINK_INVALID` → 0b-7j |
| `POST /v1/password-resets/complete` | `{token, new_password}` | `204` → 0b-7k | 410 `RESET_LINK_INVALID` → 0b-7j · 422 password errors as above |
| `POST /v1/tokens/refresh` | mobile `{refresh_token}`; web cookie | `200 {tokens}` (rotated) | 401 `SESSION_EXPIRED` → 0a · 401 `SESSION_REVOKED` → 0a |
| `POST /v1/sessions/current/sign-out` | — | `204` → 0a | — (always succeeds locally) |
| `GET /v1/me/security` | — | `200 {method, email, is_private_relay, password_changed_at, device_count, coming_later: [...]}` → S-1a / S-3a | 5xx → S-1c |
| `POST /v1/me/password` | `{current_password, new_password}` | `204` → S-2f (this session's tokens rotated, all others revoked) | 401 `WRONG_PASSWORD` → S-2d · 422 password errors (`PASSWORD_BREACHED` → S-2e) · 422 `PASSWORD_SAME_AS_CURRENT` · 429 `SIGN_IN_PAUSED` · 409 `NO_PASSWORD` (Apple/Google account) |
| `GET /v1/me/sessions` | — | `200 [{id, label, platform, coarse_location, last_active_at, is_current}]` → S-4a / S-4f | 5xx → S-1c layout |
| `DELETE /v1/me/sessions/{id}` | — | `204` → S-4d | 404 `SESSION_NOT_FOUND` (treat as done) · 5xx → S-4g |
| `POST /v1/me/sessions/revoke-all` | `{}` | `204` → 0a (includes this device) | 5xx → S-4g copy |
| `POST /v1/me/reauth` | `{password}` or `{provider, id_token, nonce_id}` | `200 {reauth_token}` (5 minutes, single use, scope `DELETE_ACCOUNT`) | 401 `WRONG_PASSWORD` → S-5d · 429 `SIGN_IN_PAUSED` · 401 `TOKEN_INVALID` |
| `POST /v1/me/deletion` | `{reauth_token, confirmation: "DELETE"}` | `202 {deletion_due_at}` → S-5h | 401 `REAUTH_REQUIRED` → S-5b/5c · 422 `CONFIRMATION_MISMATCH` |
| `GET /v1/me/deletion` | — | `200 {deletion_due_at}` | — |
| `DELETE /v1/me/deletion` | — (scope `PENDING_DELETION` or `FULL`) | `204` → S-5i | 409 `NOT_PENDING` |
| `POST /v1/webhooks/apple` | Apple server-to-server notification `{payload: <JWT>}` | `200` | 400 if the signature or claims fail (logged and alerted) |

### 3.3 Error codes and on-screen text

| Code | Screen | Exact on-screen text |
|---|---|---|
| `PASSWORD_TOO_SHORT` | 0b-3e, S-2 | "Too short. Use at least 15 characters." |
| `PASSWORD_TOO_LONG` | 0b-3 layout | "Too long. Use 128 characters or fewer." |
| `PASSWORD_BREACHED` | 0b-3f, S-2e | "Found in a data breach. Try another one." |
| `PASSWORD_CONTAINS_EMAIL` | 0b-3 layout | "Your password can't include your email. Try something else." |
| `PASSWORD_SAME_AS_CURRENT` | S-2 layout | "That's your current password. Choose a new one." |
| *(device only)* passwords don't match | 0b-3d, 0b-7i | "Passwords don't match. Type it again." |
| `EMAIL_INVALID` | 0b-3 / 0b-5 email field | "Check your email address. It should look like name@example.com." |
| `ACCOUNT_EXISTS` (email) | 0b-3g | Title "An account already exists for this email" · body "sam@example.com already has a Life OS account." · button "Sign in instead" · note "We'll fill in your email for you." |
| `WRONG_METHOD` on create (Google) | 0b-3h | "This email uses Google to sign in" · "sam@gmail.com already has a Life OS account set up with Google, so it can't have a password too." · "Continue with Google" |
| `WRONG_METHOD` on create (Apple) | 0b-3h Apple variant | "This email uses Apple to sign in" · "sam@icloud.com already has a Life OS account set up with Apple, so it can't have a password too." · "Continue with Apple" |
| `CODE_INCORRECT` | 0b-4c, 0b-5h | "That code isn't right. Check the latest email and try again." |
| `CODE_EXPIRED` | 0b-4d | "That code has expired" · "Codes last 10 minutes. We'll send you a fresh one." · "Send a new code" |
| `CODE_ATTEMPTS_EXCEEDED` | 0b-4e | "Too many tries" · "That code no longer works. Ask for a new one. Your account is safe." · "Send a new code" |
| `RESEND_TOO_SOON` | 0b-4a/4f, 0b-5h | Button reads "Resend in 30s" and counts down |
| `RESEND_LIMIT` | 0b-4 layout | "Too many codes" · "You've asked for a lot of codes. Use the latest email, or try again in an hour." |
| `WRONG_PASSWORD` | 0b-5d, S-5d | "That password isn't right. Try again, or reset it." |
| `WRONG_PASSWORD` (change password) | S-2d | "That password isn't right. Forgotten it? Sign out and use Forgot password." |
| `ACCOUNT_NOT_FOUND` (email) | 0b-5e | "We don't recognise that account" · "No Life OS account uses sam@exmaple.com." · "Create account with this email" · note "Signed up with Apple? Try Continue with Apple instead." |
| `ACCOUNT_NOT_FOUND` (real email, relay possible) | 0b-6d | "We don't recognise that account" · "No Life OS account uses sam.taylor@outlook.com. Signed up with Apple and 'Hide My Email'? Continue with Apple instead." · "Continue with Apple" · "Create account with this email" |
| `WRONG_METHOD` Google | 0b-6a | "This email uses Google to sign in" · "sam@gmail.com was set up with Google, so there's no password to enter." · "Continue with Google" |
| `WRONG_METHOD` Apple | 0b-6b | "This email uses Apple to sign in" · "sam@icloud.com was set up with Apple, so there's no password to enter." · "Continue with Apple" |
| `WRONG_METHOD` Apple relay | 0b-6c | "This email uses Apple to sign in" · "This is an Apple 'Hide My Email' address. It works with Continue with Apple only." |
| `WRONG_METHOD` (Google/Apple tapped → password) | 0b-6e / 0b-6f | "This email uses a password" · "sam@gmail.com has a Life OS password. Sign in with your email and password instead." · card "We'll fill in your email. Forgotten the password? You can reset it on the next screen." · "Sign in with email" · "Back to sign-in options" |
| `WRONG_METHOD` (Google tapped → Apple) | 0b-6g | "This email uses Apple to sign in" · "The Life OS account for sam@gmail.com was set up with Apple." |
| `WRONG_METHOD` (Apple tapped → Google) | 0b-6h | "This email uses Google to sign in" · "The Life OS account for sam@gmail.com was set up with Google." |
| `EMAIL_NOT_CONFIRMED` | 0b-5g | "Confirm your email first" · "We've sent a new 6-digit code to sam@example.com." · "Enter code" |
| `STEP_UP_REQUIRED` | 0b-5h | "Check it's you" · "We've noticed unusual sign-in attempts on this account, so we've sent a 6-digit code to sam@example.com." · card "This only happens when you sign in on a new device. Nothing on your account has changed." |
| `SIGN_IN_PAUSED` | 0b-5f | "Too many tries" · "For your security, sign-in is paused on this device for 15 minutes. Wait and try again, or reset your password now." · button "Try again in 15 minutes" (counts down from `retry_after_seconds`; longer pauses show the real time) · "Reset password" |
| `ACCOUNT_EXISTS` (federated) | 0b-8h | "An account already exists for this email" · "sam@gmail.com already has a Life OS account with Google." · card "Sign in goes straight to Today. You won't need to choose your Google account again." · "Sign in with Google" · "Use a different account" |
| `ACCOUNT_NOT_FOUND` (federated) | 0b-8i | "We don't recognise that account" · "No Life OS account uses sam@gmail.com." · card "Picked the wrong Google account? Try again and choose another." · "Create account with Google" · "Try a different account" |
| `TOKEN_INVALID`, `PROVIDER_ERROR`, `TICKET_EXPIRED` | 0b-8g | "That didn't work" · "We couldn't sign you in with Google. Nothing has changed. Check your connection and try again." · "Try again" · "Choose another way" |
| `PROVIDER_ACCOUNT_MISMATCH` | 0b-8g layout | "That didn't work" · "We couldn't sign you in with Google. Contact support and we'll sort it out." |
| `RESET_LINK_INVALID` | 0b-7j | "This link has expired" · "Reset links work once and last 30 minutes. Ask for a new one and use the latest email." |
| `REAUTH_REQUIRED` | S-5b/5c | Return to "Confirm it's you" |
| `SESSION_EXPIRED`, `SESSION_REVOKED` | 0a | No message. Show Welcome. *(Web: "You've been signed out. Sign in again." on 0b-2.)* |

### 3.4 Shared errors (any auth screen)

| Code | Shown as | Text |
|---|---|---|
| `RATE_LIMITED` (look-up limit) | Alert in the 0b-5f layout, button disabled with a countdown | "Too many tries" · "Lots of attempts from this device. Wait a while, then try again." |
| `DEVICE_CHECK_FAILED` | Alert in place | "We couldn't check this device" · "Update Life OS and try again. On the web, refresh the page." |
| `SERVER_ERROR` / network | Alert in place | "Something went wrong" · "Nothing has changed. Check your connection and try again." |

These three aren't drawn on the canvas. They reuse the existing alert pattern (thick border, "!" icon, plain text).

---

## 4. Limits and timings

### 4.1 Table

| Thing | Value | Key | Notes |
|---|---|---|---|
| Wrong-password pause | **5 wrong tries in 15 minutes → 15-minute pause** | (device_id, email) and (IP, email) | If it continues the pause doubles: 15 → 30 → 60 → 120 minutes, capped at 24 hours. It resets after 24 hours with no failures. **It never locks the account**, so nobody can lock someone else out. No "tries left" counter. Also applies to S-2 and S-5 re-checks. |
| Quiet account-wide check | ≥ 20 wrong passwords in 24 hours **from ≥ 3 different devices or IPs** → set `step_up_required` | account | Silent. No email, no lock. *(Assumption: the decisions doc sets the behaviour but no numbers.)* |
| Confirm code (0b-4) | 6 digits, single use, **10 minutes**, **5 tries per code** | challenge | A new code cancels the old one. |
| New-device code (0b-5h) | Same as the confirm code | challenge | |
| Code resend | After **30 s**, at most **5 an hour** | account + device | |
| Reset link | Single use, **30 minutes**, **3 requests an hour per email** | email | A newer link cancels older ones. Over the limit: still 202, nothing sent. |
| Look-ups (create, sign in, forgot, federated email match) | About **10 an hour** per device, per IP and per email | each separately | Counted **only when the button is tapped**. Over the limit → `RATE_LIMITED`. |
| Breach-range proxy | 60 a minute per device | device | |
| Owner alert email (7.5) | At most 1 per account per 24 hours | account | Stops anyone using it to email-bomb a person. |
| Nonce / ticket | 10 minutes / 2 minutes, single use | — | |
| Re-auth token (delete) | 5 minutes, single use | session | |
| Unconfirmed account purge | 7 days | — | |
| Deletion grace | 30 days | — | Then backups roll off within 35 days. |

### 4.2 How the quiet check works

- Each `WRONG_PASSWORD` adds `(account_id, device_or_ip_key, timestamp)` to a 24-hour sliding window in Redis.
- When the count and spread cross the threshold, set `step_up_required = true` and log `auth.stepup.flagged`.
- No message, email or lock follows. The only effect is 0b-5h on the next sign-in from a new device.

### 4.3 Shared IP addresses

Mobile carriers and offices put many people behind one IP. The pause keys IPs **per email**, so one office can't block itself. The look-up limit (10 an hour per IP) can still hit busy carrier IPs, so see open decision D1.

---

## 5. Passwords

### 5.1 Rules

| Rule | Value |
|---|---|
| Minimum | **15 characters** (NIST SP 800-63B-4, password as the only factor) |
| Maximum | **128 characters** |
| Composition | None. Spaces, emoji, any Unicode and paste are all allowed. Never truncate or trim. |
| Counting | Unicode code points after **NFKC** normalisation. The server normalises before hashing as well, so the same password typed on iOS and Android matches. |
| Breached | Rejected if it appears in the Pwned Passwords dataset at all (count ≥ 1). |
| Email | Rejected if, ignoring case, it contains the full email, or the email's local part when that part is 5 or more characters. |
| Same as current | Rejected on change (S-2). |
| Hints, questions, expiry | None. No forced changes. A change is only required after a breach is suspected. |

### 5.2 Fields on every platform

- iOS: `textContentType = .newPassword` (create, reset, change) or `.password` (sign in), `isSecureTextEntry = true`, with a passwordrules attribute matching `minlength: 15; maxlength: 128;`.
- Android: `autofillHints = [AUTOFILL_HINT_NEW_PASSWORD | AUTOFILL_HINT_PASSWORD]`, `inputType = textPassword`.
- Web: `type="password"`, `autocomplete="new-password"` / `"current-password"`, `passwordrules="minlength: 15; maxlength: 128;"`.
- Show/Hide toggles masking only. It must keep the field's type for autofill and password managers. *(Task 1 fixed screens where password fields had been drawn as email fields, with placeholder text in them.)*
- Clear both fields after any error, and when leaving the screen.

### 5.3 Breach check

- **Server (authoritative):** on create, reset and change, check SHA-1(password) against a **locally hosted copy** of the Pwned Passwords dataset, refreshed monthly. No third party sees anything, and the check works even if HIBP is down.
- **Client (live tick):** compute SHA-1 on the device. Send only the first 5 hex characters to our proxy `GET /v1/password/breach-range/{prefix}`, which answers from the same local copy with padding. Compare the suffix on the device. This is k-anonymity: neither we nor anyone else sees the password or its full hash.
- If the proxy fails, the tick stays neutral and the server check still runs on submit.

### 5.4 Storage

- **Argon2id**, PHC string format.
  - Suggested parameters: **m = 64 MiB (65 536 KiB), t = 3, p = 1**, salt 16 bytes, tag 32 bytes. This is the second recommended option in RFC 9106.
  - Tune `t` so a verify takes **250–500 ms** on production hardware.
- Java: Spring Security `Argon2PasswordEncoder(16, 32, 1, 65536, 3)` (Bouncy Castle) or Password4j.
- **Pepper:** HMAC-SHA256 the normalised password with a secret key held in KMS before Argon2. Store the key version beside the hash so it can be rotated.
- **Rehash on sign-in** when the stored parameters or pepper version are out of date.
- **Memory guard:** cap concurrent Argon2 operations with a semaphore (64 MiB each) so a flood of sign-ins can't exhaust memory. Over the cap, queue up to 2 s, then return `RATE_LIMITED`.
- The hash never leaves the auth service, is never logged and is excluded from analytics exports.

---

## 6. Protection against people checking which emails have accounts

The messages stay helpful (decision 10). These layers make bulk checking slow, costly and visible:

1. **Rate limits** (4.1): about 10 look-ups an hour per device, per IP and per email, counted only when a button is tapped. Nothing is checked while typing.
2. **Device checks on every unauthenticated auth call:**
   - **iOS: App Attest** (`DCAppAttestService`). Attest once per install, then send an assertion over the request hash. The server checks the counter, App ID and receipt.
   - **Android: Play Integrity** standard request, with `requestHash` = SHA-256 of the request body. The server needs `MEETS_DEVICE_INTEGRITY` and `PLAY_RECOGNIZED`.
   - **Web: Cloudflare Turnstile** (managed mode). Verify the token server-side with `siteverify`. Tokens are single use.
   - If the check fails → `DEVICE_CHECK_FAILED`. If attestation isn't supported (old devices, a temporary outage), allow it with **stricter limits (3 an hour)** rather than block. *(Assumption.)*
3. **The same response time whether or not an account exists:**
   - Do the same work on every branch: a real or dummy Argon2 verify or hash.
   - Send every email through an asynchronous outbox, so sending never adds time.
   - Pad every look-up endpoint to a floor of **600 ms ± 50 ms jitter**.
   - Monitor p50/p95 by outcome. They must stay within 30 ms of each other.
4. **Owner alert email** (7.5) whenever someone tries to create an account with an email that already has one, at most once a day.
5. **Forgot password reveals nothing:** always 202 and the same screen (0b-7c).
6. **Monitoring** (section 10) alerts on enumeration patterns: high `ACCOUNT_NOT_FOUND` rates, many distinct emails per device or IP, and attestation failures.

---

## 7. Emails

All emails share these rules:

- Plain and short, in British English.
- Sent from `no-reply@lifeos.app`. SPF, DKIM and **DMARC `p=reject`** are set up, and the domain is registered with Apple's Private Email Relay so relay addresses receive mail.
- No tracking pixels and no link tracking.
- **They never contain a password or a sign-in link.** The only link we ever send is the password reset link (7.3), and it can't sign anyone in.
- Each ends: "We'll never ask for your password or a code by email, phone or message."

### 7.1 Confirmation code (0b-4)

- **Subject:** Confirm your email for Life OS
- **Body:**
  > Your Life OS code is **482916**.
  > It expires in 10 minutes and works once.
  > If you didn't just create a Life OS account, you can ignore this email.

  *(The code is in the body only, not the subject, so it doesn't show on a locked phone's notification preview. iOS Mail autofill still finds it.)*

### 7.2 New-device code (0b-5h)

- **Subject:** Your Life OS sign-in code
- **Body:**
  > Someone is signing in to Life OS on a new device: **iPhone · London**.
  > Your code is **482916**. It expires in 10 minutes.
  > Not you? Don't share this code. Someone may know your password, so open Life OS and change it in Me → Security, or use Forgot password on the sign-in screen.

### 7.3 Password reset link (0b-7d)

- **Subject:** Reset your Life OS password
- **Body:**
  > Hi, someone asked to reset the password for this Life OS account.
  > [Set a new password]
  > This link works once and expires in 30 minutes.
  > **Didn't ask for this?** Ignore this email. Your password won't change.
  > We'll never email you your password.

### 7.4 "Your account uses Google/Apple" (0b-7e)

- **Subject:** About signing in to Life OS
- **Body:**
  > Someone asked to reset the password for this email. Your Life OS account uses **Google** to sign in, so there's no password to reset.
  > Open Life OS, then choose Continue with Google.
  > **Didn't ask for this?** You can ignore this email. Nothing has changed.

  (The Apple version swaps the word. Any "Open Life OS" button is a plain link to the app or App Store with no token in it.)

### 7.5 Someone tried to create an account with your email

- **Subject:** Someone tried to sign up with your email
- **Body:**
  > Someone tried to create a new Life OS account with this email address. You already have an account, so nothing has changed.
  > If it was you, open Life OS and sign in with your email and password *(or "with Google" / "with Apple")*.
  > If it wasn't you, you don't need to do anything.

### 7.6 Password changed (0b-7k, S-2f)

- **Subject:** Your Life OS password was changed
- **Body:**
  > Your Life OS password was changed on Friday 6 November at 21:14.
  > We've signed you out on your other devices.
  > **Didn't do this?** Open Life OS and use Forgot password on the sign-in screen straight away. If you can't get in, reply to this email and we'll help.

### 7.7 Account deletion (S-5)

- **Requested (S-5j).** Subject: "We're deleting your Life OS account".
  > You asked us to delete your Life OS account on 6 November 2026. We'll delete it permanently on 6 December 2026.
  > Changed your mind? Open Life OS, sign in, and tap Keep my account before then.
  > **Didn't ask for this?** Sign in and tap Keep my account, then change your password.

  This email has no links on purpose.
- **Cancelled.** Subject: "Your Life OS account is safe".
  > You cancelled the deletion. Everything is as you left it. Didn't do this? Change your password in Me → Security.
- **Completed (day 30).** Subject: "Your Life OS account has been deleted".
  > Your account and data have been deleted. Backups clear within 35 days. Thanks for using Life OS.

---

## 8. Sessions

### 8.1 Tokens

| Token | Format | Lifetime | Notes |
|---|---|---|---|
| Access | JWT, ES256, `kid` rotated every 90 days | **10 minutes** | Claims: `sub`, `sid`, `scope` (`FULL` · `PENDING_DELETION`), `epoch`, `aud = lifeos-api`, `iss`, `iat`, `exp`. The API rejects tokens whose `epoch` is below `account.token_epoch`, or whose `sid` is on the revoked-session list (both cached in Redis), so any sign-out, reset or "sign out everywhere" takes effect immediately, not after 10 minutes. |
| Refresh (mobile) | Opaque, 256-bit, stored hashed | **Idle 30 days, absolute 90 days** | **Rotates on every use.** Reusing an old refresh token revokes the whole family (likely theft) and logs `auth.refresh.reuse` (it pages someone). |
| Refresh (web) | Same, in a cookie | **Idle 7 days, absolute 30 days** | Shorter, because browsers are more often shared. |
| `PENDING_DELETION` scope | Same tokens | Same | Only allows `GET/DELETE /v1/me/deletion`, sign out and data export. |

### 8.2 Storage per platform

- **iOS:** refresh token and `device_id` in the **Keychain**, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (never synced to iCloud or restored to another phone). The access token is in memory only.
- **Android:** tokens encrypted with an AES-GCM key held in the **Android Keystore** (StrongBox where available), saved in app-private DataStore. Exclude them from backup with `dataExtractionRules` / `allowBackup=false`. The access token is in memory only.
- **Web:** a backend-for-frontend holds the tokens, so the browser's JavaScript never sees them. Cookies:
  - `__Host-lifeos_sid`: `HttpOnly; Secure; SameSite=Lax; Path=/`.
  - CSRF: a double-submit `X-CSRF-Token` header, plus an `Origin` check on every state-changing request.
  - Strict CSP and `frame-ancestors 'none'`.

### 8.3 Sign out everywhere

| Event | Effect |
|---|---|
| **Password reset** (0b-7) | Revoke every session, including the one that did the reset. Bump `token_epoch`. The person signs in again (0b-7k). |
| **Password change** (S-2) | Revoke every *other* session and bump `token_epoch`. This session gets fresh tokens straight away. |
| **Sign out everywhere** (S-4e) | Revoke every session, including this one → 0a. |
| **Sign out one device** (S-4b) | Revoke that session's family and unregister its push token. |
| **Deletion requested** (S-5) | Revoke every *other* session. This session switches to `PENDING_DELETION` scope. |
| **Apple consent revoked** (9.4) | Revoke every session. |

Revoking a session always **unregisters its push token**, so a signed-out phone stops getting briefings and check-ins.

### 8.4 Device list (S-4)

- Label: built from the platform and model (for example "iPhone 15", "MacBook · Safari", "Pixel 8 · Life OS app").
- Location: a town from an on-premise GeoIP database at sign-in time. Store the town only, never the IP.
- "active now" means used in the last 5 minutes; otherwise show relative time.

---

## 9. Apple and Google

### 9.1 Validating ID tokens

| Check | Google | Apple |
|---|---|---|
| Signature | JWKS `https://www.googleapis.com/oauth2/v3/certs`, cached per `Cache-Control` | JWKS `https://appleid.apple.com/auth/keys`, cached and refreshed when an unknown `kid` arrives |
| `alg` | RS256 only | RS256 only |
| `iss` | `https://accounts.google.com` or `accounts.google.com` | `https://appleid.apple.com` |
| `aud` | One of our Google client IDs (iOS, web; on Android the token's `aud` is the **web/server** client ID) | Our bundle ID (iOS native) or Services ID (web, Android) |
| `exp` / `iat` | Not expired; `iat` not in the future (60 s skew allowed) | Same |
| `nonce` | Equals the server-issued nonce, which must be unused and is then marked used | Native: equals `SHA256(raw nonce)`. Web: equals the raw nonce. Single use either way. |
| Email | `email` + `email_verified == true` before any email match | `email`, `email_verified`, `is_private_email` |

- Libraries: Nimbus JOSE + JWT, or Google's `GoogleIdTokenVerifier`.
- Reject anything else with `TOKEN_INVALID`, and log the check that failed (not the token).

### 9.2 Apple authorisation code

On the first Apple sign-in, exchange the `authorization_code` at `https://appleid.apple.com/auth/token`:

- The client secret is a short-lived ES256 JWT signed with our Apple key (Team ID, Key ID).
- Keep the returned **refresh token** encrypted (`apple_refresh_token_enc`). We need it to **revoke** Apple's token (`/auth/revoke`) when the account is deleted, which Apple requires.

### 9.3 Never link automatically

- Identity is (`provider`, `sub`). An email match only ever chooses which *message* to show (section 2.4).
- Changing sign-in method (decision 8) comes later. It will require signing in with the current method **and** an email code, after which the old method stops working.

### 9.4 Apple server-to-server notifications

- **Endpoint:** `POST /v1/webhooks/apple`, registered in the Apple Developer account.
- **Checks:** verify the `payload` JWT signature (same JWKS), `iss`, `aud` (our bundle or Services ID), `iat`. Then read `events` (a JSON string).

| Event | What we do |
|---|---|
| `consent-revoked` (the person stopped using Apple with Life OS) | Revoke every session for that `sub`. Keep the account. If they sign in with Apple again, Apple asks for consent again and the same `sub` signs straight back in. |
| `account-delete` (their Apple Account was deleted) | Revoke sessions and start our deletion with the 30-day grace. Nobody can sign in to cancel, so support can restore within the grace period after checking identity. |
| `email-disabled` (relay forwarding turned off) | Set `email_deliverable = false`, stop sending email, and show a note in Security: "Apple isn't forwarding our emails. Turn forwarding back on in your Apple Account settings to get security emails." |
| `email-enabled` | Set `email_deliverable = true`. |
| Email address changed | Apple sends no event for this. The new address arrives in the next ID token for the same `sub`, and we update `account.email` then (1.4). |

- Make it idempotent on the event's `jti`/`events.event_time`, and always answer `200` fast. Do the work in a queue.
- **Google (recommended):** subscribe to Google's **Cross-Account Protection (RISC)** events: sessions-revoked, tokens-revoked and account-disabled. Treat them like `consent-revoked`.

---

## 10. Logging and monitoring

### 10.1 What to log

Structured JSON, one event per auth outcome:

- `auth.account.created`, `auth.code.sent`, `auth.code.verified`, `auth.code.failed`
- `auth.signin.success`, `auth.signin.failed` (`reason` = the error code)
- `auth.pause.started`, `auth.stepup.flagged`, `auth.stepup.passed`
- `auth.reset.requested` (outcome: `sent_link` · `sent_method_email` · `none` · `limited`), `auth.reset.completed`
- `auth.session.revoked` (reason), `auth.refresh.reuse`
- `auth.federated.*`, `auth.webhook.apple.*`
- `auth.lookup.rate_limited`, `auth.attestation.failed`
- `auth.deletion.requested`, `auth.deletion.cancelled`, `auth.deletion.completed`

Fields on every event: `request_id`, `account_id` (internal UUID), `email_hmac` (HMAC-SHA256 with a log-only key; never the email itself), `device_id_hash`, `ip` (full for 30 days, then truncated to /24), `platform`, `app_version`, `attestation_result`, `outcome`, `latency_ms`.

### 10.2 Never log

Passwords (right or wrong), password hashes, codes, reset tokens or links, access, refresh or ID tokens, Apple authorisation codes, tickets, nonces, full emails or full request bodies on `/v1/accounts*`, `/v1/sessions*`, `/v1/password-resets*` and `/v1/me/*`.

Enforce this in code, not by habit:

- a Logback masking layout;
- an allow-list of loggable fields;
- request-body logging switched off for those paths;
- crash reporters (iOS, Android, web) set to scrub form fields.

### 10.3 Alerts

| Alert | Trigger | Who |
|---|---|---|
| Credential stuffing | `WRONG_PASSWORD` across accounts > 3× the 7-day baseline for 10 minutes, or > 50 distinct accounts from one IP/ASN in an hour | Page |
| Refresh token reuse | Any `auth.refresh.reuse` | Page |
| Email checking | `ACCOUNT_NOT_FOUND` share > 2× baseline, or > 30 distinct emails per device or IP in an hour | Ticket |
| Device-check failures | Attestation or Turnstile failure rate > 5% for 15 minutes | Ticket |
| Step-up spike | > 20 accounts flagged in an hour | Ticket |
| Timing leak | p95 latency for "exists" vs "doesn't exist" differs by > 30 ms | Ticket |
| Email delivery | Bounce or failure rate > 2%, or codes taking > 60 s | Page |
| Apple webhook | Any signature failure; no events for 30 days (check the registration) | Ticket |
| Breach dataset | Local copy older than 45 days | Ticket |
| Auth errors | 5xx > 1% for 5 minutes; Argon2 p95 > 1 s | Page |
| Deletion job | Any account past `deletion_due_at` + 24 h not deleted | Page |

---

## 11. UK GDPR notes for this area

*(Not legal advice. Have it reviewed before launch.)*

- **Roles:** Life OS is the controller. The email provider, cloud host, Cloudflare (Turnstile), Apple and Google (sign-in) are processors or independent controllers. Each needs the right contract (DPA), plus a UK IDTA or Addendum where data leaves the UK.
- **Lawful basis:**
  - Account, sign-in, sessions, security emails: **contract** (Art. 6(1)(b)). We can't provide the service without them.
  - Security logs, rate limits, device checks, the quiet check and owner alert emails: **legitimate interests** (Art. 6(1)(f)) in keeping accounts safe. Write a short legitimate-interests assessment.
  - Health data is **special category** (Art. 9). It is covered by its own explicit consent at 0c, not by sign-up. Auth data must never be mixed with it.
- **Data minimisation:**
  - Store only email, method, password hash, optional first name, sessions and known devices.
  - Device location is a town, not an IP. IPs are kept in full for 30 days in security logs, then truncated.
  - Emails appear in logs only as HMACs.
  - No tracking in emails, and no third-party analytics on auth screens.
  - The breach check sends no personal data anywhere (local dataset).
- **Retention:**

| Data | Kept for |
|---|---|
| Unconfirmed accounts | 7 days |
| Codes, tickets, nonces, reset tokens | Deleted 24 hours after expiry or use |
| Session records | 30 days after revocation or expiry |
| Known devices | Until removed, or 12 months unused |
| Security logs | 90 days in detail, then aggregated with no identifiers |
| Deleted accounts | 30-day grace, then erased. Backups clear within 35 days. We keep a minimal deletion record (internal account ID and dates, no email) for 12 months to show we did it. |

- **Rights:** erasure (S-5, within one month under Art. 12 and 17), access and portability (export from Me → Privacy, also offered on S-5a), rectification (email change, later).
- **Do a DPIA** before launch. Health plus financial data at scale is high-risk processing. Pay the ICO data protection fee.
- **Children:** assume adults only (18+) at launch; see open decision D4.

---

## 12. Test checklist

Run on iOS, Android and web unless marked. ✔ = automate in CI where possible.

### Entry and method screens
- [ ] 0a Welcome: both buttons; Terms and Privacy links have a 44 pt tap area.
- [ ] 0b-1 / 0b-2: Apple first, Google second, email third; "Already have an account?" / "New to Life OS?" links.

### Create with email (0b-3)
- [ ] 3a empty: rules visible before typing; button disabled.
- [ ] 3b filled: rules tick live; the breach tick uses the range proxy (check that only 5 hex characters are sent ✔).
- [ ] 3c creating: inputs disabled, spinner.
- [ ] 3d don't match: device-only; both passwords cleared, email kept.
- [ ] 3e too short (14 characters fails, 15 passes, 128 passes, 129 fails ✔; emoji and combining characters counted after NFKC ✔).
- [ ] 3f breached (test with a known breached password ✔).
- [ ] Password containing the email is rejected ✔.
- [ ] 3g account exists: "Sign in instead" carries the email, not the password; owner alert email sent once per 24 h ✔.
- [ ] 3h Google variant and Apple variant.
- [ ] Re-creating an **unconfirmed** email replaces it, with no "exists" message ✔.

### Confirm code (0b-4)
- [ ] 4a sent: Resend disabled for 30 s; one-time-code autofill and paste across the boxes.
- [ ] 4b checking.
- [ ] 4c wrong code: digits kept.
- [ ] 4d expired (at 10 min + 1 s ✔).
- [ ] 4e too many tries (the 5th wrong try kills the code ✔).
- [ ] 4f new code: the old code is rejected ✔; the 6th resend in an hour → `RESEND_LIMIT` ✔.
- [ ] 4g success → 0c.

### Sign in with email (0b-5)
- [ ] 5a / 5b / 5c.
- [ ] 5d wrong password: password cleared, email kept, no counter shown.
- [ ] 5e not recognised (typo email), with the Apple hint.
- [ ] 5f paused: 5th wrong try → pause ✔; another device can still sign in ✔; the correct password from the paused device is still refused until the pause ends ✔; pause doubles ✔; resets after 24 h ✔.
- [ ] 5g unconfirmed + correct password → new code, Enter code → 0b-4a.
- [ ] 5h step-up:
  - [ ] the flag is set after 20 failures from 3 keys ✔;
  - [ ] a known device is **not** challenged ✔;
  - [ ] a new device is challenged; the code works; the flag clears ✔;
  - [ ] the copy never says the password was right.
- [ ] Response times for exists, doesn't exist and wrong method are within 30 ms at p95 ✔.

### Wrong method (0b-6)
- [ ] 6a, 6b, 6c (relay typed), 6d (real email behind a relay), 6e, 6f, 6g, 6h. Each button opens the right method with no auto-linking ✔.

### Forgot password (0b-7)
- [ ] 7a pre-filled email; 7b sending.
- [ ] 7c is identical for a password account, a Google/Apple account and no account (body, status and timing ✔).
- [ ] 7d email: link works once ✔; expires at 30 min ✔; a newer link kills the older ✔; the 4th request in an hour sends nothing but still shows 7c ✔.
- [ ] 7e email for Google and Apple accounts; no email for unknown addresses ✔.
- [ ] 7f / 7g / 7h / 7i.
- [ ] 7j expired or used link.
- [ ] 7k: every other session is revoked, including mid-request access tokens via `token_epoch` ✔; "password changed" email sent ✔; the link didn't sign the person in ✔; an unconfirmed account becomes active ✔.

### Apple and Google (0b-8)
- [ ] 8a iPhone Apple sheet with Share and with Hide My Email; the name is captured on the first sign-in only.
- [ ] 8b + 8c iPhone Google; 8c web Google pop-up; the redirect fallback when pop-ups are blocked.
- [ ] 8d Android and web Apple (Custom Tab, App Link return).
- [ ] 8e Android Credential Manager.
- [ ] 8f loading and Cancel; cancelling any provider sheet → back, no error.
- [ ] 8g failure: invalid signature, wrong `aud`, wrong `iss`, expired, reused nonce, missing nonce ✔ each.
- [ ] 8h create → exists → one-tap ticket; ticket expires at 2 min ✔.
- [ ] 8i sign in → no account → one-tap create.
- [ ] `PROVIDER_ACCOUNT_MISMATCH` shows the support copy.
- [ ] Apple webhooks: consent-revoked signs out everywhere ✔; email-disabled sets the flag ✔; a bad signature is rejected and alerts ✔.

### Me → Security (row 9)
- [ ] S-1a overview for a password account; S-1b loading; S-1c error and retry.
- [ ] "Coming later" rows can't be tapped and screen readers announce them as "Later".
- [ ] S-2a–c: rules shown before the fields; Change password disabled until valid.
- [ ] S-2d wrong current password (uses the same per-device pause ✔); S-2e breached; same-as-current rejected.
- [ ] S-2f: this device stays signed in, other devices are signed out at once ✔, email 7.6 sent.
- [ ] S-3a overview for an Apple account; S-3b Apple explainer; S-3c Google explainer.
- [ ] S-4a list with "This device" first.
- [ ] S-4b confirm → S-4c → S-4d: that device's next API call returns 401 ✔ and its push token is gone ✔.
- [ ] S-4e sign out everywhere → 0a on every device.
- [ ] S-4f only this device; S-4g error.
- [ ] S-5a what gets deleted; download link.
- [ ] S-5b password re-check; S-5c Apple/Google re-check; S-5d wrong password.
- [ ] S-5e / 5f: DELETE is case-sensitive, so "delete" keeps the button disabled ✔.
- [ ] S-5g deleting.
- [ ] S-5h: other devices are signed out ✔; signing in during the grace period lands on S-5h only, and every other API call returns 403 ✔.
- [ ] S-5i cancel → full access back, "account is safe" email.
- [ ] Day 30 job: data gone ✔, Apple token revoked ✔, "deleted" email sent ✔, the email can be used for a new account ✔.
- [ ] S-5j email has no links.

### Cross-cutting
- [ ] VoiceOver / TalkBack / screen reader reads errors (`role="alert"`) and labels every code digit.
- [ ] Dynamic Type at the largest sizes: screens scroll and nothing clips.
- [ ] All targets 44 pt or more.
- [ ] No password, code or token appears in logs, crash reports or analytics (grep the log pipeline in staging ✔).
- [ ] Tokens live where 8.2 says on each platform; nothing in `UserDefaults` / `SharedPreferences` / `localStorage` ✔.

---

## Assumptions

1. **Quiet check numbers:** ≥ 20 wrong passwords in 24 h from ≥ 3 devices or IPs. The decisions doc gives the behaviour but no numbers.
2. **Pause growth:** doubles from 15 minutes up to a 24-hour cap, and resets after 24 hours without failures.
3. **Pause keys:** (device, email) and (IP, email), so a shared office IP can't lock out other people, and the check can run before the account is looked up.
4. **Too many code tries (0b-4e):** the code dies and a new one can be sent straight away (resend limits still apply). The old screen's "wait 5 minutes" wasn't in the decisions, so Task 1 changed it.
5. **0b-5f wait:** shows "15 minutes" to match decision 2. The screen said 5; Task 1 changed it.
6. **Unconfirmed accounts:** purged after 7 days, and replaced (not "already exists") if someone creates the same email again.
7. **Session lifetimes:** access 10 minutes; mobile refresh idle 30 days / absolute 90 days; web idle 7 days / absolute 30 days.
8. **Argon2id parameters:** m = 64 MiB, t = 3, p = 1, tuned to 250–500 ms, with a KMS-held pepper.
9. **Breach check:** a locally hosted copy of Pwned Passwords rather than calling the HIBP API live.
10. **"Contains the email":** the full email, or the local part when it's 5 characters or longer.
11. **Devices without attestation:** allowed with stricter limits (3 an hour) rather than blocked.
12. **Timing floor:** 600 ms ± 50 ms on look-up endpoints.
13. **Password change keeps this device signed in** (fresh tokens). A password *reset* signs everyone out, including the device that did it.
14. **Deletion signs out other devices at once.** This device keeps a restricted session showing only S-5h. Cancelling needs a signed-in person; the deletion email has no links.
15. **Backups** clear within 35 days after deletion.
16. **Apple and Google settings paths** in S-3b/S-3c are as of late 2026. Check them before mid-fi.
17. **0b-3h Apple variant and 0b-8h/8i Apple variants** follow the drawn Google versions with the words swapped. They aren't drawn separately.
18. **Data retention periods** in section 11 are proposals for the DPIA to confirm.
19. **Users are adults (18+)** at launch.

## Open decisions (with recommendations)

- **D1. Look-up limit on busy IPs.** About 10 look-ups an hour per IP will catch innocent people on mobile-carrier IPs (CGNAT).
  - *Recommendation:* apply the per-IP limit only to requests **without** a passing device check, and raise it to 50 an hour for attested traffic. Per-device and per-email limits stay at about 10.
- **D2. App lock.** Today, Money and Health show sensitive figures to anyone holding an unlocked phone.
  - *Recommendation:* add an optional Face ID / passcode lock in Me → Security (off by default, offered in onboarding 0g). Decide before mid-fi, because it changes the cold-start screen.
- **D3. Notification previews.** The morning briefing and bill alerts would show amounts and weights on a locked screen.
  - *Recommendation:* send generic text ("Your morning briefing is ready") by default, with a setting for full previews.
- **D4. Minimum age.** UK GDPR and the Children's Code apply below 18.
  - *Recommendation:* 18+ at launch, with an age statement on 0b-1. Revisit later.
- **D5. Apple `account-delete` events.** Deleting at once is cleaner. The 30-day grace protects against mistakes, but the person can't cancel it themselves.
  - *Recommendation:* keep the 30-day grace, with support-assisted restore.

---

## What's next

### Recommendation: take **Today (1B, timeline) together with meal logging (7a–7e) and the evening check-in (6)** to mid-fi first.

**Why:**

1. **Today is the product.** It's the screen people will open several times a day. It pulls from every area: rings from Apple Health, the timeline from the calendar, the weekly rhythm, logged meals, money, and "chase for Sunday". If Today feels calm and clear, the rest of the app follows. If it doesn't, nothing else rescues it.
2. **It sets the design system.** Mid-fi needs a type ramp, spacing, the ring, timeline rows, card and button styles, and the one accent (if any). Today and logging use nearly all of them, so building them here means Health, Money and Week ahead become mostly assembly. The sign-in screens can then be restyled in a day.
3. **The logging loop is where people quit.** "Ate it", "Log again" and building a meal from components (7b) are the most frequent, most fiddly interactions. They need real tap-count and timing tests, which low-fi can't give.
4. **It's the riskiest flow, not the biggest.** Money and Week ahead are mostly read-only lists. They carry less design risk.

### To decide before starting

1. **Day-one Today.** A new account arriving from 0g has no meals, no rhythm and maybe no Apple Health. v1 doesn't draw this empty state. It's the first screen every new person sees.
2. **What Today shows on web and Android**, where there's no Apple Health or Screen Time. Leave gaps, use manual entry, or use Health Connect on Android?
3. **Plan vs eaten.** Where "Plan A" and the macro targets come from and how they're edited (Me → Meal plan & macro targets). This drives the logging screens.
4. **App lock and notification previews** (D2, D3 above). Both change what Today and the briefing look like when opened from a notification.
5. **The mid-fi visual direction:** keep it strictly greyscale with one accent, light and dark mode, and Dynamic Type behaviour (the rings and timeline must survive the largest text sizes).
6. **Which data sources are live at launch** (Notion, Starling, Trading 212, …). Each is its own connect-and-consent flow and security review.

### Conflicts between v1 and the sign-in work

1. **v1 0b "Continue with email" uses a magic link** ("We'll email you a sign-in link. No password needed." with "Use a password instead"). That contradicts the decisions: email means password, and there are no magic links. v1 0b is **superseded** by 0b-3 and 0b-5.
2. **v2 0b-C3 "Add a password (optional later)"** says "At least 10 characters" and "sign in with a code". Both conflict with the 15-character minimum and one method per email. Superseded by S-2 and the "Change sign-in method · Later" row.
3. **Me (v1) has no Security or Privacy rows,** yet 0c says "Withdraw any time in Me → Privacy" and row 9 needs Me → Security. Add both rows to Me in the next pass.
4. **0g "What should we call you? Filled in from Apple or Google"** only works on the very first Apple sign-in, because Apple sends the name once. The backend must capture it then (2.7 step 6). If the person chose not to share a name, or it was missed, 0g simply shows an empty field. Email accounts always type it.
5. **Notifications open Today and the briefing directly** ("Opened from 07:30 notification"). After a sign-out the push token is removed, so they stop. But a session that expired on the device needs a defined path: tap the notification → 0b-2 → back to the briefing after sign-in. v1 doesn't draw it.
6. **Onboarding order:** v1 numbers 0c as "1 of 5". With sign-up, email accounts see 0b-3 → 0b-4 → 0c. The progress bar should still start at 0c (sign-up isn't counted), which is consistent. Just keep the step count honest if steps are added.
7. **Money connects to banks and brokers** (CSV imports, Trading 212 sync). Those connections need their own credential storage, encrypted with KMS, and should probably ask "Confirm it's you" (S-5b style) before adding or removing one. That isn't designed yet.
