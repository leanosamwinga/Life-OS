import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  breachRangePrefix,
  checkPassword,
  isValidEmail,
  normaliseEmail,
  passwordContainsEmail,
  passwordLength,
  sha1Hex,
} from './auth.ts';

describe('passwordLength (Unicode code points after NFKC, spec 5.1)', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(passwordLength('😀😀😀')).toBe(3);
  });
  it('normalises compatibility characters first', () => {
    // U+FB01 "ﬁ" ligature becomes "fi" (2 code points) under NFKC.
    expect(passwordLength('ﬁ')).toBe(2);
    // e + combining acute composes to é (1 code point).
    expect(passwordLength('é')).toBe(1);
  });
});

describe('checkPassword', () => {
  const email = 'sam@example.test';
  it('14 fails, 15 passes, 128 passes, 129 fails (spec 12, 3e)', () => {
    expect(checkPassword('a'.repeat(14) + 'x', email).length).toBe(PASSWORD_MIN);
    expect(checkPassword('b'.repeat(14), email).error).toBe('PASSWORD_TOO_SHORT');
    expect(checkPassword('b'.repeat(15), email).error).toBeNull();
    expect(checkPassword('b'.repeat(128), email).error).toBeNull();
    expect(checkPassword('b'.repeat(129), email).error).toBe('PASSWORD_TOO_LONG');
    expect(PASSWORD_MAX).toBe(128);
  });
  it('counts emoji and combining characters after NFKC', () => {
    expect(checkPassword('😀'.repeat(15), email).error).toBeNull();
    expect(checkPassword('😀'.repeat(14), email).error).toBe('PASSWORD_TOO_SHORT');
    // 15 × (e + combining acute) = 15 code points after NFKC, 30 before.
    expect(checkPassword('é'.repeat(14), email).error).toBe('PASSWORD_TOO_SHORT');
    expect(checkPassword('é'.repeat(15), email).error).toBeNull();
  });
  it('rejects a password containing the email or its local part (5+ chars)', () => {
    expect(checkPassword('my sam@example.test password', email).error).toBe(
      'PASSWORD_CONTAINS_EMAIL',
    );
    expect(checkPassword('SAM@EXAMPLE.TEST and more words', email).error).toBe(
      'PASSWORD_CONTAINS_EMAIL',
    );
    // Local part "sam" is shorter than 5, so it's allowed on its own.
    expect(checkPassword('sam likes long walks', email).error).toBeNull();
    expect(passwordContainsEmail('i am samantha really', 'samantha@example.test')).toBe(true);
  });
  it('never trims or strips spaces', () => {
    expect(checkPassword('              x', email).error).toBeNull();
  });
});

describe('emails', () => {
  it('normalises by trimming and lower-casing only', () => {
    expect(normaliseEmail('  Sam.Taylor+x@Example.TEST ')).toBe('sam.taylor+x@example.test');
  });
  it('validates a sensible shape', () => {
    expect(isValidEmail('sam@example.test')).toBe(true);
    expect(isValidEmail('sam@example')).toBe(false);
    expect(isValidEmail('sam example.test')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('k-anonymity breach range', () => {
  it('computes SHA-1 like everyone else', () => {
    expect(sha1Hex('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    expect(sha1Hex('')).toBe('DA39A3EE5E6B4B0D3255BFEF95601890AFD80709');
    expect(sha1Hex('😀 é')).toBe(sha1Hex('😀 é'));
  });
  it('only exposes the first 5 hex characters', () => {
    const { prefix, suffix } = breachRangePrefix('password');
    expect(prefix).toBe('5BAA6');
    expect(prefix).toHaveLength(5);
    expect(suffix).toHaveLength(35);
  });
});
