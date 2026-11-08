// Acts like the phone, end to end, on the real local stack: the app's own AuthClient and
// Supabase backend (apps/mobile/src/lib), talking to the gateway like Expo Go does
// (→ auth-api in Deno → Supabase Auth; → PostgREST with pgrst.db_pre_request =
// public.check_request → Postgres; → food-lookup). Codes and links come from Mailpit. Apple and
// Google are the stack's local fakes (scripts/local-auth/fakes.mjs): ID tokens signed with keys
// generated on each start, the same way the integration tests fake them.
//
//   npm run local-auth && npm run test:e2e         (Docker-free stack, scripts/local-auth)
//   E2E_API_URL=… E2E_ANON_KEY=… npm run test:e2e  (`npx supabase start`; no Apple/Google fakes,
//                                                   so those tests are skipped; see e2e/stack.ts)
//
// Each "phone" is a fresh copy of the app's modules (its own device ID and Keychain); a
// "relaunch" is a new AuthClient on the same phone. Test names carry the sign-off criteria
// (docs/PHASE2-SIGNOFF.md).
import { createHash } from 'node:crypto';
import {
  dayProgress,
  portionMacros,
  toFood,
  toLondonDate,
  type DailyTargets,
  type Food,
  type MealComponent,
} from '@life-os/core';
import { SignJWT, importJWK } from 'jose';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildTimeline } from '../apps/mobile/src/features/today/timeline';
import type { AuthUser } from '../apps/mobile/src/lib/backend/types';
import { fakeProviders } from './stubs/providers';
import {
  codeFromMailpit,
  findFakes,
  findStack,
  resetTokenFromMailpit,
  uniqueEmail,
  type Stack,
} from './stack';

const stack = findStack();
const fakes = findFakes();
const PASSWORD = 'a perfectly long local e2e password';
const NEW_PASSWORD = 'another entirely different e2e passphrase';

// ---------------------------------------------------------------------------- phones

async function loadApp() {
  vi.resetModules();
  const [supabase, backend, store, types, errors] = await Promise.all([
    import('../apps/mobile/src/lib/supabase'),
    import('../apps/mobile/src/lib/backend/supabase'),
    import('./stubs/expo-secure-store'),
    import('../apps/mobile/src/lib/backend/types'),
    import('../apps/mobile/src/lib/auth/errors'),
  ]);
  return { supabase, backend, store, types, errors };
}
type App = Awaited<ReturnType<typeof loadApp>>;

function launchOn(app: App, s: Stack) {
  const c = app.supabase.createConnection({ url: s.apiUrl, anonKey: s.anonKey })!;
  const backend = app.backend.supabaseBackend(c.client, c.auth);
  const changes: (AuthUser | null)[] = [];
  c.auth.onChange((u) => changes.push(u));
  const keychain = app.store.keychain;
  return {
    ...c,
    backend,
    changes,
    keychain,
    SessionEndedError: app.types.SessionEndedError,
    /** Quit and reopen the app on this phone (same Keychain, same device ID). */
    relaunch: () => launchOn(app, s),
    tokens: () =>
      JSON.parse(keychain.get('lifeos.session') ?? 'null') as {
        accessToken: string;
        refreshToken: string;
      } | null,
  };
}
type Phone = ReturnType<typeof launchOn>;

/** A different phone: its own device ID, Keychain and network address. */
const newPhone = async (s: Stack): Promise<Phone> => launchOn(await loadApp(), s);

const claims = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;

/** What SessionProvider does right after sign-in. */
const loadLikeTheApp = (p: Phone) =>
  Promise.all([p.backend.getProfile(), p.backend.getSettings(), p.backend.hasHealthConsent()]);

/** An AuthError's code and details (spec 3.2), or a failure if `p` didn't throw one. */
async function refused(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as { name?: string; code?: string; details?: Record<string, unknown> };
    if (err?.name === 'AuthError') return { code: err.code!, details: err.details ?? {} };
    throw e;
  }
  throw new Error('expected an AuthError');
}

async function signUp(s: Stack, tag: string, phone?: Phone) {
  const p = phone ?? (await newPhone(s));
  const email = uniqueEmail(tag);
  const t0 = Date.now() - 1000;
  const challenge = await p.auth.createAccount(email, PASSWORD);
  const code = await codeFromMailpit(s, email, t0);
  const result = await p.auth.confirmEmail(challenge.challengeId, code);
  return { p, email, result };
}

async function signInOn(s: Stack, email: string, password = PASSWORD) {
  const p = await newPhone(s);
  await p.auth.signInWithPassword(email, password);
  return p;
}

