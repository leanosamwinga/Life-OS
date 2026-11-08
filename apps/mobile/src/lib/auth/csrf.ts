/**
 * Web only: the double-submit CSRF token. The web server (src/server/bff.ts) sets a readable
 * `lifeos_csrf` cookie and refuses any non-GET request to /api/auth or /api/supabase whose
 * `X-CSRF-Token` header doesn't match it.
 */
export function csrfToken(cookie: string | undefined = globalThis.document?.cookie): string | null {
  const m = cookie ? /(?:^|; )(?:__Host-)?lifeos_csrf=([^;]+)/.exec(cookie) : null;
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

/** fetch for the web Data API: same-origin cookies plus the CSRF header. */
export function webDataFetch(
  base: typeof fetch = fetch,
  readCookie: () => string | undefined = () => globalThis.document?.cookie,
): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    const token = csrfToken(readCookie());
    if (token) headers.set('X-CSRF-Token', token);
    return base(input, { ...init, headers, credentials: 'same-origin' });
  };
}
