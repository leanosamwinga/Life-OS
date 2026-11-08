// Not in the functions tsconfig (it imports app code from apps/mobile); bff.ts itself is
// typechecked by the mobile project and this file runs under vitest.
// Decision 10 end to end: the web cookie server (apps/mobile/src/server/bff.ts) in front of
// auth-api in front of a REAL Supabase Auth. The browser side only ever holds cookies.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Bff } from '../../../../apps/mobile/src/server/bff.ts';
import { localEnv, startHarness, testEmail, type Harness } from './harness.ts';

const run = localEnv() ? describe : describe.skip;
const ORIGIN = 'https://app.example.test';
const SUPA = 'https://ref.supabase.example.test';
const PASSWORD = 'a long and unbreached test passphrase';

run('web cookie server (real Supabase Auth)', () => {
  let h: Harness;
  let bff: Bff;
  const upstreamBodies: string[] = [];

  beforeAll(async () => {
    h = await startHarness();
    bff = new Bff({
      supabaseUrl: SUPA,
      anonKey: 'anon',
      origin: ORIGIN,
      secure: true,
      fetchImpl: (async (url: string, init: RequestInit) => {
        const path = url.replace(`${SUPA}/functions/v1/auth-api`, '');
        const res = await h.handle(new Request(`http://127.0.0.1/auth-api${path}`, init));
        const text = await res.clone().text();
        upstreamBodies.push(text);
        return res;
      }) as unknown as typeof fetch,
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  /** A tiny cookie jar standing in for the browser. */
  function browser() {
    const jar = new Map<string, string>();
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    return {
      jar,
      async send(method: string, path: string, body?: unknown) {
        const cookie = [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
        const headers: Record<string, string> = { origin: ORIGIN, 'x-forwarded-for': ip };
        if (cookie) headers.cookie = cookie;
        const csrf = jar.get('__Host-lifeos_csrf');
        if (csrf) headers['x-csrf-token'] = csrf;
        const req = new Request(`${ORIGIN}/api/auth${path}`, {
          method,
          headers: { 'content-type': 'application/json', ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const res = await bff.auth(req, path);
        for (const c of res.headers.getSetCookie()) {
          const [pair, ...attrs] = c.split('; ');
          const [k, v] = pair!.split('=') as [string, string];
          if (attrs.includes('Max-Age=0')) jar.delete(k);
          else jar.set(k, decodeURIComponent(v));
        }
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null, text };
      },
    };
  }

  it('creates an account, confirms it and signs in with nothing but cookies', async () => {
    const b = browser();
    // First call sets the device and CSRF cookies.
    expect((await b.send('GET', '/session')).body).toEqual({ session: null });
    const email = testEmail('bff');
    const created = await b.send('POST', '/v1/accounts', { email, password: PASSWORD });
    expect(created.status).toBe(202);
    const confirmed = await b.send('POST', '/v1/accounts/confirm', {
      challenge_id: created.body.challenge_id,
      code: h.lastCode(email),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.session.user.email).toBe(email);
    expect(confirmed.text).not.toMatch(/refresh_token|access_token/);
    expect(b.jar.has('__Host-lifeos_rt')).toBe(true);

    // Authenticated call through the cookie.
    const security = await b.send('GET', '/v1/me/security');
    expect(security.status).toBe(200);

    // Sign out clears the cookies and the session no longer works.
    const out = await b.send('POST', '/v1/sessions/current/sign-out', {});
    expect(out.status).toBeLessThan(300);
    expect(b.jar.has('__Host-lifeos_rt')).toBe(false);
    expect((await b.send('GET', '/session')).body).toEqual({ session: null });
  });

  it('refreshes through the refresh cookie when the access token cookie is gone', async () => {
    const b = browser();
    await b.send('GET', '/session');
    const email = testEmail('bff-refresh');
    const created = await b.send('POST', '/v1/accounts', { email, password: PASSWORD });
    await b.send('POST', '/v1/accounts/confirm', {
      challenge_id: created.body.challenge_id,
      code: h.lastCode(email),
    });
    const oldRt = b.jar.get('__Host-lifeos_rt');
    b.jar.delete('__Host-lifeos_at');
    const s = await b.send('GET', '/session');
    expect(s.body.session.user.email).toBe(email);
    expect(b.jar.get('__Host-lifeos_rt')).not.toBe(oldRt);
  });

  it('rejects a cross-site request even with valid cookies', async () => {
    const b = browser();
    await b.send('GET', '/session');
    const cookie = [...b.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await bff.auth(
      new Request(`${ORIGIN}/api/auth/v1/accounts`, {
        method: 'POST',
        headers: {
          cookie,
          origin: 'https://evil.example.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: testEmail('x'), password: PASSWORD }),
      }),
      '/v1/accounts',
    );
    expect(res.status).toBe(403);
  });
});
