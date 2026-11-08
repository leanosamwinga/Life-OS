// The small server in front of the web app (decision 10, spec 8.2). Runs as Expo Router API
// routes (src/app/api/**+api.ts) — server code only, never in the browser bundle.
//
// The browser never sees a token:
//   __Host-lifeos_at       access token   httpOnly · Secure · SameSite=Strict · Path=/
//   __Host-lifeos_rt       refresh token  httpOnly · Secure · SameSite=Strict · Path=/
//   __Host-lifeos_device   device ID      httpOnly · Secure · SameSite=Strict · 1 year
//   __Host-lifeos_csrf     CSRF token     readable by the page (double-submit), SameSite=Strict
// Every request that changes something must carry X-CSRF-Token equal to the CSRF cookie and an
// Origin equal to ours. Responses carrying tokens are rewritten to {session: {user, scope}}.

export interface BffConfig {
  /** https://<ref>.supabase.co */
  supabaseUrl: string;
  anonKey: string;
  /** Our own origin, e.g. https://app.lifeos.app (http://localhost:8081 locally). */
  origin: string;
  /** false only for plain-http local development. */
  secure: boolean;
  fetchImpl?: typeof fetch;
}

const AT = '__Host-lifeos_at';
const RT = '__Host-lifeos_rt';
const DEVICE = '__Host-lifeos_device';
const CSRF = '__Host-lifeos_csrf';
const DAY = 86400;

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

