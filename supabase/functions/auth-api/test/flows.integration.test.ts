// Main sign-in v3 flows against a REAL Supabase Auth (spec section 12 ✔ items).
// Run: bash scripts/local-auth/start.sh && npm run test:integration
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { APPLE_BUNDLE, APPLE_SERVICES, GOOGLE_CLIENT, localEnv, startHarness, testEmail, type Harness } from './harness.ts';
import { sha256Hex } from '../crypto.ts';

const run = localEnv() ? describe : describe.skip;
const PASSWORD = 'a long and unbreached test passphrase';
const NEW_PASSWORD = 'another long unbreached passphrase';

run('sign-in v3 flows (real Supabase Auth)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(() => h.resetClock());

  async function create(email: string, device = h.device(), password = PASSWORD) {
    return h.call('POST', '/v1/accounts', { email, password }, device);
  }
  async function createConfirmed(email: string, device = h.device()) {
    const c = await create(email, device);
    expect(c.status).toBe(202);
    const r = await h.call('POST', '/v1/accounts/confirm', { challenge_id: c.body.challenge_id, code: h.lastCode(email) }, device);
    expect(r.status).toBe(200);
    return r.body;
  }
  async function signIn(email: string, password: string, device = h.device()) {
    return h.call('POST', '/v1/sessions/password', { email, password }, device);
  }
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  async function liveSession(accessToken: string) {
    const r = await fetch(`${h.env.LOCAL_AUTH_URL}/user`, { headers: { apikey: h.env.LOCAL_ANON_KEY!, Authorization: `Bearer ${accessToken}` } });
    return r.status === 200;
  }

  describe('create with email (0b-3) and confirm (0b-4)', () => {
    it('rejects bad passwords on the server with the spec codes', async () => {
      const email = testEmail('rules');
      const d = h.device();
      expect((await create(email, d, 'b'.repeat(14))).body.error.code).toBe('PASSWORD_TOO_SHORT');
      expect((await create(email, d, 'b'.repeat(129))).body.error.code).toBe('PASSWORD_TOO_LONG');
      expect((await create(email, d, `my ${email} pw`)).body.error.code).toBe('PASSWORD_CONTAINS_EMAIL');
      expect((await create(email, d, 'correct horse battery staple')).body.error.code).toBe('PASSWORD_BREACHED');
      expect((await create('not-an-email', h.device(), PASSWORD)).body.error.code).toBe('EMAIL_INVALID');
    });

    it('accepts 15 and 128 characters; emoji and combining characters counted after NFKC', async () => {
      expect((await create(testEmail('len15'), h.device(), 'q'.repeat(15))).status).toBe(202);
      expect((await create(testEmail('len128'), h.device(), 'q'.repeat(128))).status).toBe(202);
      expect((await create(testEmail('emoji'), h.device(), '😀'.repeat(15))).status).toBe(202);
      expect((await create(testEmail('comb'), h.device(), 'é'.repeat(14))).body.error.code).toBe('PASSWORD_TOO_SHORT');
    });

    it('code: wrong keeps going, the 5th wrong try kills it, expired at 10 min + 1 s', async () => {
      const email = testEmail('code');
      const d = h.device();
      const c = await create(email, d);
      const code = h.lastCode(email);
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 1; i <= 4; i++) {
        const r = await h.call('POST', '/v1/accounts/confirm', { challenge_id: c.body.challenge_id, code: wrong }, d);
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe('CODE_INCORRECT');
      }
      const fifth = await h.call('POST', '/v1/accounts/confirm', { challenge_id: c.body.challenge_id, code: wrong }, d);
      expect(fifth.body.error.code).toBe('CODE_ATTEMPTS_EXCEEDED');
      const dead = await h.call('POST', '/v1/accounts/confirm', { challenge_id: c.body.challenge_id, code }, d);
      expect(dead.body.error.code).toBe('CODE_ATTEMPTS_EXCEEDED');

      const email2 = testEmail('expire');
      const c2 = await create(email2, d);
      h.advance(10 * 60_000 + 1000);
      const late = await h.call('POST', '/v1/accounts/confirm', { challenge_id: c2.body.challenge_id, code: h.lastCode(email2) }, d);
      expect(late.status).toBe(410);
      expect(late.body.error.code).toBe('CODE_EXPIRED');
    });

    it('resend: not before 30 s; a new code cancels the old; the 6th resend in an hour → RESEND_LIMIT', async () => {
      const email = testEmail('resend');
      const d = h.device();
      const c = await create(email, d);
      const first = h.lastCode(email);
      const soon = await h.call('POST', '/v1/codes/resend', { challenge_id: c.body.challenge_id }, d);
      expect(soon.body.error.code).toBe('RESEND_TOO_SOON');
      expect(soon.body.error.retry_after_seconds).toBeGreaterThan(0);
      let challenge = c.body.challenge_id;
      for (let i = 1; i <= 5; i++) {
        h.advance(31_000);
        const r = await h.call('POST', '/v1/codes/resend', { challenge_id: challenge }, d);
        expect(r.status, `resend ${i}`).toBe(202);
        challenge = r.body.challenge_id;
      }
      h.advance(31_000);
      const sixth = await h.call('POST', '/v1/codes/resend', { challenge_id: challenge }, d);
      expect(sixth.body.error.code).toBe('RESEND_LIMIT');
      // The old challenge's code no longer works.
      const old = await h.call('POST', '/v1/accounts/confirm', { challenge_id: c.body.challenge_id, code: first }, d);
      expect(old.body.error.code).toBe('CODE_EXPIRED');
      // The newest works.
      const ok = await h.call('POST', '/v1/accounts/confirm', { challenge_id: challenge, code: h.lastCode(email) }, d);
      expect(ok.status).toBe(200);
      expect(ok.body.account_created).toBe(true);
    });

    it('re-creating an UNCONFIRMED email replaces it, with no "exists" message', async () => {
      const email = testEmail('squat');
      expect((await create(email, h.device(), 'squatter password is long')).status).toBe(202);
      const again = await create(email, h.device(), PASSWORD);
      expect(again.status).toBe(202);
      const d = h.device();
      const ok = await h.call('POST', '/v1/accounts/confirm', { challenge_id: again.body.challenge_id, code: h.lastCode(email) }, d);
      expect(ok.status).toBe(200);
      expect((await signIn(email, PASSWORD)).status).toBe(200);
      expect((await signIn(email, 'squatter password is long')).body.error.code).toBe('WRONG_PASSWORD');
    });

    it('account exists → ACCOUNT_EXISTS; owner alert at most once per 24 h', async () => {
      const email = testEmail('exists');
      await createConfirmed(email);
      for (let i = 0; i < 3; i++) {
        const r = await create(email, h.device());
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('ACCOUNT_EXISTS');
      }
      expect(h.mail.sent.filter((m) => m.to === email && m.subject === 'Someone tried to sign up with your email')).toHaveLength(1);
      h.advance(24 * 3600_000 + 1000);
      await create(email, h.device());
      expect(h.mail.sent.filter((m) => m.to === email && m.subject === 'Someone tried to sign up with your email')).toHaveLength(2);
    });
  });

  describe('sign in with email (0b-5)', () => {
    it('signs in; not found → ACCOUNT_NOT_FOUND; unconfirmed → EMAIL_NOT_CONFIRMED with a new code', async () => {
      const email = testEmail('signin');
      await createConfirmed(email);
      const ok = await signIn(email, PASSWORD);
      expect(ok.status).toBe(200);
      expect(ok.body.scope).toBe('FULL');
      expect(await liveSession(ok.body.tokens.access_token)).toBe(true);
      expect((await signIn(testEmail('nobody'), PASSWORD)).body.error.code).toBe('ACCOUNT_NOT_FOUND');

      const pending = testEmail('pending');
      await create(pending);
      const before = h.mail.sent.length;
      const r = await signIn(pending, PASSWORD);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('EMAIL_NOT_CONFIRMED');
      expect(r.body.error.details.challenge_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(h.mail.sent.length).toBe(before + 1);
      expect((await signIn(pending, 'definitely the wrong password')).body.error.code).toBe('WRONG_PASSWORD');
    });

    it('pause: the 5th wrong try pauses this device; another device still signs in; the right password is refused while paused; doubles; resets after 24 h', async () => {
      const email = testEmail('pause');
      await createConfirmed(email);
      const paused = h.device(undefined, '192.0.2.10');
      for (let i = 1; i <= 4; i++) {
        const r = await signIn(email, `wrong password number ${i}`, paused);
        expect(r.body.error.code).toBe('WRONG_PASSWORD');
        expect(JSON.stringify(r.body)).not.toMatch(/left|remaining|attempt/i);
      }
      const fifth = await signIn(email, 'wrong password number 5', paused);
      expect(fifth.status).toBe(429);
      expect(fifth.body.error.code).toBe('SIGN_IN_PAUSED');
      expect(fifth.body.error.retry_after_seconds).toBeGreaterThan(14 * 60);
      expect(fifth.body.error.retry_after_seconds).toBeLessThanOrEqual(15 * 60);

      expect((await signIn(email, PASSWORD, paused)).body.error.code).toBe('SIGN_IN_PAUSED');
      expect((await signIn(email, PASSWORD, h.device(undefined, '192.0.2.99'))).status).toBe(200);

      // After the pause, 5 more failures → a 30-minute pause (doubling). (Past the hour, so the
      // ~10-an-hour look-up limit, which is checked first, doesn't answer instead.)
      h.advance(61 * 60_000);
      for (let i = 1; i <= 4; i++) await signIn(email, `wrong again ${i}`, paused);
      const second = await signIn(email, 'wrong again 5', paused);
      expect(second.body.error.code).toBe('SIGN_IN_PAUSED');
      expect(second.body.error.retry_after_seconds).toBeGreaterThan(29 * 60);

      // 24 h without failures → back to 15 minutes.
      h.advance(24 * 3600_000 + 31 * 60_000);
      for (let i = 1; i <= 4; i++) await signIn(email, `later wrong ${i}`, paused);
      const reset = await signIn(email, 'later wrong 5', paused);
      expect(reset.body.error.retry_after_seconds).toBeLessThanOrEqual(15 * 60);
      // Never locks the account.
      const [acct] = await h.sql`select status from public.auth_accounts where email_norm = ${email}`;
      expect(acct!.status).toBe('ACTIVE');
    });

    it('quiet check: 20 failures from 3 keys sets the flag; a known device is not challenged; a new device must enter a code', async () => {
      const email = testEmail('stepup');
      const known = h.device();
      await createConfirmed(email, known);
      // 20 wrong passwords spread over 5 devices/IPs (4 each, so none of them is paused), over
      // a few hours (the per-email look-up limit is about 10 an hour).
      for (let dev = 0; dev < 5; dev++) {
        const d = h.device(undefined, `198.18.${dev}.1`);
        for (let i = 0; i < 4; i++) await signIn(email, `spread guess ${dev}-${i}`, d);
        h.advance(61 * 60_000);
      }
      const [flag] = await h.sql`select step_up_required from public.auth_accounts where email_norm = ${email}`;
      expect(flag!.step_up_required).toBe(true);
      expect(h.logs.some((l) => l.includes('auth.stepup.flagged'))).toBe(true);

      expect((await signIn(email, PASSWORD, known)).status).toBe(200);

      const fresh = h.device();
      const r = await signIn(email, PASSWORD, fresh);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('STEP_UP_REQUIRED');
      const mail = h.mail.sent.at(-1)!;
      expect(mail.subject).toBe('Your Life OS sign-in code');
      expect(mail.text).not.toMatch(/password was right/i);
      const ok = await h.call('POST', '/v1/sessions/step-up', { challenge_id: r.body.error.details.challenge_id, code: h.lastCode(email) }, fresh);
      expect(ok.status).toBe(200);
      const [after] = await h.sql`select step_up_required from public.auth_accounts where email_norm = ${email}`;
      expect(after!.step_up_required).toBe(false);
    });

    it('wrong method from the email form: Google → 0b-6a, Apple relay → 0b-6c', async () => {
      const email = testEmail('wm');
      const d = h.device();
      const n = (await h.call('POST', '/v1/auth/nonce', {}, d)).body;
      const t = await h.google.sign({ aud: GOOGLE_CLIENT, sub: `g-${email}`, email, email_verified: true, nonce: n.nonce });
      expect((await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: t, nonce_id: n.nonce_id, nonce: n.nonce, intent: 'CREATE' }, d)).status).toBe(200);
      const r = await signIn(email, PASSWORD);
      expect(r.body.error).toMatchObject({ code: 'WRONG_METHOD', details: { method: 'GOOGLE', is_private_relay: false } });

      const relay = `${Date.now().toString(36)}abc@privaterelay.appleid.com`;
      const n2 = (await h.call('POST', '/v1/auth/nonce', {}, d)).body;
      const t2 = await h.apple.sign({ aud: APPLE_BUNDLE, sub: `a-${relay}`, email: relay, email_verified: 'true', is_private_email: 'true', nonce: await sha256Hex(n2.nonce) });
      expect((await h.call('POST', '/v1/sessions/federated', { provider: 'APPLE', id_token: t2, nonce_id: n2.nonce_id, nonce: n2.nonce, intent: 'CREATE', given_name: 'Sam' }, d)).status).toBe(200);
      const r2 = await signIn(relay, PASSWORD);
      expect(r2.body.error).toMatchObject({ code: 'WRONG_METHOD', details: { method: 'APPLE', is_private_relay: true } });
      // Apple's name was captured on the first sign-in.
      const [p] = await h.sql`select p.display_name from public.profiles p join public.auth_accounts a on a.user_id = p.id where a.email_norm = ${relay}`;
      expect(p!.display_name).toBe('Sam');
    });
  });

  describe('timing (spec 6.3)', () => {
    it('exists / not found / wrong method all take the padded floor', async () => {
      const t = await startHarness({ timingFloorMs: 600 });
      try {
        const email = testEmail('timing');
        const c = await t.call('POST', '/v1/accounts', { email, password: PASSWORD }, t.device());
        await t.call('POST', '/v1/accounts/confirm', { challenge_id: c.body.challenge_id, code: t.lastCode(email) }, t.device());
        const time = async (e: string) => {
          const start = performance.now();
          await t.call('POST', '/v1/sessions/password', { email: e, password: 'some wrong password!!' }, t.device());
          return performance.now() - start;
        };
        const samples = { exists: [] as number[], none: [] as number[] };
        for (let i = 0; i < 4; i++) {
          samples.exists.push(await time(email));
          samples.none.push(await time(testEmail('ghost')));
        }
        const p95 = (xs: number[]) => xs.sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;
        for (const xs of Object.values(samples)) for (const x of xs) expect(x).toBeGreaterThanOrEqual(545);
        expect(Math.abs(p95(samples.exists) - p95(samples.none))).toBeLessThan(110);
      } finally {
        await t.close();
      }
    }, 30_000);
  });

  describe('forgot password (0b-7)', () => {
    it('always 202 and the same body; the right email per account; nothing for unknown', async () => {
      const pw = testEmail('reset-pw');
      await createConfirmed(pw);
      const g = testEmail('reset-g');
      const d = h.device();
      const n = (await h.call('POST', '/v1/auth/nonce', {}, d)).body;
      const t = await h.google.sign({ aud: GOOGLE_CLIENT, sub: `g-${g}`, email: g, email_verified: true, nonce: n.nonce });
      await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: t, nonce_id: n.nonce_id, nonce: n.nonce, intent: 'CREATE' }, d);
      const nobody = testEmail('reset-none');
      const before = h.mail.sent.length;
      const bodies = [];
      for (const e of [pw, g, nobody]) {
        const r = await h.call('POST', '/v1/password-resets', { email: e }, h.device());
        expect(r.status).toBe(202);
        bodies.push(JSON.stringify(r.body));
      }
      expect(new Set(bodies).size).toBe(1);
      const sent = h.mail.sent.slice(before);
      expect(sent.map((m) => [m.to, m.subject])).toEqual([
        [pw, 'Reset your Life OS password'],
        [g, 'About signing in to Life OS'],
      ]);
      expect(sent[1]!.text).toContain('uses Google to sign in');
      expect(sent[1]!.text).not.toContain('#t=');
    });

    it('link works once, expires at 30 min, newer link kills older, 4th request sends nothing', async () => {
      const email = testEmail('reset-link');
      await createConfirmed(email);
      const req = () => h.call('POST', '/v1/password-resets', { email }, h.device());
      await req();
      const first = h.lastLink(email).split('#t=')[1]!;
      await req();
      const second = h.lastLink(email).split('#t=')[1]!;
      expect((await h.call('POST', '/v1/password-resets/verify', { token: first }, h.device())).body.error.code).toBe('RESET_LINK_INVALID');
      expect((await h.call('POST', '/v1/password-resets/verify', { token: second }, h.device())).body).toMatchObject({ email });
      const n = h.mail.sent.length;
      await req();
      const fourth = await req();
      expect(fourth.status).toBe(202);
      expect(h.mail.sent.length).toBe(n + 1); // the 3rd sends, the 4th doesn't
      const third = h.lastLink(email).split('#t=')[1]!;
      h.advance(30 * 60_000 + 1000);
      expect((await h.call('POST', '/v1/password-resets/verify', { token: third }, h.device())).body.error.code).toBe('RESET_LINK_INVALID');
    });

    it('complete: revokes every session (incl. mid-request tokens), emails, confirms an unconfirmed account, never signs in', async () => {
      const email = testEmail('reset-done');
      const s1 = await createConfirmed(email);
      const s2 = (await signIn(email, PASSWORD)).body;
      await h.call('POST', '/v1/password-resets', { email }, h.device());
      const token = h.lastLink(email).split('#t=')[1]!;
      expect((await h.call('POST', '/v1/password-resets/complete', { token, new_password: 'correct horse battery staple' }, h.device())).body.error.code).toBe('PASSWORD_BREACHED');
      const done = await h.call('POST', '/v1/password-resets/complete', { token, new_password: NEW_PASSWORD }, h.device());
      expect(done.status).toBe(204);
      expect(done.body).toBeNull(); // no tokens: the link never signs anyone in
      expect(await liveSession(s1.tokens.access_token)).toBe(false);
      expect(await liveSession(s2.tokens.access_token)).toBe(false);
      expect((await h.call('POST', '/v1/password-resets/complete', { token, new_password: NEW_PASSWORD }, h.device())).body.error.code).toBe('RESET_LINK_INVALID');
      expect(h.mail.sent.at(-1)!.subject).toBe('Your Life OS password was changed');
      expect((await signIn(email, PASSWORD)).body.error.code).toBe('WRONG_PASSWORD');
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);

      const pending = testEmail('reset-unconfirmed');
      await create(pending);
      await h.call('POST', '/v1/password-resets', { email: pending }, h.device());
      const t2 = h.lastLink(pending).split('#t=')[1]!;
      expect((await h.call('POST', '/v1/password-resets/complete', { token: t2, new_password: NEW_PASSWORD }, h.device())).status).toBe(204);
      const [a] = await h.sql`select status from public.auth_accounts where email_norm = ${pending}`;
      expect(a!.status).toBe('ACTIVE');
      expect((await signIn(pending, NEW_PASSWORD)).status).toBe(200);
    });
  });

  describe('Apple and Google (0b-8)', () => {
    async function nonce(d: Record<string, string>) {
      return (await h.call('POST', '/v1/auth/nonce', {}, d)).body as { nonce_id: string; nonce: string };
    }

    it('8g failures: bad signature, wrong aud, wrong iss, expired, reused nonce, missing nonce → TOKEN_INVALID', async () => {
      const d = h.device();
      const email = testEmail('bad');
      const cases: [string, (n: string) => Promise<string>][] = [
        ['signature', (n) => h.google.sign({ aud: GOOGLE_CLIENT, sub: 's', email, email_verified: true, nonce: n }, { key: 'other' })],
        ['aud', (n) => h.google.sign({ aud: 'someone-else', sub: 's', email, email_verified: true, nonce: n })],
        ['iss', (n) => h.google.sign({ aud: GOOGLE_CLIENT, sub: 's', email, email_verified: true, nonce: n, iss: 'https://evil.test' })],
        ['exp', (n) => h.google.sign({ aud: GOOGLE_CLIENT, sub: 's', email, email_verified: true, nonce: n, iat: 1_000_000, exp: 1_000_600 })],
        ['nonce', () => h.google.sign({ aud: GOOGLE_CLIENT, sub: 's', email, email_verified: true })],
      ];
      for (const [name, make] of cases) {
        const n = await nonce(d);
        const r = await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: await make(n.nonce), nonce_id: n.nonce_id, nonce: n.nonce, intent: 'CREATE' }, d);
        expect(r.status, name).toBe(401);
        expect(r.body.error.code, name).toBe('TOKEN_INVALID');
      }
      const n = await nonce(d);
      const good = await h.google.sign({ aud: GOOGLE_CLIENT, sub: `g-${email}`, email, email_verified: true, nonce: n.nonce });
      expect((await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: good, nonce_id: n.nonce_id, nonce: n.nonce, intent: 'CREATE' }, d)).status).toBe(200);
      const reused = await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: good, nonce_id: n.nonce_id, nonce: n.nonce, intent: 'SIGN_IN' }, d);
      expect(reused.body.error.code).toBe('TOKEN_INVALID');
      // A nonce from another device doesn't work either.
      const other = await nonce(h.device());
      const t = await h.google.sign({ aud: GOOGLE_CLIENT, sub: `g-${email}`, email, email_verified: true, nonce: other.nonce });
      expect((await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: t, nonce_id: other.nonce_id, nonce: other.nonce, intent: 'SIGN_IN' }, d)).body.error.code).toBe('TOKEN_INVALID');
    });

    it('8h: create → exists → one-tap ticket; the ticket expires at 2 min and works once', async () => {
      const d = h.device();
      const email = testEmail('ticket');
      const n1 = await nonce(d);
      await h.call('POST', '/v1/sessions/federated', { provider: 'APPLE', id_token: await h.apple.sign({ aud: APPLE_SERVICES, sub: `a-${email}`, email, email_verified: true, nonce: n1.nonce }), nonce_id: n1.nonce_id, nonce: n1.nonce, intent: 'CREATE' }, d);
      const n2 = await nonce(d);
      const exists = await h.call('POST', '/v1/sessions/federated', { provider: 'APPLE', id_token: await h.apple.sign({ aud: APPLE_SERVICES, sub: `a-${email}`, email, email_verified: true, nonce: n2.nonce }), nonce_id: n2.nonce_id, nonce: n2.nonce, intent: 'CREATE' }, d);
      expect(exists.status).toBe(409);
      expect(exists.body.error.code).toBe('ACCOUNT_EXISTS');
      const ticket = exists.body.error.details.ticket;
      expect((await h.call('POST', '/v1/sessions/ticket', { ticket }, h.device())).body.error.code).toBe('TICKET_EXPIRED'); // other device
      const ok = await h.call('POST', '/v1/sessions/ticket', { ticket }, d);
      expect(ok.status).toBe(200);
      expect(ok.body.account_created).toBe(false);
      expect((await h.call('POST', '/v1/sessions/ticket', { ticket }, d)).body.error.code).toBe('TICKET_EXPIRED');
    });

    it('8i: sign in → no account → one-tap create; expires at 2 min', async () => {
      const d = h.device();
      const email = testEmail('create-ticket');
      const n = await nonce(d);
      const r = await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: await h.google.sign({ aud: GOOGLE_CLIENT, sub: `g-${email}`, email, email_verified: true, nonce: n.nonce }), nonce_id: n.nonce_id, nonce: n.nonce, intent: 'SIGN_IN' }, d);
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('ACCOUNT_NOT_FOUND');
      const ok = await h.call('POST', '/v1/sessions/ticket', { ticket: r.body.error.details.ticket }, d);
      expect(ok.status).toBe(200);
      expect(ok.body.account_created).toBe(true);

      const email2 = testEmail('ticket-late');
      const n2 = await nonce(d);
      const r2 = await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: await h.google.sign({ aud: GOOGLE_CLIENT, sub: `g-${email2}`, email: email2, email_verified: true, nonce: n2.nonce }), nonce_id: n2.nonce_id, nonce: n2.nonce, intent: 'SIGN_IN' }, d);
      h.advance(2 * 60_000 + 1000);
      expect((await h.call('POST', '/v1/sessions/ticket', { ticket: r2.body.error.details.ticket }, d)).body.error.code).toBe('TICKET_EXPIRED');
    });

    it('unverified provider email never matches an account', async () => {
      const email = testEmail('unverified');
      await createConfirmed(email);
      const d = h.device();
      const n = await nonce(d);
      const t = await h.google.sign({ aud: GOOGLE_CLIENT, sub: `g-${email}`, email, email_verified: false, nonce: n.nonce });
      const r = await h.call('POST', '/v1/sessions/federated', { provider: 'GOOGLE', id_token: t, nonce_id: n.nonce_id, nonce: n.nonce, intent: 'SIGN_IN' }, d);
      expect(r.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    });
  });

  describe('sessions and Me → Security (row 9)', () => {
    it('refresh rotates; reusing an old refresh token revokes the session', async () => {
      const email = testEmail('refresh');
      const s = await createConfirmed(email);
      const r1 = await h.call('POST', '/v1/tokens/refresh', { refresh_token: s.tokens.refresh_token });
      expect(r1.status).toBe(200);
      expect(r1.body.tokens.refresh_token).not.toBe(s.tokens.refresh_token);
      const reuse = await h.call('POST', '/v1/tokens/refresh', { refresh_token: s.tokens.refresh_token });
      expect(reuse.status).toBe(401);
      expect(reuse.body.error.code).toBe('SESSION_REVOKED');
      const after = await h.call('POST', '/v1/tokens/refresh', { refresh_token: r1.body.tokens.refresh_token });
      expect(after.status).toBe(401);
      expect(await liveSession(r1.body.tokens.access_token)).toBe(false);
      expect(h.logs.some((l) => l.includes('auth.refresh.reuse'))).toBe(true);
    });

    it('refreshing straight through Supabase Auth is refused (refreshes go through auth-api)', async () => {
      const s = await createConfirmed(testEmail('refresh-direct'));
      const res = await fetch(`${h.env.LOCAL_AUTH_URL}/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: h.env.LOCAL_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.tokens.refresh_token }),
      });
      expect(res.status).toBe(403);
      // The token still works through auth-api afterwards.
      expect((await h.call('POST', '/v1/tokens/refresh', { refresh_token: s.tokens.refresh_token })).status).toBe(200);
    });

    it('S-4: list (this device first, no IP); remove one device → its next call is 401; sign out everywhere', async () => {
      const email = testEmail('devices');
      const a = await createConfirmed(email);
      const b = (await signIn(email, PASSWORD, { ...h.device(), 'X-Device-Platform': 'web', 'X-Device-Label': 'MacBook · Safari' })).body;
      const list = await h.call('GET', '/v1/me/sessions', undefined, bearer(a.tokens.access_token));
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
      expect(list.body[0].is_current).toBe(true);
      expect(JSON.stringify(list.body)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      const other = list.body.find((x: { is_current: boolean }) => !x.is_current);
      expect(other.label).toBe('MacBook · Safari');
      expect((await h.call('DELETE', `/v1/me/sessions/${other.id}`, undefined, bearer(a.tokens.access_token))).status).toBe(204);
      expect((await h.call('GET', '/v1/me/security', undefined, bearer(b.tokens.access_token))).status).toBe(401);
      expect(await liveSession(b.tokens.access_token)).toBe(false);
      // Data API guard (pgrst.db_pre_request) refuses the revoked session at once.
      const claims = JSON.parse(Buffer.from(b.tokens.access_token.split('.')[1], 'base64url').toString());
      await expect(h.sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
        await tx`select public.check_request()`;
      })).rejects.toThrow(/Session revoked/);

      expect((await h.call('POST', '/v1/me/sessions/revoke-all', {}, bearer(a.tokens.access_token))).status).toBe(204);
      expect(await liveSession(a.tokens.access_token)).toBe(false);
    });

    it('S-2: change password — wrong current, breached, same as current; then other devices are signed out', async () => {
      const email = testEmail('change');
      const a = await createConfirmed(email);
      const b = (await signIn(email, PASSWORD)).body;
      const change = (current: string, next: string) => h.call('POST', '/v1/me/password', { current_password: current, new_password: next }, { ...bearer(a.tokens.access_token), ...h.device() });
      expect((await change('not my password at all', NEW_PASSWORD)).body.error.code).toBe('WRONG_PASSWORD');
      expect((await change(PASSWORD, 'correct horse battery staple')).body.error.code).toBe('PASSWORD_BREACHED');
      expect((await change(PASSWORD, PASSWORD)).body.error.code).toBe('PASSWORD_SAME_AS_CURRENT');
      const changed = await change(PASSWORD, NEW_PASSWORD);
      expect(changed.status).toBe(200);
      // This device continues with fresh tokens; every other device is out at once.
      expect(await liveSession(changed.body.tokens.access_token)).toBe(true);
      expect(await liveSession(b.tokens.access_token)).toBe(false);
      expect(h.mail.sent.at(-1)!.subject).toBe('Your Life OS password was changed');
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(200);
    });

    it('S-5: delete → PENDING_DELETION scope only; other devices out; cancel restores; DELETE is case-sensitive', async () => {
      const email = testEmail('delete');
      const a = await createConfirmed(email);
      const b = (await signIn(email, PASSWORD)).body;
      const auth = bearer(a.tokens.access_token);
      expect((await h.call('POST', '/v1/me/reauth', { password: 'wrong wrong wrong wrong' }, { ...auth, ...h.device() })).body.error.code).toBe('WRONG_PASSWORD');
      const re = await h.call('POST', '/v1/me/reauth', { password: PASSWORD }, { ...auth, ...h.device() });
      expect(re.status).toBe(200);
      expect((await h.call('POST', '/v1/me/deletion', { reauth_token: re.body.reauth_token, confirmation: 'delete' }, auth)).body.error.code).toBe('CONFIRMATION_MISMATCH');
      const del = await h.call('POST', '/v1/me/deletion', { reauth_token: re.body.reauth_token, confirmation: 'DELETE' }, auth);
      expect(del.status).toBe(202);
      expect(new Date(del.body.deletion_due_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
      expect(await liveSession(b.tokens.access_token)).toBe(false);
      expect(h.mail.sent.at(-1)!.subject).toBe("We're deleting your Life OS account");
      expect(h.mail.sent.at(-1)!.html).not.toContain('<a ');

      // Signing in during the grace period → PENDING_DELETION scope; everything else is 403.
      const again = await signIn(email, PASSWORD);
      expect(again.body.scope).toBe('PENDING_DELETION');
      const pend = bearer(again.body.tokens.access_token);
      expect((await h.call('GET', '/v1/me/security', undefined, pend)).body.error.code).toBe('PENDING_DELETION');
      expect((await h.call('GET', '/v1/me/deletion', undefined, pend)).status).toBe(200);
      expect((await h.call('GET', '/v1/me/export?format=json', undefined, pend)).status).toBe(200);
      const claims = JSON.parse(Buffer.from(again.body.tokens.access_token.split('.')[1], 'base64url').toString());
      await expect(h.sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
        await tx`select public.check_request()`;
      })).rejects.toThrow(/pending deletion/i);

      expect((await h.call('DELETE', '/v1/me/deletion', undefined, pend)).status).toBe(204);
      expect(h.mail.sent.at(-1)!.subject).toBe('Your Life OS account is safe');
      const back = await signIn(email, PASSWORD);
      expect(back.body.scope).toBe('FULL');
    });

    it('export: JSON and a ZIP of CSVs', async () => {
      const email = testEmail('export');
      const a = await createConfirmed(email);
      const j = await h.call('GET', '/v1/me/export?format=json', undefined, bearer(a.tokens.access_token));
      expect(j.status).toBe(200);
      expect(j.body.tables.account[0].email).toBe(email);
      expect(JSON.stringify(j.body)).not.toMatch(/encrypted_password|refresh_token|code_hmac/);
      const res = await h.call('GET', '/v1/me/export?format=csv', undefined, bearer(a.tokens.access_token));
      expect(res.headers.get('content-type')).toBe('application/zip');
    });
  });

  describe('Apple server-to-server notifications (9.4)', () => {
    async function appleAccount(email: string) {
      const d = h.device();
      const n = (await h.call('POST', '/v1/auth/nonce', {}, d)).body;
      const r = await h.call('POST', '/v1/sessions/federated', { provider: 'APPLE', id_token: await h.apple.sign({ aud: APPLE_SERVICES, sub: `a-${email}`, email, email_verified: true, nonce: n.nonce }), nonce_id: n.nonce_id, nonce: n.nonce, intent: 'CREATE' }, d);
      expect(r.status).toBe(200);
      return r.body;
    }
    const event = (type: string, sub: string, key: 'other' | undefined = undefined) =>
      h.apple.sign({ aud: APPLE_SERVICES, jti: `${type}-${sub}-${Math.random()}`, events: JSON.stringify({ type, sub, event_time: Date.now() }) }, key ? { key } : {});

    it('consent-revoked signs out everywhere; email-disabled sets the flag; bad signature is rejected; idempotent', async () => {
      const email = testEmail('webhook');
      const s = await appleAccount(email);
      const sub = `a-${email}`;
      const bad = await h.call('POST', '/v1/webhooks/apple', { payload: await event('consent-revoked', sub, 'other') });
      expect(bad.status).toBe(400);
      expect(h.logs.some((l) => l.includes('auth.webhook.apple.rejected'))).toBe(true);
      expect(await liveSession(s.tokens.access_token)).toBe(true);

      const payload = await event('consent-revoked', sub);
      expect((await h.call('POST', '/v1/webhooks/apple', { payload })).status).toBe(200);
      expect((await h.call('POST', '/v1/webhooks/apple', { payload })).status).toBe(200); // duplicate is fine
      expect(await liveSession(s.tokens.access_token)).toBe(false);

      await h.call('POST', '/v1/webhooks/apple', { payload: await event('email-disabled', sub) });
      const [a] = await h.sql`select email_deliverable from public.auth_accounts where email_norm = ${email}`;
      expect(a!.email_deliverable).toBe(false);
      await h.call('POST', '/v1/webhooks/apple', { payload: await event('email-enabled', sub) });
      const [b] = await h.sql`select email_deliverable from public.auth_accounts where email_norm = ${email}`;
      expect(b!.email_deliverable).toBe(true);
    });
  });

  describe('logging (spec 10.2)', () => {
    it('no password, code, token, link, nonce or full email ever appears in the logs', async () => {
      const all = h.logs.join('\n');
      expect(all.length).toBeGreaterThan(1000);
      for (const forbidden of [PASSWORD, NEW_PASSWORD, 'correct horse battery staple', '#t=', 'eyJ', '@example.test', 'privaterelay']) {
        expect(all, forbidden).not.toContain(forbidden);
      }
      for (const m of h.mail.sent) {
        const code = m.text.match(/\b(\d{6})\b/)?.[1];
        if (code) expect(all).not.toMatch(new RegExp(`(^|\\D)${code}(\\D|$)`));
      }
    });
  });
});
