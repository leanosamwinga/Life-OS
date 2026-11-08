import { csrfToken, webDataFetch } from './csrf';

describe('web CSRF header', () => {
  it('reads the token from either cookie name', () => {
    expect(csrfToken('a=1; __Host-lifeos_csrf=abc%3D; b=2')).toBe('abc=');
    expect(csrfToken('lifeos_csrf=xyz')).toBe('xyz');
    expect(csrfToken('other=1')).toBeNull();
    expect(csrfToken(undefined)).toBeNull();
  });

  it('Data API calls on the web send it with same-origin cookies (writes were refused without it)', async () => {
    const base = jest.fn(async () => new Response('{}'));
    await webDataFetch(base as unknown as typeof fetch, () => 'lifeos_csrf=tok123')(
      '/api/supabase/rest/v1/rpc/log_meal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const init = (base.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('tok123');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(init.credentials).toBe('same-origin');
  });
});
