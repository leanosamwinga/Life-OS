// Sign-in rules shared by the app and the auth-api edge function (docs/sign-in-spec.md).
// Pure TypeScript, no I/O.

export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;
export const CODE_LENGTH = 6;
export const CODE_TTL_SECONDS = 10 * 60;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_AFTER_SECONDS = 30;
export const RESENDS_PER_HOUR = 5;
export const RESET_TTL_SECONDS = 30 * 60;
export const DELETION_GRACE_DAYS = 30;

/** Every stable error code the API returns (spec 3.2–3.4). The app maps them to copy. */
export const AUTH_ERROR_CODES = [
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'PASSWORD_BREACHED',
  'PASSWORD_CONTAINS_EMAIL',
  'PASSWORD_SAME_AS_CURRENT',
  'EMAIL_INVALID',
  'ACCOUNT_EXISTS',
  'WRONG_METHOD',
  'CODE_INCORRECT',
  'CODE_EXPIRED',
  'CODE_ATTEMPTS_EXCEEDED',
  'CHALLENGE_NOT_FOUND',
  'RESEND_TOO_SOON',
  'RESEND_LIMIT',
  'WRONG_PASSWORD',
  'ACCOUNT_NOT_FOUND',
  'EMAIL_NOT_CONFIRMED',
  'STEP_UP_REQUIRED',
  'SIGN_IN_PAUSED',
  'PROVIDER_ACCOUNT_MISMATCH',
  'TOKEN_INVALID',
  'PROVIDER_ERROR',
  'TICKET_EXPIRED',
  'RESET_LINK_INVALID',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'SESSION_NOT_FOUND',
  'NO_PASSWORD',
  'REAUTH_REQUIRED',
  'CONFIRMATION_MISMATCH',
  'NOT_PENDING',
  'PENDING_DELETION',
  'RATE_LIMITED',
  'DEVICE_CHECK_FAILED',
  'SERVER_ERROR',
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export type SignInMethod = 'PASSWORD' | 'APPLE' | 'GOOGLE';
export type FederatedProvider = 'APPLE' | 'GOOGLE';
export type SessionScope = 'FULL' | 'PENDING_DELETION';

export type PasswordRuleError =
  'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG' | 'PASSWORD_CONTAINS_EMAIL';

/** Trimmed, lower-cased email (spec 1.1). Dots and +tags are kept. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A deliberately simple shape check: something@domain.tld, no spaces, ≤ 254 chars. */
export function isValidEmail(email: string): boolean {
  const value = email.trim();
  return value.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

/** True if the address is an Apple "Hide My Email" relay address. */
export function isPrivateRelayEmail(email: string): boolean {
  return normaliseEmail(email).endsWith('@privaterelay.appleid.com');
}

/** Password text as the server will hash it: NFKC, never trimmed (spec 5.1). */
export function normalisePassword(password: string): string {
  return password.normalize('NFKC');
}

/** Length in Unicode code points after NFKC (spec 5.1). */
export function passwordLength(password: string): number {
  return Array.from(normalisePassword(password)).length;
}

/** Contains the full email, or its local part when that part is 5+ characters (spec 5.1). */
export function passwordContainsEmail(password: string, email: string): boolean {
  const pw = normalisePassword(password).toLowerCase();
  const em = normaliseEmail(email);
  if (!em) return false;
  if (pw.includes(em)) return true;
  const local = em.split('@')[0] ?? '';
  return local.length >= 5 && pw.includes(local);
}

export interface PasswordCheck {
  length: number;
  lengthOk: boolean;
  containsEmail: boolean;
  /** First failing rule in the spec's order, or null. The breach check is separate. */
  error: PasswordRuleError | null;
}

export function checkPassword(password: string, email: string): PasswordCheck {
  const length = passwordLength(password);
  const containsEmail = passwordContainsEmail(password, email);
  let error: PasswordRuleError | null = null;
  if (length < PASSWORD_MIN) error = 'PASSWORD_TOO_SHORT';
  else if (length > PASSWORD_MAX) error = 'PASSWORD_TOO_LONG';
  else if (containsEmail) error = 'PASSWORD_CONTAINS_EMAIL';
  return {
    length,
    lengthOk: length >= PASSWORD_MIN && length <= PASSWORD_MAX,
    containsEmail,
    error,
  };
}

// ---------------------------------------------------------------------------
// SHA-1 (for the k-anonymity breach range only; never for storing anything)
// ---------------------------------------------------------------------------

/** UTF-8 bytes without relying on TextEncoder (core has no DOM/Node types). */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return Uint8Array.from(out);
}

/** Upper-case hex SHA-1 of the UTF-8 bytes of `text`. */
export function sha1Hex(text: string): string {
  const msg = utf8(text);
  const ml = msg.length;
  const withPadding = new Uint8Array(((ml + 9 + 63) >> 6) << 6);
  withPadding.set(msg);
  withPadding[ml] = 0x80;
  const view = new DataView(withPadding.buffer);
  const bitLen = ml * 8;
  view.setUint32(withPadding.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(withPadding.length - 4, bitLen >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPadding.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4]
    .map((n) => (n >>> 0).toString(16).padStart(8, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Splits SHA-1(NFKC password) into the 5-character prefix that may leave the device and the
 * 35-character suffix that never does (spec 5.3).
 */
export function breachRangePrefix(password: string): { prefix: string; suffix: string } {
  const hash = sha1Hex(normalisePassword(password));
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

/** Parses a padded "SUFFIX:COUNT" range body and says whether `suffix` is in it with count ≥ 1. */
export function rangeContains(rangeBody: string, suffix: string): boolean {
  const target = suffix.toUpperCase();
  return rangeBody.split(/\r?\n/).some((line) => {
    const [s, count] = line.trim().split(':');
    return s?.toUpperCase() === target && Number(count) >= 1;
  });
}
