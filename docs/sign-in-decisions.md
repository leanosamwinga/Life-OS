# Life OS — Sign up / Sign in decisions

Agreed 6 November 2026, alongside "Life OS — Sign up / Sign in wireframes v3".

## Fixed in the brief

- Sign up and Sign in are separate, explicit paths from Welcome. Each offers Apple, Google and email. Apple appears wherever Google does.
- Email method = email + password (no magic links). Create: email, password, confirm. Sign in: email, password, Forgot password?
- One sign-in method per email. The wrong method shows a message plus a button to the right method.
- Not recognised → button to Create account (email carried over). Already exists → button to Sign in (email carried over). Never redirect automatically.
- Passwords: masked with Show/Hide. Never shown in emails, links, errors or confirmation screens, and never carried between screens.
- Email accounts confirm with a 6-digit code before onboarding. New accounts → 0c; existing → Today.

## Security settings

- Password: at least 15 characters (NIST SP 800-63B-4, password as the only factor). No composition rules. Up to 128 characters, paste allowed. Checked against known breached passwords; can't contain the email.
- Confirmation code: 6 digits, single use, 10 minutes, 5 tries per code. Resend after 30 seconds, at most 5 an hour.
- Reset link: single use, 30 minutes, 3 requests an hour per email. After a reset: other devices signed out, confirmation email sent, sign in again.
- Methods are never linked automatically.

## Decisions from the interview

1. No "tries left" counter.
2. The wrong-password pause applies per device/IP only: 5 tries in 15 minutes, then a 15-minute pause that grows if it continues. It never locks the whole account.
3. Guessing spread across many devices: no lock-out. The next sign-in on a new device asks for an email code (screen 0b-5h).
4. Two-step verification: optional, after launch, in Me → Security. The password minimum stays at 15 until then.
5. Passkeys: the next method after launch. A signed-in user can add one on top of their original method.
6. Hide My Email duplicate accounts: accepted. Support merges them after both accounts are verified.
7. Create with Google/Apple when the account already exists: show a message with a one-tap Sign in (0b-8h).
8. Changing sign-in method: later, from Me → Security. Requires signing in with the current method plus an email code; the old method then stops working.
9. Forgot password on a Google/Apple account: the screen stays neutral, and the inbox gets a "your account uses Google/Apple" email (0b-7e). No account means nothing is sent.
10. Protections against people checking which emails have accounts (messages unchanged):
    - Rate limits per device, IP and email (about 10 an hour), only after the button is tapped.
    - Device checks: App Attest, Play Integrity, Turnstile on web.
    - The same response time whether or not the email exists.
    - An email to the owner when someone tries to create an account with their address.

## Build decisions (7 November 2026)

- Keep Supabase Auth; Supabase's own password hashing replaces Argon2id.
- Breach check: our own k-anonymity check (not Supabase's paid feature).
- Delete account, export (CSV + JSON) and the day-30 deletion job are built with Me → Security now.
- Platforms this pass: iPhone and web. Android sign-in is a follow-up.
- Web sessions in httpOnly cookies through a small server.
- Email through a sender interface; Mailpit locally, provider chosen later.
- Device checks built, off in Expo Go and local development.
- One local seed account (admin@example.test) with a 15+ character password; "admin" shortcut in development only.
- If automatic identity linking can't be reliably blocked, stop and report rather than ship.
