// STEP 2 — the linking gate. Proves, against a REAL running Supabase Auth, that sign-in
// methods are never linked automatically (spec 0.1, 9.3; decisions "Methods are never linked
// automatically"). Run: bash scripts/local-auth/start.sh && npm run test:integration
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  APPLE_BUNDLE,
  GOOGLE_CLIENT,
  localEnv,
  startHarness,
  testEmail,
  type Harness,
} from './harness.ts';
import { sha256Hex } from '../crypto.ts';

const run = localEnv() ? describe : describe.skip;

run('linking gate (real Supabase Auth)', () => {
  let h: Harness;
  const PASSWORD = 'a long and unbreached test passphrase';

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  async function identityRows() {
    const [row] = await h.sql<{ n: number; non_email: number; multi: number }[]>`
      select count(*)::int as n,
             count(*) filter (where provider <> 'email')::int as non_email,
             (select count(*)::int from (select user_id from auth.identities group by user_id having count(*) > 1) x) as multi
        from auth.identities`;
    return row!;
  }

  async function createPasswordAccount(email: string, device = h.device()) {
    const created = await h.call('POST', '/v1/accounts', { email, password: PASSWORD }, device);
    expect(created.status).toBe(202);
    const confirmed = await h.call(
      'POST',
      '/v1/accounts/confirm',
      { challenge_id: created.body.challenge_id, code: h.lastCode(email) },
      device,
    );
    expect(confirmed.status).toBe(200);
    return confirmed.body;
  }

  async function nonceFor(device: Record<string, string>) {
    const r = await h.call('POST', '/v1/auth/nonce', {}, device);
    expect(r.status).toBe(200);
    return r.body as { nonce_id: string; nonce: string };
  }

  async function googleToken(
    email: string,
    sub: string,
    nonce: string,
    extra: Record<string, unknown> = {},
  ) {
    return h.google.sign({ aud: GOOGLE_CLIENT, sub, email, email_verified: true, nonce, ...extra });
  }

  async function appleToken(
    email: string,
    sub: string,
    nonce: string,
    extra: Record<string, unknown> = {},
  ) {
    // Native iOS: the token carries SHA256(raw nonce).
    return h.apple.sign({
      aud: APPLE_BUNDLE,
      sub,
      email,
      email_verified: 'true',
      is_private_email: 'false',
      nonce: await sha256Hex(nonce),
      ...extra,
    });
  }

  async function federated(
    provider: 'GOOGLE' | 'APPLE',
    email: string,
    sub: string,
    intent: 'CREATE' | 'SIGN_IN',
    device = h.device(),
  ) {
    const n = await nonceFor(device);
    const idToken =
      provider === 'GOOGLE'
        ? await googleToken(email, sub, n.nonce)
        : await appleToken(email, sub, n.nonce);
    return h.call(
      'POST',
      '/v1/sessions/federated',
      { provider, id_token: idToken, nonce_id: n.nonce_id, nonce: n.nonce, intent },
      device,
    );
  }

  async function userIdFor(email: string) {
    const [row] = await h.sql<
      { user_id: string }[]
    >`select user_id from public.auth_accounts where email_norm = ${email.toLowerCase()}`;
    return row?.user_id ?? null;
  }

  async function identitiesFor(userId: string) {
    return h.sql<
      { provider: string }[]
    >`select provider from auth.identities where user_id = ${userId}`;
  }

  it('Google or Apple for an email that belongs to a PASSWORD account → WRONG_METHOD, nothing linked', async () => {
    const email = testEmail('gate-pw');
    await createPasswordAccount(email);
    const userId = (await userIdFor(email))!;
    const before = await identityRows();

    for (const provider of ['GOOGLE', 'APPLE'] as const) {
      for (const intent of ['SIGN_IN', 'CREATE'] as const) {
        const r = await federated(provider, email, `${provider}-sub-${email}`, intent);
        expect(r.status, `${provider} ${intent}`).toBe(409);
        expect(r.body.error.code).toBe('WRONG_METHOD');
        expect(r.body.error.details.method).toBe('PASSWORD');
        expect(r.body).not.toHaveProperty('tokens');
      }
    }
    expect(await identitiesFor(userId)).toEqual([{ provider: 'email' }]);
    const [fed] =
      await h.sql`select count(*)::int as n from public.auth_federated_identities where user_id = ${userId}`;
    expect(fed!.n).toBe(0);
    expect(await identityRows()).toEqual(before);
  });

  it('Google ↔ Apple: the other provider for the same email → WRONG_METHOD, nothing linked', async () => {
    const gEmail = testEmail('gate-google');
    const created = await federated('GOOGLE', gEmail, `g-${gEmail}`, 'CREATE');
    expect(created.status).toBe(200);
    expect(created.body.account_created).toBe(true);
    const aEmail = testEmail('gate-apple');
    const createdA = await federated('APPLE', aEmail, `a-${aEmail}`, 'CREATE');
    expect(createdA.status).toBe(200);
    const before = await identityRows();

    const appleForGoogle = await federated('APPLE', gEmail, `a-other-${gEmail}`, 'SIGN_IN');
    expect(appleForGoogle.status).toBe(409);
    expect(appleForGoogle.body.error).toMatchObject({
      code: 'WRONG_METHOD',
      details: { method: 'GOOGLE' },
    });
    const appleCreateForGoogle = await federated('APPLE', gEmail, `a-other-${gEmail}`, 'CREATE');
    expect(appleCreateForGoogle.body.error.code).toBe('WRONG_METHOD');

    const googleForApple = await federated('GOOGLE', aEmail, `g-other-${aEmail}`, 'SIGN_IN');
    expect(googleForApple.status).toBe(409);
    expect(googleForApple.body.error).toMatchObject({
      code: 'WRONG_METHOD',
      details: { method: 'APPLE' },
    });

    for (const e of [gEmail, aEmail]) {
      const uid = (await userIdFor(e))!;
      expect(await identitiesFor(uid)).toEqual([{ provider: 'email' }]);
      const fed =
        await h.sql`select provider from public.auth_federated_identities where user_id = ${uid}`;
      expect(fed).toHaveLength(1);
    }
    expect(await identityRows()).toEqual(before);
  });

  it('email + password sign-up for a Google or Apple email → WRONG_METHOD (0b-3h), nothing linked', async () => {
    for (const provider of ['GOOGLE', 'APPLE'] as const) {
      const email = testEmail(`gate-signup-${provider.toLowerCase()}`);
      expect((await federated(provider, email, `${provider}-${email}`, 'CREATE')).status).toBe(200);
      const uid = (await userIdFor(email))!;
      const [{ encrypted_password: pwBefore }] =
        (await h.sql`select encrypted_password from auth.users where id = ${uid}`) as unknown as [
          { encrypted_password: string | null },
        ];
      const before = await identityRows();

      const r = await h.call('POST', '/v1/accounts', { email, password: PASSWORD }, h.device());
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({ code: 'WRONG_METHOD', details: { method: provider } });

      // No password was set, no identity added, owner alerted once.
      const [{ encrypted_password: pwAfter }] =
        (await h.sql`select encrypted_password from auth.users where id = ${uid}`) as unknown as [
          { encrypted_password: string | null },
        ];
      expect(pwAfter).toBe(pwBefore);
      expect(await identitiesFor(uid)).toEqual([{ provider: 'email' }]);
      expect(await identityRows()).toEqual(before);
      expect(
        h.mail.sent.filter(
          (m) => m.to === email && m.subject === 'Someone tried to sign up with your email',
        ),
      ).toHaveLength(1);
    }
  });

  it('same provider, same email, different sub → PROVIDER_ACCOUNT_MISMATCH, never replaced', async () => {
    const email = testEmail('gate-mismatch');
    expect((await federated('GOOGLE', email, `g1-${email}`, 'CREATE')).status).toBe(200);
    const r = await federated('GOOGLE', email, `g2-${email}`, 'SIGN_IN');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('PROVIDER_ACCOUNT_MISMATCH');
    const fed =
      await h.sql`select subject from public.auth_federated_identities where user_id = ${(await userIdFor(email))!}`;
    expect(fed.map((x) => x.subject)).toEqual([`g1-${email}`]);
  });

  describe('Supabase Auth itself refuses every way around auth-api', () => {
    const anon = () => ({ apikey: h.env.LOCAL_ANON_KEY!, 'Content-Type': 'application/json' });

    it('Google/Apple ID-token sign-in straight to Supabase Auth is refused (providers off)', async () => {
      const email = testEmail('gate-direct');
      await createPasswordAccount(email);
      const before = await identityRows();
      for (const provider of ['google', 'apple']) {
        const idToken = await h.google.sign({
          aud: GOOGLE_CLIENT,
          sub: `direct-${provider}`,
          email,
          email_verified: true,
          nonce: 'n',
        });
        const res = await fetch(`${h.env.LOCAL_AUTH_URL}/token?grant_type=id_token`, {
          method: 'POST',
          headers: anon(),
          body: JSON.stringify({ provider, id_token: idToken, nonce: 'n' }),
        });
        expect(res.status, provider).toBeGreaterThanOrEqual(400);
      }
      // OAuth redirect flow too.
      const authorize = await fetch(`${h.env.LOCAL_AUTH_URL}/authorize?provider=google`, {
        headers: anon(),
        redirect: 'manual',
      });
      expect(authorize.status).toBeGreaterThanOrEqual(400);
      expect(await identityRows()).toEqual(before);
    });

    it('public sign-up, OTP sign-up and anonymous sign-in are refused', async () => {
      const email = testEmail('gate-signup');
      const signup = await fetch(`${h.env.LOCAL_AUTH_URL}/signup`, {
        method: 'POST',
        headers: anon(),
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(signup.status).toBe(422);
      const otp = await fetch(`${h.env.LOCAL_AUTH_URL}/otp`, {
        method: 'POST',
        headers: anon(),
        body: JSON.stringify({ email, create_user: true }),
      });
      expect(otp.status).toBeGreaterThanOrEqual(400);
      const anonSignIn = await fetch(`${h.env.LOCAL_AUTH_URL}/signup`, {
        method: 'POST',
        headers: anon(),
        body: JSON.stringify({}),
      });
      expect(anonSignIn.status).toBeGreaterThanOrEqual(400);
      expect(await userIdFor(email)).toBeNull();
      const [u] = await h.sql`select count(*)::int as n from auth.users where email = ${email}`;
      expect(u!.n).toBe(0);
    });

    it('a password grant straight to Supabase Auth is refused, even with the derived password', async () => {
      const email = testEmail('gate-grant');
      await createPasswordAccount(email);
      const raw = await fetch(`${h.env.LOCAL_AUTH_URL}/token?grant_type=password`, {
        method: 'POST',
        headers: anon(),
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(raw.status).toBe(400); // the stored password is the peppered HMAC, not this
      const { derivePassword } = await import('../password.ts');
      const derived = await derivePassword(PASSWORD, h.config.peppers[0]!);
      const leaked = await fetch(`${h.env.LOCAL_AUTH_URL}/token?grant_type=password`, {
        method: 'POST',
        headers: anon(),
        body: JSON.stringify({ email, password: derived }),
      });
      expect(leaked.status).toBe(403); // custom-access-token hook: no auth-api permit
      expect(await leaked.text()).toContain('Sign in through Life OS');
    });

    it('a magic link / OTP / recovery sent by Supabase Auth never arrives and never signs in', async () => {
      const email = testEmail('gate-otp');
      await createPasswordAccount(email);
      const before = (await (await fetch(`${h.env.LOCAL_MAILPIT_URL}/api/v1/messages`)).json()) as {
        total: number;
      };
      for (const path of ['/otp', '/magiclink', '/recover']) {
        await fetch(`${h.env.LOCAL_AUTH_URL}${path}`, {
          method: 'POST',
          headers: anon(),
          body: JSON.stringify({ email }),
        });
      }
      const after = (await (await fetch(`${h.env.LOCAL_MAILPIT_URL}/api/v1/messages`)).json()) as {
        total: number;
      };
      expect(after.total).toBe(before.total); // Send Email hook: Supabase Auth sends nothing

      // Even with the one-time token (read from the DB, as an attacker with DB access would),
      // Supabase Auth refuses to issue a session without an auth-api permit.
      const [ott] = await h.sql<{ token_hash: string; relates_to: string; token_type: string }[]>`
        select t.token_hash, t.token_type from auth.one_time_tokens t join auth.users u on u.id = t.user_id
         where u.email = ${email} order by t.created_at desc limit 1`;
      if (ott) {
        const type = ott.token_type === 'recovery_token' ? 'recovery' : 'magiclink';
        const v = await fetch(`${h.env.LOCAL_AUTH_URL}/verify`, {
          method: 'POST',
          headers: anon(),
          body: JSON.stringify({ type, token_hash: ott.token_hash }),
        });
        expect(v.status).toBe(403);
      }
    });

    it('auth.identities refuses any non-email identity or a second identity (trigger)', async () => {
      const email = testEmail('gate-trigger');
      await createPasswordAccount(email);
      const uid = (await userIdFor(email))!;
      await expect(
        h.sql`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
              values ('google-sub-x', ${uid}, '{}'::jsonb, 'google', now(), now())`,
      ).rejects.toThrow(/not stored in Supabase Auth/);
      await expect(
        h.sql`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
              values ('second', ${uid}, '{}'::jsonb, 'email', now(), now())`,
      ).rejects.toThrow(/one sign-in method per account/);
    });

    it('a signed-in user cannot set or change a password through Supabase Auth directly', async () => {
      const gEmail = testEmail('gate-setpw');
      const signedIn = await federated('GOOGLE', gEmail, `g-${gEmail}`, 'CREATE');
      expect(signedIn.status).toBe(200);
      // Supabase Auth gives admin-created users a random 64-character password nobody knows
      // (admin.go). auth-api never runs a password check for Apple/Google accounts.
      const [before] =
        await h.sql`select encrypted_password from auth.users where email = ${gEmail}`;
      const res = await fetch(`${h.env.LOCAL_AUTH_URL}/user`, {
        method: 'PUT',
        headers: { ...anon(), Authorization: `Bearer ${signedIn.body.tokens.access_token}` },
        body: JSON.stringify({ password: 'a brand new password that is long' }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      const [u] = await h.sql`select encrypted_password from auth.users where email = ${gEmail}`;
      expect(u!.encrypted_password).toBe(before!.encrypted_password);
      // And a Google account still can't be signed into with a password through auth-api.
      const pw = await h.call(
        'POST',
        '/v1/sessions/password',
        { email: gEmail, password: 'a brand new password that is long' },
        h.device(),
      );
      expect(pw.body.error).toMatchObject({ code: 'WRONG_METHOD', details: { method: 'GOOGLE' } });
    });
  });

  it('every user has exactly one identity, and it is an email identity', async () => {
    const rows = await identityRows();
    expect(rows.non_email).toBe(0);
    expect(rows.multi).toBe(0);
    const [orphans] =
      await h.sql`select count(*)::int as n from auth.users u where not exists (select 1 from auth.identities i where i.user_id = u.id)`;
    expect(orphans!.n).toBe(0);
  });
});
