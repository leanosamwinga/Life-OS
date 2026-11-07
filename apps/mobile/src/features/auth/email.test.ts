import { isPlausibleEmail, resolveSignInEmail } from './email';

describe('sign-in email', () => {
  it('accepts plausible emails', () => {
    expect(isPlausibleEmail('user-a@example.test')).toBe(true);
    expect(isPlausibleEmail('nope@')).toBe(false);
  });

  it('maps a bare username to the local dev account only in development', () => {
    expect(resolveSignInEmail('admin', true)).toBe('admin@example.test');
    expect(resolveSignInEmail(' Admin ', true)).toBe('admin@example.test');
    expect(resolveSignInEmail('admin', false)).toBeNull();
    expect(resolveSignInEmail('me@example.test', false)).toBe('me@example.test');
    expect(resolveSignInEmail('not an email', true)).toBeNull();
  });
});
