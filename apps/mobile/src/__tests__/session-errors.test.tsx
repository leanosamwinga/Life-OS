// Spec 3.3 for a session the server turns down, through the app's REAL backend (AuthClient +
// supabase-js + sessionAwareFetch) against a scripted fake of auth-api and the Data API:
//   * SESSION_REVOKED / SESSION_EXPIRED from the Data API, auth-api or a refresh → the session is
//     forgotten on this device and the app shows 0a with no message;
//   * PENDING_DELETION from the Data API → auth-api is asked again → S-5h;
//   * "Couldn't load your data" only for network/server errors, and "Try again" really retries.
import path from 'node:path';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { AuthClient } from '@/lib/auth/client';
import { deviceChecksOff } from '@/lib/auth/deviceCheck';
import { sessionAwareFetch } from '@/lib/backend/sessionFetch';
import { supabaseBackend } from '@/lib/backend/supabase';
import type { Backend } from '@/lib/backend/types';
import { createConnection } from '@/lib/supabase';

const APP_DIR = path.resolve(__dirname, '../app');
const API = 'http://stack.test:54321';
const ANON = 'anon-key-for-tests';
const USER = '00000000-0000-4000-8000-000000000001';

const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (k: string) => mockKeychain.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockKeychain.set(k, v),
  deleteItemAsync: async (k: string) => void mockKeychain.delete(k),
}));
let mockBackend: Backend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));
jest.mock('@/lib/notifications', () => ({ requestNotificationPermission: async () => 'granted' }));

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(scope: 'FULL' | 'PENDING_DELETION' = 'FULL', expInSeconds = 600) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256' })}.${b64({
    sub: USER,
    email: 'user-a@example.test',
    role: 'authenticated',
    session_id: '00000000-0000-4000-8000-0000000000aa',
    lifeos_scope: scope,
    iat: now,
    exp: now + expInSeconds,
  })}.sig`;
}
function storeSession(scope: 'FULL' | 'PENDING_DELETION' = 'FULL') {
  mockKeychain.set(
    'lifeos.session',
    JSON.stringify({
      accessToken: jwt(scope),
      refreshToken: 'refresh-1',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }),
  );
  mockKeychain.set('lifeos.device_id', 'test-device-id-0001');
}

const SETTINGS_ROW = {
  user_id: USER,
  target_kcal: null,
  target_protein_g: null,
  target_carbs_g: null,
  target_fat_g: null,
  target_water_ml: null,
  target_steps: null,
  morning_briefing_enabled: true,
  morning_briefing_weekday_time: '07:30:00',
  morning_briefing_weekend_time: '08:30:00',
  evening_checkin_enabled: true,
  evening_checkin_time: '21:30:00',
  event_reminders_enabled: false,
  urgent_bill_alerts_enabled: true,
  statement_import_reminder_enabled: true,
  statement_import_day: 1,
  statement_import_time: '09:00:00',
  quiet_hours_start: '22:30:00',
  quiet_hours_end: '07:00:00',
  app_lock_enabled: false,
  apple_health_choice: null,
  screen_time_choice: null,
  notifications_prompted_at: null,
  onboarding_completed_at: null,
};

type Reply = Response | 'network';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const authError = (status: number, code: string) =>
  json(status, { error: { code, details: null, retry_after_seconds: null } });
const pgrstError = (status: number, code: string, message: string) =>
  json(status, { code, message, details: null, hint: null });

/** A scripted stack. `data` answers every Data API call until replaced. */
function fakeStack() {
  const calls: string[] = [];
  const s = {
    calls,
    data: (_path: string): Reply => {
      if (_path.startsWith('/rest/v1/profiles')) return json(200, [{ display_name: null }]);
      if (_path.startsWith('/rest/v1/user_settings')) return json(200, SETTINGS_ROW);
      if (_path.startsWith('/rest/v1/rpc/has_active_consent')) return json(200, false);
      return json(200, []);
    },
    refresh: (): Reply =>
      json(200, {
        tokens: {
          access_token: jwt('FULL'),
          refresh_token: `refresh-${calls.length}`,
          expires_at: Math.floor(Date.now() / 1000) + 600,
        },
        scope: 'FULL',
      }),
    deletion: (): Reply => authError(404, 'NOT_PENDING'),
    authed: (): Reply => json(200, {}),
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const p = url.pathname + url.search;
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      calls.push(`${init?.method ?? 'GET'} ${p} ${auth.slice(7, 17)}`);
      let r: Reply;
      if (p.startsWith('/functions/v1/auth-api/v1/tokens/refresh')) r = s.refresh();
      else if (p.startsWith('/functions/v1/auth-api/v1/me/deletion')) r = s.deletion();
      else if (p.startsWith('/functions/v1/auth-api/')) r = s.authed();
      else r = s.data(p);
      if (r === 'network') throw new TypeError('Network request failed');
      return r;
    },
  };
  return s;
}

let stack: ReturnType<typeof fakeStack>;
beforeEach(() => {
  mockKeychain.clear();
  stack = fakeStack();
  global.fetch = jest.fn((i: RequestInfo | URL, o?: RequestInit) => stack.fetch(i, o)) as never;
});

function realBackend() {
  const c = createConnection({ url: API, anonKey: ANON })!;
  return supabaseBackend(c.client, c.auth);
}

async function start() {
  mockBackend = realBackend();
  await renderRouter(APP_DIR, { initialUrl: '/' });
}

describe('AuthClient + sessionAwareFetch', () => {
  function client() {
    return new AuthClient({
      mode: 'native',
      baseUrl: `${API}/functions/v1/auth-api`,
      anonKey: ANON,
      deviceCheck: deviceChecksOff,
    });
  }

  it('SESSION_REVOKED from the Data API forgets the session (Keychain too) and signs out', async () => {
    storeSession();
    const auth = client();
    const seen: unknown[] = [];
    auth.onChange((u) => seen.push(u));
    expect(await auth.currentUser()).not.toBeNull();
    const f = sessionAwareFetch(auth, (i, o) => stack.fetch(i, o));
    stack.data = () => pgrstError(401, 'SESSION_REVOKED', 'Session revoked');
    const res = await f(`${API}/rest/v1/profiles`);
    expect(res.status).toBe(401);
    expect(await auth.currentUser()).toBeNull();
    expect(mockKeychain.has('lifeos.session')).toBe(false);
    expect(seen).toEqual([null]);
  });

  it('SESSION_EXPIRED from the Data API, and a token PostgREST rejects, end the session too', async () => {
    for (const reply of [
      pgrstError(401, 'SESSION_EXPIRED', 'Session expired'),
      pgrstError(401, 'PGRST301', 'No suitable key or wrong key type'),
    ]) {
      storeSession();
      const auth = client();
      await auth.currentUser();
      stack.data = () => reply.clone();
      await sessionAwareFetch(auth, (i, o) => stack.fetch(i, o))(`${API}/rest/v1/profiles`);
      expect(await auth.currentUser()).toBeNull();
    }
  });

  it('SESSION_REVOKED / SESSION_EXPIRED from auth-api or a refresh end the session', async () => {
    storeSession();
    let auth = client();
    stack.authed = () => authError(401, 'SESSION_REVOKED');
    await expect(auth.security()).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    expect(await auth.currentUser()).toBeNull();

    storeSession();
    auth = client();
    stack.refresh = () => authError(401, 'SESSION_EXPIRED');
    expect(await auth.refreshNow()).toBeNull();
    expect(await auth.currentUser()).toBeNull();
    expect(mockKeychain.has('lifeos.session')).toBe(false);
  });

  it('"JWT expired" (phone clock behind) refreshes once and retries with the new token', async () => {
    storeSession();
    const auth = client();
    let n = 0;
    stack.data = () => (n++ === 0 ? pgrstError(401, 'PGRST303', 'JWT expired') : json(200, []));
    const res = await sessionAwareFetch(auth, (i, o) => stack.fetch(i, o))(
      `${API}/rest/v1/profiles`,
      { headers: { Authorization: `Bearer ${jwt()}` } },
    );
    expect(res.status).toBe(200);
    expect(stack.calls.filter((c) => c.includes('tokens/refresh'))).toHaveLength(1);
    expect(await auth.currentUser()).not.toBeNull();
  });

  it('PENDING_DELETION from the Data API asks auth-api and switches the scope', async () => {
    storeSession('FULL');
    const auth = client();
    await auth.currentUser();
    stack.data = () => pgrstError(403, 'PENDING_DELETION', 'Account pending deletion');
    stack.deletion = () => json(200, { deletion_due_at: '2026-12-07T10:00:00Z' });
    stack.refresh = () =>
      json(200, {
        tokens: {
          access_token: jwt('PENDING_DELETION'),
          refresh_token: 'refresh-2',
          expires_at: Math.floor(Date.now() / 1000) + 600,
        },
        scope: 'PENDING_DELETION',
      });
    await sessionAwareFetch(auth, (i, o) => stack.fetch(i, o))(`${API}/rest/v1/profiles`);
    expect((await auth.currentUser())?.scope).toBe('PENDING_DELETION');
    expect(stack.calls.some((c) => c.startsWith('GET /functions/v1/auth-api/v1/me/deletion'))).toBe(
      true,
    );
  });

  it('a network error or a 5xx keeps the session', async () => {
    storeSession();
    const auth = client();
    await auth.currentUser();
    const f = sessionAwareFetch(auth, (i, o) => stack.fetch(i, o));
    stack.data = () => 'network';
    await expect(f(`${API}/rest/v1/profiles`)).rejects.toThrow('Network request failed');
    stack.data = () => pgrstError(500, 'XX000', 'boom');
    expect((await f(`${API}/rest/v1/profiles`)).status).toBe(500);
    stack.authed = () => authError(500, 'SERVER_ERROR');
    await expect(auth.security()).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(await auth.currentUser()).not.toBeNull();
    expect(mockKeychain.has('lifeos.session')).toBe(true);
  });
});

describe('the app (spec 3.3)', () => {
  it('a stored session the Data API calls revoked → 0a with no message', async () => {
    storeSession();
    stack.data = () => pgrstError(401, 'SESSION_REVOKED', 'Session revoked');
    await start();
    expect(await screen.findByTestId('screen-0a', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByText(/Couldn’t load your data|Session revoked|signed out/i)).toBeNull();
    expect(mockKeychain.has('lifeos.session')).toBe(false);
  });

  it('SESSION_EXPIRED from a refresh at start-up → 0a with no message', async () => {
    mockKeychain.set(
      'lifeos.session',
      JSON.stringify({ accessToken: jwt('FULL', -60), refreshToken: 'r', expiresAt: 1 }),
    );
    stack.refresh = () => authError(401, 'SESSION_EXPIRED');
    await start();
    expect(await screen.findByTestId('screen-0a', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByText(/Couldn’t load your data/)).toBeNull();
  });

  it('PENDING_DELETION from the Data API → auth-api says pending → S-5h', async () => {
    storeSession('FULL');
    stack.data = () => pgrstError(403, 'PENDING_DELETION', 'Account pending deletion');
    stack.deletion = () => json(200, { deletion_due_at: '2026-12-07T10:00:00Z' });
    stack.refresh = () =>
      json(200, {
        tokens: {
          access_token: jwt('PENDING_DELETION'),
          refresh_token: 'refresh-2',
          expires_at: Math.floor(Date.now() / 1000) + 600,
        },
        scope: 'PENDING_DELETION',
      });
    await start();
    expect(await screen.findByTestId('screen-S-5h', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByText(/Couldn’t load your data/)).toBeNull();
  });

  it('a network error shows "Couldn’t load your data"; Try again really retries', async () => {
    storeSession();
    const ok = stack.data;
    stack.data = () => 'network';
    await start();
    expect(await screen.findByText('Couldn’t load your data', undefined, { timeout: 10_000 }));
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();
    const before = stack.calls.length;
    stack.data = ok;
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(stack.calls.length).toBeGreaterThan(before);
    // Signed in, not onboarded yet → 0c.
    expect(
      await screen.findByTestId('screen-onboarding-consent', undefined, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(mockKeychain.has('lifeos.session')).toBe(true);
  });

  it('a server error shows "Couldn’t load your data" and keeps the session', async () => {
    storeSession();
    stack.data = () => pgrstError(500, 'XX000', 'Something broke');
    await start();
    expect(await screen.findByText('Couldn’t load your data', undefined, { timeout: 10_000 }));
    expect(mockKeychain.has('lifeos.session')).toBe(true);
  });
});
