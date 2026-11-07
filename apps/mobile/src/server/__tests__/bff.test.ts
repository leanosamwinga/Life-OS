import { Bff, labelFromUserAgent, parseCookies, trustedClientIp } from '../bff';

const ORIGIN = 'https://app.example.test';
const SUPA = 'https://ref.supabase.example.test';

function jwt(payload: Record<string, unknown>) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none' })}.${b(payload)}.sig`;
}
const future = () => Math.floor(Date.now() / 1000) + 600;
const AT = jwt({ sub: 'user-1', email: 'a@example.test', exp: future() });

function setup(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  const bff = new Bff({
    supabaseUrl: SUPA,
    anonKey: 'anon',
    origin: ORIGIN,
    secure: true,
    fetchImpl,
  });
  return { bff, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function req(
  path: string,
  init: { method?: string; cookie?: string; csrf?: string; origin?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Version/17 Safari/605.1.15',
  };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.csrf) headers['x-csrf-token'] = init.csrf;
  headers.origin = init.origin ?? ORIGIN;
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const cookieHeader = 'Cookie' as const;
const setCookies = (res: Response) => res.headers.getSetCookie?.() ?? [];

describe('web cookie server (decision 10)', () => {
  it('turns token responses into httpOnly cookies and never returns the tokens', async () => {
    const { bff } = setup(() =>
      json(200, {
        tokens: { access_token: AT, refresh_token: 'rt-1', expires_at: future() },
        scope: 'FULL',
      }),
    );
    const res = await bff.auth(
      req('/api/auth/v1/sign-in/password', {
        cookie: '__Host-lifeos_csrf=c1; __Host-lifeos_device=dev_0123456789abcdef',
        csrf: 'c1',
        body: { email: 'a@example.test' },
      }),
      '/v1/sign-in/password',
    );
    const text = await res.clone().text();
    expect(text).not.toContain('rt-1');
    expect(text).not.toContain(AT);
    expect(JSON.parse(text).session.user.id).toBe('user-1');
    const cookies = setCookies(res).join('\n');
    expect(cookies).toMatch(/__Host-lifeos_at=.*HttpOnly.*Secure/);
    expect(cookies).toMatch(
      /__Host-lifeos_rt=rt-1; Path=\/; Max-Age=\d+; SameSite=Strict; HttpOnly; Secure/,
    );
  });

  it('refuses a state change without the CSRF token or from another origin', async () => {
    const { bff, calls } = setup(() => json(200, {}));
    const a = await bff.auth(
      req('/api/auth/v1/sign-in/password', { cookie: '__Host-lifeos_csrf=c1' }),
      '/v1/sign-in/password',
    );
    const b = await bff.auth(
      req('/api/auth/v1/sign-in/password', {
        cookie: '__Host-lifeos_csrf=c1',
        csrf: 'c1',
        origin: 'https://evil.example.test',
      }),
      '/v1/sign-in/password',
    );
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('adds the bearer token from the cookie for /v1/me and passes the device ID and label', async () => {
    const { bff, calls } = setup(() => json(200, { ok: true }));
    await bff.auth(
      req('/api/auth/v1/me/security', {
        method: 'GET',
        cookie: `__Host-lifeos_at=${AT}; __Host-lifeos_device=dev_0123456789abcdef; __Host-lifeos_csrf=c`,
      }),
      '/v1/me/security',
    );
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe(`${SUPA}/functions/v1/auth-api/v1/me/security`);
    expect(h.Authorization).toBe(`Bearer ${AT}`);
    expect(h['X-Device-Id']).toBe('dev_0123456789abcdef');
    expect(h['X-Device-Label']).toBe('MacBook · Safari');
  });

  it('refreshes from the refresh cookie when the access token has expired', async () => {
    const expired = jwt({ sub: 'user-1', exp: 1 });
    const fresh = jwt({ sub: 'user-1', exp: future() });
    const { bff, calls } = setup((url) =>
      url.endsWith('/v1/tokens/refresh')
        ? json(200, {
            tokens: { access_token: fresh, refresh_token: 'rt-2', expires_at: future() },
          })
        : json(200, { session: null }),
    );
    const res = await bff.auth(
      req('/api/auth/session', {
        method: 'GET',
        cookie: `__Host-lifeos_at=${expired}; __Host-lifeos_rt=rt-1; __Host-lifeos_device=dev_0123456789abcdef; __Host-lifeos_csrf=c`,
      }),
      '/session',
    );
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ refresh_token: 'rt-1' });
    expect((await res.json()).session.user.id).toBe('user-1');
    expect(setCookies(res).join('\n')).toContain('__Host-lifeos_rt=rt-2');
  });

  it('clears the session cookies on sign-out and when a session is revoked', async () => {
    const { bff } = setup(() => json(401, { error: { code: 'SESSION_REVOKED' } }));
    const res = await bff.auth(
      req('/api/auth/v1/me/security', {
        method: 'GET',
        cookie: `__Host-lifeos_at=${AT}; __Host-lifeos_csrf=c; __Host-lifeos_device=dev_0123456789abcdef`,
      }),
      '/v1/me/security',
    );
    expect(setCookies(res).join('\n')).toMatch(/__Host-lifeos_at=; Path=\/; Max-Age=0/);
  });

  it('never lets the browser call the refresh endpoint itself', async () => {
    const { bff, calls } = setup(() => json(200, {}));
    const res = await bff.auth(
      req('/api/auth/v1/tokens/refresh', {
        cookie: '__Host-lifeos_csrf=c',
        csrf: 'c',
        body: { refresh_token: 'x' },
      }),
      '/v1/tokens/refresh',
    );
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('proxies the Data API with the cookie token and strips upstream cookies', async () => {
    const { bff, calls } = setup(
      () =>
        new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' },
        }),
    );
    const res = await bff.supabase(
      new Request(`${ORIGIN}/api/supabase/rest/v1/foods?select=*`, {
        headers: { [cookieHeader.toLowerCase()]: `__Host-lifeos_at=${AT}` },
      }),
      '/rest/v1/foods',
    );
    expect(calls[0]!.url).toBe(`${SUPA}/rest/v1/foods?select=*`);
    expect((calls[0]!.init.headers as Headers).get('authorization')).toBe(`Bearer ${AT}`);
    expect(res.headers.get('set-cookie')).toBeNull();
    const other = await bff.supabase(
      new Request(`${ORIGIN}/api/supabase/auth/v1/admin/users`, {
        headers: { cookie: `__Host-lifeos_at=${AT}` },
      }),
      '/auth/v1/admin/users',
    );
    expect(other.status).toBe(404);
  });

  it('clears the session cookies when the Data API says the session is over (spec 3.3)', async () => {
    const { bff } = setup(() =>
      json(401, { code: 'SESSION_REVOKED', message: 'Session revoked', details: null }),
    );
    const res = await bff.supabase(
      new Request(`${ORIGIN}/api/supabase/rest/v1/profiles`, {
        headers: { cookie: `__Host-lifeos_at=${AT}` },
      }),
      '/rest/v1/profiles',
    );
    expect(res.status).toBe(401);
    expect(setCookies(res).some((c) => /__Host-lifeos_at=;/.test(c) || /Max-Age=0/.test(c))).toBe(
      true,
    );
    // Any other refusal (e.g. RLS, PENDING_DELETION) keeps the cookies.
    const kept = setup(() => json(403, { code: 'PENDING_DELETION', message: 'x' }));
    const res2 = await kept.bff.supabase(
      new Request(`${ORIGIN}/api/supabase/rest/v1/profiles`, {
        headers: { cookie: `__Host-lifeos_at=${AT}` },
      }),
      '/rest/v1/profiles',
    );
    expect(setCookies(res2)).toHaveLength(0);
  });

  it('ignores a browser-supplied X-Forwarded-For and uses the hop our host added', () => {
    const r = (h: Record<string, string>) => new Request(ORIGIN, { headers: h });
    expect(trustedClientIp(r({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(
      trustedClientIp(r({ 'x-forwarded-for': '1.1.1.1', 'cf-connecting-ip': '203.0.113.7' })),
    ).toBe('203.0.113.7');
    expect(trustedClientIp(r({}))).toBeNull();
  });

  it('parses cookies and labels browsers', () => {
    expect(parseCookies('a=1; b=x%3Dy')).toEqual({ a: '1', b: 'x=y' });
    expect(labelFromUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537')).toBe(
      'Windows · Chrome',
    );
  });
});