const rawData = (s: Stack, token: string, path: string, init: RequestInit = {}) =>
  fetch(`${s.apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: s.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    },
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as { code?: string } }));

/** auth-api straight from a device, to read exactly what it answers. */
const rawAuth = (s: Stack, path: string, body: unknown, deviceId = 'e2e-raw-device-0001') =>
  fetch(`${s.apiUrl}/functions/v1/auth-api${path}`, {
    method: 'POST',
    headers: {
      apikey: s.anonKey,
      Authorization: `Bearer ${s.anonKey}`,
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
    },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));

const expectRevoked = async (s: Stack, token: string) =>
  expect(await rawData(s, token, 'profiles?select=id')).toMatchObject({
    status: 401,
    body: { code: 'SESSION_REVOKED' },
  });

// ---------------------------------------------------------------------------- fake Apple/Google

async function idToken(which: 'apple' | 'google', extra: Record<string, unknown>) {
  const f = fakes![which];
  const key = await importJWK(f.privateJwk as Parameters<typeof importJWK>[0], 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: f.issuer,
    aud: which === 'apple' ? fakes!.apple.bundleId : fakes!.google.clientId,
    iat: now,
    exp: now + 600,
    email_verified: true,
    ...extra,
  })
    .setProtectedHeader({ alg: 'RS256', kid: f.kid })
    .sign(key);
}
/** The next Apple sheet signs in as this Apple ID (the app sends SHA-256(nonce) to Apple). */
const asApple = (sub: string, email: string) => {
  fakeProviders.apple = (hashedNonce) => idToken('apple', { sub, email, nonce: hashedNonce });
};
/** The next Google page signs in as this Google account (raw nonce). */
const asGoogle = (sub: string, email: string) => {
  fakeProviders.google = (nonce) => idToken('google', { sub, email, nonce });
};
const subject = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------- tests

describe.skipIf(!stack)('phone end to end on the real stack', () => {
  const s = stack!;
  let sql: postgres.Sql | null = null;
  const targets: DailyTargets = {
    kcal: 2200,
    protein: 150,
    carbs: 220,
    fat: 70,
    waterMl: 2500,
    steps: 9000,
  };

  beforeAll(() => {
    // Every device gets its own network address (auth-api limits look-ups per IP and per device;
    // the gateway appends the real peer address after this one, like Kong does). Random per run,
    // so rate-limit rows left by an earlier run never apply.
    const run = Math.random().toString(36);
    const ipFor = (key: string) => {
      const h = createHash('sha256')
        .update(run + key)
        .digest();
      return `10.${h[0]}.${h[1]}.${h[2]}`;
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      // Google's code exchange (iPhone flow), answered by the fake Google.
      if (url === 'https://oauth2.googleapis.com/token') {
        const code = new URLSearchParams(String(init?.body ?? '')).get('code') ?? '';
        const token = fakeProviders.googleCodes.get(code);
        fakeProviders.googleCodes.delete(code);
        return new Response(JSON.stringify(token ? { id_token: token } : { error: 'bad code' }), {
          status: token ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const headers = new Headers(init?.headers);
      headers.set('X-Forwarded-For', ipFor(headers.get('X-Device-Id') ?? 'data-api'));
      return realFetch(input, { ...init, headers });
    };
    if (s.dbUrl) sql = postgres(s.dbUrl, { max: 2, onnotice: () => undefined });
  });
  afterAll(async () => {
    await sql?.end();
  });

  it('the Data API really runs public.check_request before every request', async () => {
    if (!sql) return;
    const [row] = await sql<{ cfg: string[] | null }[]>`
      select rolconfig as cfg from pg_roles where rolname = 'authenticator'`;
    expect(row?.cfg ?? []).toContain('pgrst.db_pre_request=public.check_request');
    // Anonymous calls pass straight through it (and then RLS/grants decide: anon gets nothing).
    const anon = await rawData(s, s.anonKey, 'foods?select=id&limit=1');
    expect(anon.body.code).toBe('42501');
  });

  it('B1: sign up → code from Mailpit → data reads with the returned token (0b-3 → 0b-4 → 0c)', async () => {
    const { p, result } = await signUp(s, 'signup');
    expect(result).toEqual({ accountCreated: true, scope: 'FULL' });
    const user = await p.auth.currentUser();
    expect(user?.scope).toBe('FULL');
    const [profile, settings, consent] = await loadLikeTheApp(p);
    expect(profile.displayName).toBeNull();
    expect(settings.onboardingCompletedAt).toBeNull();
    expect(consent).toBe(false);
    // The token carries what check_request needs.
    const c = claims(p.tokens()!.accessToken);
    expect(c.lifeos_scope).toBe('FULL');
    expect(typeof c.session_id).toBe('string');
  });

  it('G1, H1–H6: onboarding 0c–0g, log meal 7a–7e, "Ate it", water +250 ml, Today and Health totals', async () => {
    const { p } = await signUp(s, 'phase2');
    const b = p.backend;

    // 0c consent → 0d Apple Health → 0e Screen Time → 0f nudges → 0g name & targets.
    await b.setHealthConsent(true);
    expect(await b.hasHealthConsent()).toBe(true);
    await b.updateSettings({ appleHealthChoice: 'not_now' });
    await b.updateSettings({ screenTimeChoice: 'not_now' });
    await b.updateSettings({
      nudges: { morningBriefing: true, eveningCheckIn: false },
      notificationsPromptedAt: new Date().toISOString(),
    });
    await b.updateProfile({ displayName: 'Sam' });
    await b.updateSettings({ targets: { ...targets } });
    await b.updateSettings({ onboardingCompletedAt: new Date().toISOString() });
    const [profile, settings] = await loadLikeTheApp(p);
    expect(profile.displayName).toBe('Sam');
    expect(settings.appleHealthChoice).toBe('not_now');
    expect(settings.screenTimeChoice).toBe('not_now');
    expect(settings.nudges.eveningCheckIn.enabled).toBe(false);
    expect(settings.targets.kcal).toBe(2200);
    expect(settings.onboardingCompletedAt).not.toBeNull();

    // 7a: roster (empty for a new account) or new.
    expect(await b.listSavedMeals()).toEqual([]);
    // 7c: scan a barcode → food-lookup (global Open Food Facts cache; seed barcode).
    const scanned = await b.lookupBarcode('0000000000017');
    expect(scanned.status).toBe('found');
    if (scanned.status !== 'found') return;
    expect(scanned.source).toBe('open_food_facts');
    const yoghurt = toFood(scanned.food) as Food;
    expect(yoghurt.per100g.kcal).toBe(57);
    // Search (7b "add component" search box).
    const [oats] = (await b.searchFoods('Porridge')).flatMap((f) => toFood(f) ?? []);
    expect(oats?.name).toBe('Porridge oats');
    // 7e: manual entry from the label.
    const own = await b.saveUserFood({
      name: 'Test flapjack',
      brand: null,
      barcode: '0000000000994',
      per100g: { kcal: 420, protein: 6, carbs: 55, fat: 19 },
      packGrams: 60,
      remembered: true,
    });
    const flapjack = toFood(own) as Food;
    // Your own food for a barcode wins over the global cache.
    const mine = await b.lookupBarcode('0000000000994');
    expect(mine).toMatchObject({ status: 'found', source: 'yours' });

    // 7b: build a meal from components, save it to the plan, and log it.
    const components: MealComponent[] = [
      { food: oats!, grams: 80 },
      { food: yoghurt, grams: 150 },
    ];
    const breakfastId = await b.saveMeal({
      id: null,
      name: 'Oats and yoghurt',
      inDailyPlan: true,
      usualTime: '07:30',
      components,
    });
    await b.logMeal({
      name: 'Oats and yoghurt',
      savedMealId: breakfastId,
      loggedAt: new Date().toISOString(),
      components,
    });
    // H4 7d: "how much" uses the amount last time.
    const recent = await b.listRecentFoods(20);
    expect(recent.find((r) => r.food.id === oats!.id)?.grams).toBe(80);
    expect(recent.find((r) => r.food.id === yoghurt.id)?.grams).toBe(150);
    // A one-off meal with the manual food.
    await b.logMeal({
      name: 'Snack',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: flapjack, grams: 60 }],
    });
    // "Ate it" on a plan meal from Today = log the saved meal as it is.
    const roster = await b.listSavedMeals();
    const plan = roster.find((m) => m.id === breakfastId)!;
    expect(plan.inDailyPlan).toBe(true);
    await b.logMeal({
      name: plan.name,
      savedMealId: plan.id,
      loggedAt: new Date().toISOString(),
      components: plan.components,
    });
    // Water quick add (Health).
    await b.addWater(250);

    // Today and Health read exactly what useDay reads and sum it with core.
    const today = toLondonDate(new Date().toISOString());
    const from = new Date(Date.now() - 36 * 3600_000).toISOString();
    const to = new Date(Date.now() + 36 * 3600_000).toISOString();
    const meals = await b.listMealLogs({ from, to });
    const water = await b.listWaterLogs({ from, to });
    expect(meals).toHaveLength(3);
    expect(water.map((w) => w.ml)).toEqual([250]);
    const progress = dayProgress({ meals, water }, targets, today);
    // 2 × (oats 80 g = 300 kcal + yoghurt 150 g = 86 kcal) + flapjack 60 g = 252 kcal.
    expect(progress.kcal.consumed).toBe(2 * (300 + 86) + 252);
    expect(progress.water.consumed).toBe(250);
  });

  it('refresh rotates; reusing the old refresh token revokes the session; then → 0a', async () => {
    const { p } = await signUp(s, 'refresh');
    const before = p.tokens()!;
    const fresh = await p.auth.refreshNow();
    expect(fresh).not.toBeNull();
    expect(p.tokens()!.refreshToken).not.toBe(before.refreshToken);
    await loadLikeTheApp(p); // the new token works on the Data API
    // Someone replays the old refresh token (spec 8.1: any reuse revokes the session).
    const replay = await fetch(`${s.apiUrl}/functions/v1/auth-api/v1/tokens/refresh`, {
      method: 'POST',
      headers: {
        apikey: s.anonKey,
        Authorization: `Bearer ${s.anonKey}`,
        'Content-Type': 'application/json',
        'X-Device-Id': 'e2e-replaying-device-01',
      },
      body: JSON.stringify({ refresh_token: before.refreshToken }),
    });
    expect(replay.status).toBe(401);
    // E1: the phone's next Data API call is refused by check_request → session forgotten → 0a.
    await expect(p.backend.getProfile()).rejects.toBeInstanceOf(p.SessionEndedError);
    expect(await p.auth.currentUser()).toBeNull();
    expect(p.keychain.has('lifeos.session')).toBe(false);
    expect(p.changes.at(-1)).toBeNull();
  });

  it('sign out ends the session on the server too (the old token is refused)', async () => {
    const { p } = await signUp(s, 'signout');
    const token = p.tokens()!.accessToken;
    expect((await rawData(s, token, 'profiles?select=id')).status).toBe(200);
    await p.auth.signOut();
    expect(await p.auth.currentUser()).toBeNull();
    await expectRevoked(s, token);
  });

  it('E1 ROOT CAUSE: a token kept in the Keychain whose session is gone (db reset / restart) → 0a, not a dead error', async () => {
    if (!sql) return;
    const { p } = await signUp(s, 'stale');
    const sessionId = claims(p.tokens()!.accessToken).session_id as string;
    // What `npx supabase db reset` (or stopping without a backup) does to every session.
    await sql`delete from auth.sessions where id = ${sessionId}`;
    // Relaunch the app: it signs in from the Keychain without asking the server…
    const relaunched = p.relaunch();
    expect(await relaunched.auth.currentUser()).not.toBeNull();
    // …and the Data API says SESSION_REVOKED. The app forgets the session instead of showing
    // "Couldn't load your data — Session revoked" with a "Try again" that can never work.
    await expect(loadLikeTheApp(relaunched)).rejects.toBeInstanceOf(p.SessionEndedError);
    expect(await relaunched.auth.currentUser()).toBeNull();
    expect(p.keychain.has('lifeos.session')).toBe(false);
  });

  it('E2, F2: delete account → PENDING_DELETION from the Data API → S-5h; other devices out; Keep my account', async () => {
    const { p, email } = await signUp(s, 'delete');
    const other = await signInOn(s, email);
    const otherToken = other.tokens()!.accessToken;
    const reauth = await p.auth.reauthWithPassword(PASSWORD);
    await p.auth.requestDeletion(reauth);
    expect((await p.auth.currentUser())?.scope).toBe('PENDING_DELETION');
    const token = p.tokens()!.accessToken;
    expect(await rawData(s, token, 'profiles?select=id')).toMatchObject({
      status: 403,
      body: { code: 'PENDING_DELETION' },
    });
    await expectRevoked(s, otherToken);
    expect(await p.auth.getDeletion()).not.toBeNull();
    await p.auth.cancelDeletion();
    expect((await p.auth.currentUser())?.scope).toBe('FULL');
    await loadLikeTheApp(p);
    expect(await p.auth.getDeletion()).toBeNull();
  });

  // ------------------------------------------------------------------ B6 wrong method

  describe.skipIf(!fakes)('Apple and Google (fake providers on the local stack)', () => {
    it('B3, C2: Apple and Google create → sign out → sign in again (0b-8h on a second create)', async () => {
      for (const provider of ['APPLE', 'GOOGLE'] as const) {
        const email = uniqueEmail(`fed-${provider.toLowerCase()}`);
        const sub = subject(provider);
        const as = provider === 'APPLE' ? asApple : asGoogle;
        as(sub, email);
        const p = await newPhone(s);
        expect(await p.auth.signInWithProvider(provider, 'CREATE')).toEqual({
          accountCreated: true,
          scope: 'FULL',
        });
        await loadLikeTheApp(p);
        const first = p.tokens()!.accessToken;
        await p.auth.signOut();
        await expectRevoked(s, first);
        as(sub, email);
        expect((await p.auth.signInWithProvider(provider, 'SIGN_IN')).accountCreated).toBe(false);
        expect((await loadLikeTheApp(p))[0]).toBeTruthy();
        // 0b-8h: "Create account" with an account that exists → a one-tap ticket, no duplicate.
        as(sub, email);
        const exists = await refused(p.auth.signInWithProvider(provider, 'CREATE'));
        expect(exists).toMatchObject({ code: 'ACCOUNT_EXISTS', details: { method: provider } });
        expect((await p.auth.useTicket(String(exists.details.ticket))).accountCreated).toBe(false);
      }
    });

    it('B6: a password account tried with Apple or Google → WRONG_METHOD (PASSWORD); nothing linked', async () => {
      const { email } = await signUp(s, 'wm-pw');
      for (const provider of ['APPLE', 'GOOGLE'] as const) {
        (provider === 'APPLE' ? asApple : asGoogle)(subject('wm'), email);
        const p = await newPhone(s);
        const e = await refused(p.auth.signInWithProvider(provider, 'SIGN_IN'));
        expect(e).toMatchObject({ code: 'WRONG_METHOD', details: { method: 'PASSWORD' } });
        expect(await p.auth.currentUser()).toBeNull();
      }
      if (sql) {
        const [row] = await sql<{ n: number }[]>`
          select count(*)::int as n from public.auth_federated_identities f
            join public.auth_accounts a on a.user_id = f.user_id where a.email_norm = ${email}`;
        expect(row!.n).toBe(0);
      }
    });

    it('B6: an Apple account tried on the password form → WRONG_METHOD (APPLE); Apple ↔ Google too', async () => {
      const email = uniqueEmail('wm-apple');
      asApple(subject('apple'), email);
      await (await newPhone(s)).auth.signInWithProvider('APPLE', 'CREATE');
      const p = await newPhone(s);
      expect(await refused(p.auth.signInWithPassword(email, PASSWORD))).toMatchObject({
        code: 'WRONG_METHOD',
        details: { method: 'APPLE' },
      });
      // Creating a password account for it is refused the same way (0b-3h).
      expect(await refused(p.auth.createAccount(email, PASSWORD))).toMatchObject({
        code: 'WRONG_METHOD',
        details: { method: 'APPLE' },
      });
      asGoogle(subject('google'), email);
      expect(await refused(p.auth.signInWithProvider('GOOGLE', 'SIGN_IN'))).toMatchObject({
        code: 'WRONG_METHOD',
        details: { method: 'APPLE' },
      });
      expect(await p.auth.currentUser()).toBeNull();
    });

    it('A4/B4 server side: after a reset erased the account, Apple sign-in → ACCOUNT_NOT_FOUND (0b-8i) with a one-tap ticket', async () => {
      const email = uniqueEmail('erased');
      const sub = subject('erased');
      asApple(sub, email);
      const p = await newPhone(s);
      const e = await refused(p.auth.signInWithProvider('APPLE', 'SIGN_IN'));
      expect(e.code).toBe('ACCOUNT_NOT_FOUND');
      expect(typeof e.details.ticket).toBe('string');
      expect((await p.auth.useTicket(String(e.details.ticket))).accountCreated).toBe(true);
    });
  });

  // ------------------------------------------------------------------ B7 forgot password

  it('B7: forgot password — Mailpit link → new password works, old fails, other sessions end, the link never signs anyone in', async () => {
    const { p: a, email } = await signUp(s, 'reset');
    const b = await signInOn(s, email);
    const tokens = [a.tokens()!.accessToken, b.tokens()!.accessToken];

    const c = await newPhone(s);
    const t0 = Date.now() - 1000;
    await c.auth.requestPasswordReset(email);
    const token = await resetTokenFromMailpit(s, email, t0);

    // Opening the link (0b-7f) and setting the password (0b-7k) hand out no session.
    const verify = await rawAuth(s, '/v1/password-resets/verify', { token });
    expect(verify.status).toBe(200);
    expect(verify.text).not.toMatch(/access_token|refresh_token|"tokens"/);
    expect(JSON.parse(verify.text)).toMatchObject({ email });
    const done = await rawAuth(s, '/v1/password-resets/complete', {
      token,
      new_password: NEW_PASSWORD,
    });
    expect(done.status).toBeLessThan(300);
    expect(done.text).not.toMatch(/access_token|refresh_token|"tokens"/);
    expect(await c.auth.currentUser()).toBeNull();
    expect(c.keychain.has('lifeos.session')).toBe(false);

    // Every other session has ended.
    for (const t of tokens) await expectRevoked(s, t);
    await expect(a.backend.getProfile()).rejects.toBeInstanceOf(a.SessionEndedError);
    expect(await a.auth.currentUser()).toBeNull();

    // The link works once.
    const again = await rawAuth(s, '/v1/password-resets/complete', {
      token,
      new_password: 'yet another long e2e passphrase',
    });
    expect(again.status).toBe(410);
    expect(again.text).toContain('RESET_LINK_INVALID');

    // Old password fails; the new one signs in.
    expect(await refused(c.auth.signInWithPassword(email, PASSWORD))).toMatchObject({
      code: 'WRONG_PASSWORD',
    });
    await c.auth.signInWithPassword(email, NEW_PASSWORD);
    await loadLikeTheApp(c);
  });

  // ------------------------------------------------------------------ B8 new device

  it('B8: new device while the quiet check is set → STEP_UP_REQUIRED → code from Mailpit → signed in', async () => {
    if (!sql) return;
    const { p: known, email } = await signUp(s, 'stepup');
    // Without the flag a new device signs straight in (spec 1.3: only the quiet check sets it).
    const plain = await signInOn(s, email);
    await loadLikeTheApp(plain);
    // The quiet check (>= 20 wrong passwords from >= 3 devices/IPs in 24 h — proved in
    // auth-api/test/flows.integration.test.ts with a moved clock) sets this flag.
    await sql`update public.auth_accounts set step_up_required = true, step_up_set_at = now()
               where email_norm = ${email}`;
    // A known device isn't challenged.
    await known.auth.signOut();
    await known.auth.signInWithPassword(email, PASSWORD);
    await loadLikeTheApp(known);

    const fresh = await newPhone(s);
    const t0 = Date.now() - 1000;
    const e = await refused(fresh.auth.signInWithPassword(email, PASSWORD));
    expect(e.code).toBe('STEP_UP_REQUIRED');
    expect(await fresh.auth.currentUser()).toBeNull();
    const code = await codeFromMailpit(s, email, t0, 'Your Life OS sign-in code');
    // A wrong code doesn't sign in.
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await refused(fresh.auth.stepUp(String(e.details.challenge_id), wrong))).code).toBe(
      'CODE_INCORRECT',
    );
    await fresh.auth.stepUp(String(e.details.challenge_id), code);
    expect((await fresh.auth.currentUser())?.scope).toBe('FULL');
    await loadLikeTheApp(fresh);
    const [flag] = await sql<{ step_up_required: boolean }[]>`
      select step_up_required from public.auth_accounts where email_norm = ${email}`;
    expect(flag!.step_up_required).toBe(false);
  });

  // ------------------------------------------------------------------ E4 devices

  it('E4: signed-in devices — list, sign out one, sign out everywhere; ended tokens get SESSION_REVOKED', async () => {
    const { p: a, email } = await signUp(s, 'devices');
    const b = await signInOn(s, email);
    const c = await signInOn(s, email);
    const sid = (p: Phone) => claims(p.tokens()!.accessToken).session_id as string;

    const list = await a.auth.listSessions();
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ id: sid(a), isCurrent: true, label: 'iPhone' });
    expect(list.filter((d) => d.isCurrent)).toHaveLength(1);
    expect(new Set(list.map((d) => d.id))).toEqual(new Set([sid(a), sid(b), sid(c)]));
    expect(JSON.stringify(list)).not.toMatch(/\b10\.\d+\.\d+\.\d+\b/); // never an IP address

    // Sign out one (S-4b).
    const bToken = b.tokens()!.accessToken;
    await a.auth.revokeSession(sid(b));
    await expectRevoked(s, bToken);
    await expect(b.backend.getProfile()).rejects.toBeInstanceOf(b.SessionEndedError);
    expect(await b.auth.currentUser()).toBeNull();
    expect((await a.auth.listSessions()).map((d) => d.id).sort()).toEqual([sid(a), sid(c)].sort());
    await loadLikeTheApp(c); // the others carry on

    // Sign out everywhere (S-4) → this device to 0a too.
    const tokens = [a.tokens()!.accessToken, c.tokens()!.accessToken];
    await a.auth.revokeAllSessions();
    expect(await a.auth.currentUser()).toBeNull();
    for (const t of tokens) await expectRevoked(s, t);
    await expect(c.backend.getProfile()).rejects.toBeInstanceOf(c.SessionEndedError);
  });

  // ------------------------------------------------------------------ F1 change password

  it('F1: change password — wrong current refused; this device keeps working; other devices signed out; old password fails', async () => {
    const { p: a, email } = await signUp(s, 'change');
    const b = await signInOn(s, email);
    const bToken = b.tokens()!.accessToken;

    expect(
      (await refused(a.auth.changePassword('not my current password at all', NEW_PASSWORD))).code,
    ).toBe('WRONG_PASSWORD');
    await loadLikeTheApp(b); // nothing changed yet

    await a.auth.changePassword(PASSWORD, NEW_PASSWORD);
    await loadLikeTheApp(a); // this device carries on with fresh tokens
    expect((await a.auth.currentUser())?.scope).toBe('FULL');
    await expectRevoked(s, bToken);
    await expect(b.backend.getProfile()).rejects.toBeInstanceOf(b.SessionEndedError);

    const later = await newPhone(s);
    expect(await refused(later.auth.signInWithPassword(email, PASSWORD))).toMatchObject({
      code: 'WRONG_PASSWORD',
    });
    await later.auth.signInWithPassword(email, NEW_PASSWORD);
    await loadLikeTheApp(later);
  });

  // ------------------------------------------------------------------ F3 export

  it('F3: export returns JSON and CSV with this user’s data only', async () => {
    const mine = await signUp(s, 'export-me');
    const theirs = await signUp(s, 'export-them');
    for (const { p } of [mine, theirs]) {
      await p.backend.setHealthConsent(true);
      await p.backend.addWater(250);
    }
    await mine.p.backend.updateProfile({ displayName: 'Exporter' });
    await theirs.p.backend.updateProfile({ displayName: 'Someone else' });
    const myId = (await mine.p.auth.currentUser())!.id;
    const theirId = (await theirs.p.auth.currentUser())!.id;

    const download = (format: 'json' | 'csv') =>
      fetch(`${s.apiUrl}/functions/v1/auth-api/v1/me/export?format=${format}`, {
        headers: {
          apikey: s.anonKey,
          Authorization: `Bearer ${mine.p.tokens()!.accessToken}`,
          'X-Device-Id': 'e2e-export-device-01',
        },
      });

    const json = await download('json');
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');
    const doc = (await json.json()) as {
      format: string;
      tables: Record<string, Record<string, unknown>[]>;
    };
    expect(doc.format).toBe('life-os-export-v1');
    expect(doc.tables.account?.[0]?.email).toBe(mine.email);
    expect(doc.tables.profiles?.map((r) => r.id)).toEqual([myId]);
    expect(doc.tables.water_logs?.map((r) => r.ml)).toEqual([250]);
    const text = JSON.stringify(doc);
    expect(text).not.toContain(theirId);
    expect(text).not.toContain(theirs.email);
    expect(text).not.toContain('Someone else');
    expect(text).not.toMatch(/password_hash|encrypted_password|refresh_token/);

    const csv = await download('csv');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-disposition')).toMatch(/life-os-export-.*\.zip/);
    const zip = Buffer.from(await csv.arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe('PK'); // stored ZIP: the CSVs are readable as is
    const raw = zip.toString('utf8');
    expect(raw).toContain('water_logs.csv');
    expect(raw).toContain(myId);
    expect(raw).toContain('Exporter');
    expect(raw).not.toContain(theirId);
    expect(raw).not.toContain(theirs.email);
  });

  // ------------------------------------------------------------------ G2 consent

  it('G2: consent "Not now" — health writes refused, everything else works; withdrawing later stops health writes', async () => {
    const { p } = await signUp(s, 'consent');
    const b = p.backend;
    const [oats] = (await b.searchFoods('Porridge')).flatMap((f) => toFood(f) ?? []);
    const meal = {
      name: 'Porridge',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: oats!, grams: 50 }],
    };
    const range = {
      from: new Date(Date.now() - 36 * 3600_000).toISOString(),
      to: new Date(Date.now() + 36 * 3600_000).toISOString(),
    };

    const HEALTH_OFF = /Health data is off/; // the app's copy for RLS/consent refusals (42501)

    // 0c "Not now": no consent recorded.
    expect(await b.hasHealthConsent()).toBe(false);
    await expect(b.logMeal(meal)).rejects.toThrow(HEALTH_OFF);
    await expect(b.addWater(250)).rejects.toThrow(HEALTH_OFF);
    // Non-health data still works, and onboarding can finish.
    await b.updateProfile({ displayName: 'No consent' });
    await b.updateSettings({
      targets: { ...targets },
      onboardingCompletedAt: new Date().toISOString(),
    });
    expect((await b.getProfile()).displayName).toBe('No consent');
    expect((await b.getSettings()).onboardingCompletedAt).not.toBeNull();
    expect(await b.listMealLogs(range)).toEqual([]);

    // Consent given later (Me → Privacy): health writes work.
    await b.setHealthConsent(true);
    await b.logMeal(meal);
    await b.addWater(250);
    expect(await b.listMealLogs(range)).toHaveLength(1);

    // Withdrawn: processing stops (writes refused, health rows no longer readable); the rest works.
    await b.setHealthConsent(false);
    expect(await b.hasHealthConsent()).toBe(false);
    await expect(b.logMeal(meal)).rejects.toThrow(HEALTH_OFF);
    await expect(b.addWater(250)).rejects.toThrow(HEALTH_OFF);
    expect(await b.listMealLogs(range)).toEqual([]);
    expect(await b.listWaterLogs(range)).toEqual([]);
    await b.updateProfile({ displayName: 'Still here' });
    expect((await b.getProfile()).displayName).toBe('Still here');
  });

  // ------------------------------------------------------------------ H3, H5, H6, H7

  it('H3: an unknown barcode → not found → your own food saves and is found by barcode next time (only for you)', async () => {
    const barcode = `0000${String(Date.now()).slice(-9)}`;
    const { p } = await signUp(s, 'unknown-barcode');
    await p.backend.setHealthConsent(true);
    expect(await p.backend.lookupBarcode(barcode)).toEqual({ status: 'not_found' });
    const saved = await p.backend.saveUserFood({
      name: 'Corner shop flapjack',
      brand: null,
      barcode,
      per100g: { kcal: 430, protein: 5.5, carbs: 58, fat: 19 },
      packGrams: 75,
      remembered: true,
    });
    expect(toFood(saved)).not.toBeNull();
    // Next time (a fresh launch of the app): found as yours, from the barcode alone.
    const next = await p.relaunch().backend.lookupBarcode(barcode);
    expect(next).toMatchObject({ status: 'found', source: 'yours' });
    if (next.status === 'found') expect(next.food.name).toBe('Corner shop flapjack');
    // Someone else scanning it still gets "not found" (it's not in the global cache).
    const other = await signUp(s, 'unknown-barcode-other');
    expect(await other.p.backend.lookupBarcode(barcode)).toEqual({ status: 'not_found' });
  });

  it('H5, H6, H7: "Ate it" logs the plan meal once and Today stops offering it; water +250 ml; tampered macros refused', async () => {
    const { p } = await signUp(s, 'ate-it');
    const b = p.backend;
    await b.setHealthConsent(true);
    const [oats] = (await b.searchFoods('Porridge')).flatMap((f) => toFood(f) ?? []);
    const components: MealComponent[] = [{ food: oats!, grams: 60 }];
    const planId = await b.saveMeal({
      id: null,
      name: 'Porridge',
      inDailyPlan: true,
      usualTime: '07:30',
      components,
    });
    const plan = (await b.listSavedMeals()).find((m) => m.id === planId)!;
    const range = {
      from: new Date(Date.now() - 36 * 3600_000).toISOString(),
      to: new Date(Date.now() + 36 * 3600_000).toISOString(),
    };
    const now = new Date().toISOString();
    const today = toLondonDate(now);
    // What Today draws (useDay → buildTimeline): is "Ate it" still offered for the plan meal?
    const offered = async () =>
      buildTimeline({
        mealLogs: await b.listMealLogs(range),
        planMeals: await b.listSavedMeals(),
        calendar: [],
      }).some((i) => i.kind === 'meal-planned' && i.savedMealId === planId);
    expect(await offered()).toBe(true);

    // One tap = one log, with the plan meal's components snapshotted; then it's no longer offered.
    await b.logMeal({
      name: plan.name,
      savedMealId: plan.id,
      loggedAt: now,
      components: plan.components,
    });
    const logs = (await b.listMealLogs(range)).filter((m) => m.savedMealId === planId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.items).toHaveLength(1);
    expect(logs[0]!.items[0]!.macros.kcal).toBe(portionMacros(oats!, 60).kcal);
    expect(await offered()).toBe(false);

    // H6: water quick add, twice → 500 ml on Health.
    await b.addWater(250);
    await b.addWater(250);
    const water = await b.listWaterLogs(range);
    expect(water.reduce((n, w) => n + w.ml, 0)).toBe(500);
    expect(
      dayProgress({ meals: await b.listMealLogs(range), water }, targets, today).water.consumed,
    ).toBe(500);

    // H7: the server recomputes macros from the food's per-100 g values and refuses a mismatch.
    const token = p.tokens()!.accessToken;
    const honest = portionMacros(oats!, 60);
    const tampered = await rawData(s, token, 'rpc/log_meal', {
      method: 'POST',
      body: JSON.stringify({
        p_name: 'Tampered',
        p_saved_meal_id: null,
        p_logged_at: now,
        p_items: [{ food_id: oats!.id, grams: 60, ...honest, kcal: honest.kcal - 100 }],
      }),
    });
    expect(tampered.status).toBe(400);
    expect(JSON.stringify(tampered.body)).toMatch(/nutrition for .* has changed/);
    expect((await b.listMealLogs(range)).filter((m) => m.name === 'Tampered')).toEqual([]);
  });
});
