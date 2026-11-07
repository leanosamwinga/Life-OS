import { describe, expect, it } from 'vitest';
import { configFromEnv } from './config.ts';

// The values supabase/functions/.env.example ships with.
const example: Record<string, string> = {
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  AUTH_PASSWORD_PEPPER_V1: 'local-dev-pepper-NOT-A-SECRET',
  AUTH_CODE_HMAC_KEY: 'local-dev-code-key-NOT-A-SECRET',
  AUTH_KEY_HASH_KEY: 'local-dev-key-hash-NOT-A-SECRET',
  AUTH_LOG_HMAC_KEY: 'local-dev-log-key-NOT-A-SECRET',
  AUTH_TOKEN_ENC_KEY: 'local-dev-token-key-NOT-A-SECRET',
  AUTH_JOB_SECRET: 'local-dev-job-secret-NOT-A-SECRET',
};
const load = (authUrl: string, extra: Record<string, string> = {}) =>
  configFromEnv((k) => ({ ...example, SUPABASE_AUTH_URL: authUrl, ...extra })[k]);

describe('config', () => {
  it('the example env is enough to start a local stack', () => {
    expect(() => load('http://kong:8000/auth/v1')).not.toThrow();
    expect(() => load('http://127.0.0.1:9999')).not.toThrow();
  });

  it('refuses the local-only values on a hosted project', () => {
    expect(() => load('https://abc.supabase.co/auth/v1')).toThrow(/local-only values/);
    const real = Object.fromEntries(
      Object.keys(example)
        .filter((k) => k.startsWith('AUTH_'))
        .map((k) => [k, `real-random-${k}`]),
    );
    expect(() => load('https://abc.supabase.co/auth/v1', real)).not.toThrow();
  });

  it('still requires every secret', () => {
    expect(() => load('http://kong:8000/auth/v1', { AUTH_JOB_SECRET: '' })).toThrow(
      /AUTH_JOB_SECRET must be set/,
    );
  });
});