function cookie(
  name: string,
  value: string,
  maxAge: number,
  o: { httpOnly: boolean; secure: boolean },
) {
  // __Host- cookies must be Secure with Path=/ and no Domain. Plain-http localhost drops the
  // prefix (browsers refuse __Host- without Secure).
  const n = o.secure ? name : name.replace('__Host-', '');
  return [
    `${n}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Strict',
    o.httpOnly ? 'HttpOnly' : '',
    o.secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function randomId(bytes = 24): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwtPayload(token: string): Record<string, unknown> | null {
  try {
    const p = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** "MacBook · Safari", "Windows · Chrome" — a label for S-4, from the User-Agent. */
export function labelFromUserAgent(ua: string | null): string {
  const s = ua ?? '';
  const os = /iPhone/.test(s)
    ? 'iPhone'
    : /iPad/.test(s)
      ? 'iPad'
      : /Android/.test(s)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(s)
          ? 'MacBook'
          : /Windows/.test(s)
            ? 'Windows'
            : /Linux/.test(s)
              ? 'Linux'
              : 'Computer';
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /Firefox\//.test(s)
      ? 'Firefox'
      : /Chrome\//.test(s)
        ? 'Chrome'
        : /Safari\//.test(s)
          ? 'Safari'
          : 'Browser';
  return `${os} · ${browser}`;
}

/**
 * The browser's IP as seen by our host. A browser can put anything in X-Forwarded-For, so only
 * the host-set headers count: cf-connecting-ip / x-real-ip, else the right-most X-Forwarded-For
 * entry (the one our host's proxy appended). Used for rate limits and S-4 only.
 */
export function trustedClientIp(req: Request): string | null {
  const direct = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip');
  if (direct) return direct.trim();
  const parts = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.at(-1) ?? null;
}

interface TokensBody {
  tokens?: { access_token: string; refresh_token: string; expires_at: number };
  scope?: string;
  account_created?: boolean;
}

export class Bff {
  private readonly fetch: typeof fetch;
  constructor(private readonly c: BffConfig) {
    this.fetch = c.fetchImpl ?? fetch;
  }

  private json(status: number, body: unknown, setCookies: string[] = []) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    for (const c of setCookies) headers.append('Set-Cookie', c);
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  }

  private error(status: number, code: string) {
    return this.json(status, { error: { code, retry_after_seconds: null, details: null } });
  }

  /** CSRF: same-origin Origin + double-submit token on anything that changes state. */
  private csrfOk(req: Request, cookies: Record<string, string>): boolean {
    if (req.method === 'GET' || req.method === 'HEAD') return true;
    const origin = req.headers.get('origin');
    if (origin !== this.c.origin) return false;
    const token = req.headers.get('x-csrf-token');
    const expected = cookies[CSRF] ?? cookies[CSRF.replace('__Host-', '')];
    return Boolean(token && expected && token === expected);
  }

  private get(cookies: Record<string, string>, name: string) {
    return cookies[name] ?? cookies[name.replace('__Host-', '')];
  }

  private sessionCookies(t: NonNullable<TokensBody['tokens']>) {
    const secure = this.c.secure;
    const atAge = Math.max(60, t.expires_at - Math.floor(Date.now() / 1000));
    return [
      cookie(AT, t.access_token, atAge, { httpOnly: true, secure }),
      // Web sessions: idle 7 days, absolute 30 (spec 8.1; enforced server-side too).
      cookie(RT, t.refresh_token, 30 * DAY, { httpOnly: true, secure }),
    ];
  }

  private clearCookies() {
    const secure = this.c.secure;
    return [
      cookie(AT, '', 0, { httpOnly: true, secure }),
      cookie(RT, '', 0, { httpOnly: true, secure }),
    ];
  }

  private sessionFromToken(at: string, scope?: string) {
    const p = jwtPayload(at);
    if (!p) return null;
    return {
      user: { id: String(p.sub), email: typeof p.email === 'string' ? p.email : null },
      scope: scope ?? (p.lifeos_scope === 'PENDING_DELETION' ? 'PENDING_DELETION' : 'FULL'),
    };
  }

  /** Calls auth-api. */
  private upstream(
    req: Request,
    path: string,
    body: string | undefined,
    extra: Record<string, string>,
  ) {
    const h: Record<string, string> = {
      apikey: this.c.anonKey,
      Authorization: `Bearer ${this.c.anonKey}`,
      'Content-Type': 'application/json',
      'X-Device-Platform': 'web',
      'X-Device-Label': labelFromUserAgent(req.headers.get('user-agent')),
      ...extra,
    };
    const ip = trustedClientIp(req);
    if (ip) h['X-Forwarded-For'] = ip;
    const turnstile = req.headers.get('x-turnstile');
    if (turnstile) h['X-Turnstile'] = turnstile;
    const search = new URL(req.url).search;
    return this.fetch(`${this.c.supabaseUrl}/functions/v1/auth-api${path}${search}`, {
      method: req.method,
      headers: h,
      body: req.method === 'GET' || req.method === 'DELETE' ? undefined : body,
    });
  }

  /** A fresh access token from the cookies, refreshing once if it's (nearly) expired. */
  private async accessToken(req: Request, cookies: Record<string, string>, deviceId: string) {
    const at = this.get(cookies, AT);
    const exp = at ? Number(jwtPayload(at)?.exp ?? 0) : 0;
    if (at && exp * 1000 - Date.now() > 30_000) return { at, set: [] as string[] };
    const rt = this.get(cookies, RT);
    if (!rt) return null;
    const res = await this.upstream(
      new Request(req.url, { method: 'POST', headers: req.headers }),
      '/v1/tokens/refresh',
      JSON.stringify({ refresh_token: rt }),
      { 'X-Device-Id': deviceId },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as TokensBody;
    if (!body.tokens) return null;
    return { at: body.tokens.access_token, set: this.sessionCookies(body.tokens) };
  }

  /** /api/auth/* */
  async auth(req: Request, path: string): Promise<Response> {
    const cookies = parseCookies(req.headers.get('cookie'));
    const setCookies: string[] = [];
    let deviceId = this.get(cookies, DEVICE);
    if (!deviceId || !/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) {
      deviceId = randomId(16);
      setCookies.push(
        cookie(DEVICE, deviceId, 365 * DAY, { httpOnly: true, secure: this.c.secure }),
      );
    }
    if (!this.get(cookies, CSRF))
      setCookies.push(
        cookie(CSRF, randomId(), 365 * DAY, { httpOnly: false, secure: this.c.secure }),
      );
    if (!this.csrfOk(req, cookies)) return this.error(403, 'DEVICE_CHECK_FAILED');

    // GET /api/auth/session — who is signed in (no token leaves the server).
    if (path === '/session') {
      const t = await this.accessToken(req, cookies, deviceId);
      const res = this.json(200, { session: t ? this.sessionFromToken(t.at) : null }, [
        ...setCookies,
        ...(t?.set ?? []),
        ...(t ? [] : this.clearCookies()),
      ]);
      return res;
    }
    if (!path.startsWith('/v1/')) return this.error(404, 'SERVER_ERROR');
    // The browser never sends tokens itself.
    if (path === '/v1/tokens/refresh') return this.error(404, 'SERVER_ERROR');

    const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.text();
    const extra: Record<string, string> = { 'X-Device-Id': deviceId };
    const authed = path.startsWith('/v1/me/') || path === '/v1/sessions/current/sign-out';
    if (authed) {
      const t = await this.accessToken(req, cookies, deviceId);
      if (!t)
        return this.json(
          401,
          { error: { code: 'SESSION_REVOKED', retry_after_seconds: null, details: null } },
          [...setCookies, ...this.clearCookies()],
        );
      extra.Authorization = `Bearer ${t.at}`;
      setCookies.push(...t.set);
    }

    const res = await this.upstream(req, path, body, extra);
    const signOut =
      path === '/v1/sessions/current/sign-out' || (path === '/v1/me/sessions/revoke-all' && res.ok);
    if (signOut) setCookies.push(...this.clearCookies());

    // Downloads (export) stream straight through.
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) {
      const headers = new Headers(res.headers);
      for (const c of setCookies) headers.append('Set-Cookie', c);
      headers.set('Cache-Control', 'no-store');
      return new Response(res.body, { status: res.status, headers });
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const tb = parsed as TokensBody | null;
    if (res.ok && tb?.tokens) {
      setCookies.push(...this.sessionCookies(tb.tokens));
      return this.json(
        res.status,
        {
          session: this.sessionFromToken(tb.tokens.access_token, tb.scope),
          scope: tb.scope,
          account_created: tb.account_created ?? false,
        },
        setCookies,
      );
    }
    const code = (parsed as { error?: { code?: string } } | null)?.error?.code;
    if (code === 'SESSION_REVOKED' || code === 'SESSION_EXPIRED')
      setCookies.push(...this.clearCookies());
    return this.json(res.status, parsed, setCookies);
  }

  /** /api/supabase/* — Data API and the food-lookup function, with the cookie's token. */
  async supabase(req: Request, path: string): Promise<Response> {
    const cookies = parseCookies(req.headers.get('cookie'));
    if (!this.csrfOk(req, cookies)) return this.error(403, 'DEVICE_CHECK_FAILED');
    if (!/^\/(rest\/v1\/|functions\/v1\/food-lookup)/.test(path))
      return this.error(404, 'SERVER_ERROR');
    const deviceId = this.get(cookies, DEVICE) ?? randomId(16);
    const t = await this.accessToken(req, cookies, deviceId);
    if (!t)
      return this.json(
        401,
        { code: 'SESSION_REVOKED', message: 'Signed out' },
        this.clearCookies(),
      );
    const headers = new Headers();
    for (const h of [
      'accept',
      'content-type',
      'prefer',
      'range',
      'accept-profile',
      'content-profile',
      'x-client-info',
    ]) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('apikey', this.c.anonKey);
    headers.set('Authorization', `Bearer ${t.at}`);
    const res = await this.fetch(`${this.c.supabaseUrl}${path}${new URL(req.url).search}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
    });
    const out = new Headers(res.headers);
    out.delete('set-cookie');
    out.set('Cache-Control', 'no-store');
    // The Data API says the session is over (public.check_request): drop the cookies too, so
    // the next /api/auth/session says "signed out" (spec 3.3).
    let ended = false;
    if (res.status === 401) {
      const code = await res
        .clone()
        .json()
        .then((b: { code?: string } | null) => b?.code ?? null)
        .catch(() => null);
      ended = code === 'SESSION_REVOKED' || code === 'SESSION_EXPIRED';
    }
    for (const c of ended ? this.clearCookies() : t.set) out.append('Set-Cookie', c);
    return new Response(res.body, { status: res.status, headers: out });
  }
}

export function bffFromEnv(req: Request): Bff {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const origin = process.env.WEB_ORIGIN ?? new URL(req.url).origin;
  return new Bff({ supabaseUrl: url, anonKey, origin, secure: !origin.startsWith('http://') });
}
