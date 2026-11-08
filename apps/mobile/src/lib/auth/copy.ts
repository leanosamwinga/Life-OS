// Exact on-screen text from docs/sign-in-spec.md sections 3.3 and 3.4. Screens never show
// server text; they map error codes to these strings.
import type { FederatedProvider, SignInMethod } from '@life-os/core';
import type { AuthCode } from './errors';

export const providerName = (p: FederatedProvider | SignInMethod | undefined) =>
  p === 'APPLE' ? 'Apple' : p === 'GOOGLE' ? 'Google' : 'email';

/** Inline password errors (0b-3e/3f, 0b-7, S-2). */
export const PASSWORD_ERRORS: Partial<Record<AuthCode, string>> = {
  PASSWORD_TOO_SHORT: 'Too short. Use at least 15 characters.',
  PASSWORD_TOO_LONG: 'Too long. Use 128 characters or fewer.',
  PASSWORD_BREACHED: 'Found in a data breach. Try another one.',
  PASSWORD_CONTAINS_EMAIL: "Your password can't include your email. Try something else.",
  PASSWORD_SAME_AS_CURRENT: "That's your current password. Choose a new one.",
};

export const PASSWORDS_DONT_MATCH = "Passwords don't match. Type it again.";
export const EMAIL_INVALID = 'Check your email address. It should look like name@example.com.';
export const CODE_INCORRECT = "That code isn't right. Check the latest email and try again.";
export const WRONG_PASSWORD = "That password isn't right. Try again, or reset it.";
export const WRONG_PASSWORD_CHANGE =
  "That password isn't right. Forgotten it? Sign out and use Forgot password.";

export const RULES = {
  length: '15 or more characters',
  breach: 'Not found in known data breaches',
  email: "Doesn't include your email",
};

export interface AlertCopy {
  title: string;
  body: string;
}

/** Shared alerts (spec 3.4) for any auth screen. */
export function sharedAlert(code: AuthCode): AlertCopy | null {
  switch (code) {
    case 'RATE_LIMITED':
      return {
        title: 'Too many tries',
        body: 'Lots of attempts from this device. Wait a while, then try again.',
      };
    case 'DEVICE_CHECK_FAILED':
      return {
        title: "We couldn't check this device",
        body: 'Update Life OS and try again. On the web, refresh the page.',
      };
    case 'DEV_BUILD_REQUIRED':
      // Development only (Expo Go): never seen in a development, TestFlight or App Store build.
      return {
        title: 'Google sign-in needs a development build',
        body: 'Expo Go can’t finish Google sign-in. Use Apple or email here, or run a development build (npx expo run:ios).',
      };
    case 'WEB_APPLE_SETUP':
      // Development only (local web build without an Apple Services ID / HTTPS return address).
      return {
        title: 'Apple sign-in isn’t set up for this web build',
        body: 'Apple sign-in on the web needs an Apple Services ID and an HTTPS address — see README. Use email here.',
      };
    case 'WEB_GOOGLE_SETUP':
      // Development only (local web build without a Google web client id).
      return {
        title: 'Google sign-in isn’t set up for this web build',
        body: 'Google sign-in on the web needs a Google web client id — see README. Use email here.',
      };
    case 'SERVER_ERROR':
    case 'NETWORK':
      return {
        title: 'Something went wrong',
        body: 'Nothing has changed. Check your connection and try again.',
      };
    default:
      return null;
  }
}

/** "15 minutes", "2 hours", "1 hour 5 minutes". */
export function waitText(seconds: number): string {
  const mins = Math.max(1, Math.ceil(seconds / 60));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`;
}

/** "Resend in 30s" / "0:45". */
export function countdownText(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** "12 October 2026" (Europe/London). */
export function longDateUK(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(new Date(iso));
}
