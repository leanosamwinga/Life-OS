import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkAppEnv,
  checkFunctionsEnv,
  checkLegacySupabaseEnv,
  checkNestedClones,
  checkPhoneUrl,
  findNestedClones,
  line,
  normaliseRemote,
  originFromGitConfig,
  parseEnv,
  supabaseStatus,
  whereLines,
} from './checks.mjs';

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
    expect(checkFunctionsEnv(fn(), app()).ok).toBe(true);
  });

  it('A3: an empty APPLE_BUNDLE_ID is ✗ (not a warning), with the Expo Go value as the fix', () => {
    const r = checkFunctionsEnv(fn({ APPLE_BUNDLE_ID: '' }), app());
    expect(r.ok).toBe(false);
    expect(line(r)).toMatch(/^✗ /);
    expect(r.detail).toContain('APPLE_BUNDLE_ID=host.exp.Exponent for Expo Go (local only)');
  });

  it('A3: an Apple id left only in supabase/.env is ✗ "moved: copy it to supabase/functions/.env"', () => {
    const legacy = { SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID: 'host.exp.Exponent' };
    const r = checkFunctionsEnv(fn({ APPLE_BUNDLE_ID: '' }), app(), undefined, legacy);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain(
      'SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID in supabase/.env moved: copy it to supabase/functions/.env as APPLE_BUNDLE_ID=host.exp.Exponent',
    );
    // One fix for one problem: no second "set it to host.exp.Exponent" next to it.
    expect(r.detail.match(/APPLE_BUNDLE_ID/g)).toHaveLength(1);
    expect(checkLegacySupabaseEnv(legacy, fn({ APPLE_BUNDLE_ID: '' }))).toBeNull();
    // Google moved the same way.
    const g = checkFunctionsEnv(fn({ GOOGLE_CLIENT_IDS: '' }), {}, undefined, {
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: 'web.apps.example.test',
    });
    expect(g.ok).toBe(false);
    expect(g.detail).toContain('moved: copy it to supabase/functions/.env as GOOGLE_CLIENT_IDS=');
    // Already copied: the leftover is only a warning that it can go.
    const left = checkLegacySupabaseEnv(legacy, fn());
    expect(left?.ok).toBeNull();
    expect(left?.detail).toContain('no longer read');
    expect(checkFunctionsEnv(fn(), app(), undefined, legacy).ok).toBe(true);
    expect(checkLegacySupabaseEnv(null, fn())).toBeNull();
  });

  it('A2: finds the stack through `npx supabase status -o env` when the CLI is not installed', () => {
    const calls = [];
    const env = supabaseStatus((cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'supabase')
        throw Object.assign(new Error('spawn supabase ENOENT'), { code: 'ENOENT' });
      return 'API_URL="http://127.0.0.1:54321"\nDB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\nPUBLISHABLE_KEY="sb_publishable_x"\n';
    });
    expect(calls).toEqual(['supabase status -o env', 'npx --yes supabase status -o env']);
    expect(env?.API_URL).toBe('http://127.0.0.1:54321');
    expect(env?.PUBLISHABLE_KEY).toBe('sb_publishable_x');
    // Installed CLI: used directly. Neither answers (stack not started): null.
    expect(supabaseStatus(() => 'API_URL=http://127.0.0.1:54321\n')?.API_URL).toBeTruthy();
    expect(
      supabaseStatus(() => {
        throw new Error('supabase start is not running');
      }),
    ).toBeNull();
  });

  it('A2: every command the doctor prints spells the CLI `npx supabase …`', () => {
    for (const file of ['./doctor.mjs', './checks.mjs']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      // A backticked command (in a string the user reads) never starts with a bare `supabase`.
      expect(src).not.toMatch(/\\?`supabase /);
      expect(src).not.toMatch(/run supabase |start supabase /);
    }
    const r = checkAppEnv({ EXPO_PUBLIC_SUPABASE_URL: 'http://192.168.1.2:54321' }, null);
    expect(r.detail).toContain('`npx supabase status`');
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

describe('doctor: which checkout', () => {
  it('prints the repo path and branch first', () => {
    expect(whereLines('/Users/sample/Life-OS/', 'claude/log-meal-and-water-follow-ups')).toEqual([
      'Repo: /Users/sample/Life-OS',
      'Branch: claude/log-meal-and-water-follow-ups',
    ]);
    expect(whereLines('/x', null)[1]).toBe('Branch: unknown (not a git checkout?)');
  });

  it('normalises remotes so https and ssh match', () => {
    expect(normaliseRemote('https://github.com/Owner/Life-OS.git')).toBe(
      'github.com/owner/life-os',
    );
    expect(normaliseRemote('git@github.com:owner/life-os')).toBe('github.com/owner/life-os');
    expect(
      originFromGitConfig(
        '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:o/r.git\n',
      ),
    ).toBe('git@github.com:o/r.git');
    expect(originFromGitConfig('[core]\n')).toBeNull();
  });

  // A tiny fake file system: dirs map to their entries; files to their text.
  const fakeFs = (tree) => ({
    list: (dir) =>
      Object.keys(tree)
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map((p) => ({ name: p.slice(dir.length + 1), dir: tree[p] === null })),
    read: (p) => (typeof tree[p] === 'string' ? tree[p] : null),
  });
  const cfg = (url) => `[remote "origin"]\n\turl = ${url}\n`;

  it('finds another clone of this repo inside it, not other repos or node_modules', () => {
    const tree = {
      '/r/.git': null,
      '/r/.git/config': cfg('https://github.com/o/life-os'),
      '/r/package.json': '{"name":"life-os"}',
      '/r/apps': null,
      '/r/Life-OS': null,
      '/r/Life-OS/.git': null,
      '/r/Life-OS/.git/config': cfg('git@github.com:o/Life-OS.git'),
      '/r/Life-OS/package.json': '{"name":"life-os"}',
      '/r/vendor': null,
      '/r/vendor/other': null,
      '/r/vendor/other/.git': null,
      '/r/vendor/other/.git/config': cfg('https://github.com/o/other'),
      '/r/node_modules': null,
      '/r/node_modules/x': null,
      '/r/node_modules/x/.git': null,
      '/r/node_modules/x/.git/config': cfg('https://github.com/o/life-os'),
    };
    const found = findNestedClones('/r', fakeFs(tree));
    expect(found).toEqual(['Life-OS']);
    expect(checkNestedClones(found, '/r/')).toEqual({
      ok: null,
      name: 'nested clone',
      detail:
        'Life-OS is another clone of this repo inside /r — run commands from the one you mean, and move the nested one out',
    });
  });

  it('also matches by package name (a clone of a local path has another origin)', () => {
    const tree = {
      '/r/package.json': '{"name":"life-os"}',
      '/r/copy': null,
      '/r/copy/.git': null,
      '/r/copy/package.json': '{"name":"life-os"}',
    };
    expect(findNestedClones('/r', fakeFs(tree))).toEqual(['copy']);
  });

  it('says nothing when there is no nested clone', () => {
    expect(checkNestedClones([], '/r')).toBeNull();
  });
});
