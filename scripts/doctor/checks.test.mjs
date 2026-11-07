import { describe, expect, it } from 'vitest';
import { checkAppEnv, checkFunctionsEnv, checkPhoneUrl, line, parseEnv } from './checks.mjs';

const secrets = Object.fromEntries(
  [
    'AUTH_PASSWORD_PEPPER_V1',
    'AUTH_CODE_HMAC_KEY',
    'AUTH_KEY_HASH_KEY',
    'AUTH_LOG_HMAC_KEY',
    'AUTH_TOKEN_ENC_KEY',
    'AUTH_JOB_SECRET',
  ].map((k) => [k, 'x']),
);
const fn = (extra = {}) => ({
  ...secrets,
  MAILPIT_URL: 'http://host.docker.internal:54324',
  AUTH_DEVICE_CHECKS: 'off',
  APPLE_BUNDLE_ID: 'host.exp.Exponent',
  GOOGLE_CLIENT_IDS: 'web.apps.example.test,ios.apps.example.test',
  ...extra,
});
const app = (extra = {}) => ({
  EXPO_PUBLIC_SUPABASE_URL: 'http://192.168.1.128:54321',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
  EXPO_PUBLIC_DEVICE_CHECKS: 'off',
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios.apps.example.test',
  ...extra,
});

describe('npm run doctor checks', () => {
  it('parses env files with comments and quotes', () => {
    expect(parseEnv('# c\nA=1\nB="two words"\n bad line\nC=\n')).toEqual({
      A: '1',
      B: 'two words',
      C: '',
    });
  });

  it('functions env: missing file, missing secrets, Google id only in the app, device checks', () => {
    expect(checkFunctionsEnv(null, app()).ok).toBe(false);
    expect(checkFunctionsEnv(fn({ AUTH_JOB_SECRET: '' }), app()).detail).toContain(
      'AUTH_JOB_SECRET',
    );
    const google = checkFunctionsEnv(fn({ GOOGLE_CLIENT_IDS: '' }), app());
    expect(google.ok).toBe(false);
    expect(google.detail).toContain('0b-8g');
    expect(checkFunctionsEnv(fn({ GOOGLE_CLIENT_IDS: 'other.apps.example.test' }), app()).ok).toBe(
      false,
    );
    expect(checkFunctionsEnv(fn({ AUTH_DEVICE_CHECKS: 'on' }), app()).ok).toBe(false);
    expect(checkFunctionsEnv(fn({ APPLE_BUNDLE_ID: '' }), app()).ok).toBeNull();
    expect(checkFunctionsEnv(fn(), app()).ok).toBe(true);
  });

  it('app env: missing values, a key from another stack, the secret key', () => {
    const stack = { keys: ['sb_publishable_test'], secretKeys: ['sb_secret_test'] };
    expect(checkAppEnv(null, stack).ok).toBe(false);
    expect(checkAppEnv(app({ EXPO_PUBLIC_SUPABASE_URL: '' }), stack).ok).toBe(false);
    expect(checkAppEnv(app({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'old' }), stack).ok).toBe(false);
    expect(
      checkAppEnv(app({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_test' }), {
        ...stack,
        keys: ['sb_secret_test'],
      }).detail,
    ).toContain('SECRET');
    expect(checkAppEnv(app(), stack).ok).toBe(true);
  });

  it('phone URL: 127.0.0.1 fails for a phone with the Wi-Fi address as the fix', () => {
    const addrs = ['127.0.0.1', '192.168.1.128'];
    const r = checkPhoneUrl('http://127.0.0.1:54321', addrs);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('http://192.168.1.128:54321');
    expect(checkPhoneUrl('http://127.0.0.1:54321', addrs, 'simulator').ok).toBe(true);
    expect(checkPhoneUrl('http://192.168.1.50:54321', addrs).ok).toBe(false);
    expect(checkPhoneUrl('http://192.168.1.128:54321', addrs).ok).toBe(true);
  });

  it('prints one line per check', () => {
    expect(line({ ok: false, name: 'a', detail: 'fix it' })).toBe('✗ a — fix it');
    expect(line({ ok: true, name: 'a', detail: 'ok' })).toBe('✓ a — ok');
  });
});
