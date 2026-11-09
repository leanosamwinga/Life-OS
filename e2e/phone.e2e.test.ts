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
  ateItAt,
  componentsFromLog,
  dayEnd,
  dayProgress,
  formatTimeUK,
  guessCooksAs,
  logWindow,
  londonDateTimeToInstant,
  portionMacros,
  summariseBatch,
  toFood,
  toLondonDate,
  toLondonTime,
  type DailyTargets,
  type BatchIngredient,
  type Food,
  type MealComponent,
} from '@life-os/core';
import { SignJWT, importJWK } from 'jose';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { keptDraft } from '../apps/mobile/src/features/log-meal/draft';
import { sortSaved } from '../apps/mobile/src/features/log-meal/saved';
import {
  loggedAtFor,
  pickerFrom,
  timeChip,
  whenChoices,
  type MealSlot,
} from '../apps/mobile/src/features/log-meal/slots';
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
  }).then(async (r) => {
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : null) as { code?: string } };
  });

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

  // ------------------------------------------------------- Log meal: Saved tab and batches (L)

  /** Wireframe 7f's rice and eggs, as the user's own foods (complete, so loggable). */
  async function ownIngredients(p: Phone) {
    const make = async (name: string, per100g: Food['per100g']) =>
      toFood(await p.backend.saveUserFood({ name, per100g, remembered: true }))!;
    const rice = await make('E2E rice, dry', { kcal: 350, protein: 7, carbs: 78, fat: 0.6 });
    const eggs = await make('E2E eggs, large', { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 });
    const ing = (food: Food, grams: number): BatchIngredient => ({
      food,
      grams,
      cooksAs: guessCooksAs(food.name),
    });
    return { rice, eggs, ing };
  }

  const wideRange = () => ({
    from: new Date(Date.now() - 36 * 3600_000).toISOString(),
    to: new Date(Date.now() + 36 * 3600_000).toISOString(),
  });

  it('L1: "Save to roster only" saves through save_meal with the plan switch and usual time and writes no meal log', async () => {
    const { p } = await signUp(s, 'save-only');
    const b = p.backend;
    await b.setHealthConsent(true);
    const { rice } = await ownIngredients(p);
    const id = await b.saveMeal({
      id: null,
      name: 'Rice for later',
      inDailyPlan: true,
      usualTime: '19:00',
      components: [{ food: rice, grams: 75 }],
    });
    const meal = (await b.listSavedMeals()).find((m) => m.id === id)!;
    expect(meal).toMatchObject({ inDailyPlan: true, usualTime: '19:00', starred: false });
    expect(await b.listMealLogs(wideRange())).toEqual([]);
    if (sql) {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.meal_logs ml
        join public.saved_meals sm on sm.user_id = ml.user_id where sm.id = ${id}`;
      expect(row?.n).toBe(0);
    }
  });

  it('L2–L7: batch create → server per-100 g = core; tampering refused; log 100 g; as a component; cook again; stars', async () => {
    const { p } = await signUp(s, 'batch');
    const b = p.backend;
    await b.setHealthConsent(true);
    const { rice, eggs, ing } = await ownIngredients(p);
    expect(guessCooksAs(rice.name)).toBe('rice');

    // L2: estimated (360 × 2.5 + 120 = 1,020 g), then weighed 1,310 g.
    const pot = [ing(rice, 360), ing(eggs, 120)];
    const id = await b.saveBatch({
      id: null,
      name: 'E2E egg fried rice',
      ingredients: pot,
      weighedG: null,
    });
    let [batch] = await b.listBatches();
    const est = summariseBatch(pot, null);
    expect(batch!.food.id).toBe(id);
    expect(batch!.food.per100g).toMatchObject(est.per100g!);
    expect(est.per100g).toEqual({ kcal: 140, protein: 4, carbs: 27.6, fat: 1.3 });
    expect(batch!.food.batch).toMatchObject({
      cookedWeightG: 1020,
      weighed: false,
      starred: false,
    });
    expect(batch!.ingredients.map((i) => [i.food.id, i.grams, i.cooksAs])).toEqual([
      [rice.id, 360, 'rice'],
      [eggs.id, 120, 'as_added'],
    ]);
    await b.saveBatch({ id, name: 'E2E egg fried rice', ingredients: pot, weighedG: 1310 });
    [batch] = await b.listBatches();
    expect(batch!.food.per100g).toMatchObject(summariseBatch(pot, 1310).per100g!);
    expect(batch!.food.per100g).toMatchObject({ kcal: 109, protein: 3.1, carbs: 21.5, fat: 1 });
    expect(batch!.food.batch).toMatchObject({ cookedWeightG: 1310, weighed: true });

    // L3: the server doesn't trust client maths, and batch rows only change through save_batch.
    const token = p.tokens()!.accessToken;
    const args = {
      p_id: null,
      p_name: 'Tampered batch',
      p_cooked_weight_g: 1310,
      p_weighed: true,
      p_per_100g: { kcal: 99, protein: 3.1, carbs: 21.5, fat: 1 },
      p_ingredients: [
        { food_id: rice.id, grams: 360, cooks_as: 'rice', cooked_ratio: 2.5 },
        { food_id: eggs.id, grams: 120, cooks_as: 'as_added', cooked_ratio: 1 },
      ],
    };
    const tampered = await rawData(s, token, 'rpc/save_batch', {
      method: 'POST',
      body: JSON.stringify(args),
    });
    expect(tampered.status).toBe(400);
    expect(JSON.stringify(tampered.body)).toMatch(/nutrition for this batch has changed/);
    const badEstimate = await rawData(s, token, 'rpc/save_batch', {
      method: 'POST',
      body: JSON.stringify({
        ...args,
        p_weighed: false,
        p_cooked_weight_g: 900,
        p_per_100g: { kcal: 159, protein: 4.5, carbs: 31.3, fat: 1.5 },
      }),
    });
    expect(badEstimate.status).toBe(400);
    const direct = await rawData(s, token, `foods?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ kcal_per_100g: 10 }),
    });
    expect(direct.body.code).toBe('42501');
    const sneak = await rawData(s, token, 'batch_ingredients', {
      method: 'POST',
      body: JSON.stringify({ batch_id: id, food_id: eggs.id, grams: 500 }),
    });
    expect(sneak.body.code).toBe('42501');
    expect((await b.listBatches()).map((x) => x.food.name)).toEqual(['E2E egg fried rice']);

    // L4: log 100 g of the batch on its own (7h).
    const batchFood = (await b.listBatches())[0]!.food;
    const range = wideRange();
    const firstLog = await b.logMeal({
      name: batchFood.name,
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: batchFood, grams: 100 }],
    });
    const logged = (await b.listMealLogs(range)).find((l) => l.id === firstLog)!;
    expect(logged.items[0]!.macros).toEqual({ kcal: 109, protein: 3.1, carbs: 21.5, fat: 1 });
    expect((await b.listRecentFoods(5)).find((r) => r.food.id === id)?.grams).toBe(100);

    // L5: the batch as one component of a meal (7b-B).
    const mealLog = await b.logMeal({
      name: 'Rice & eggs',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [
        { food: batchFood, grams: 350 },
        { food: eggs, grams: 60 },
      ],
    });
    const meal = (await b.listMealLogs(range)).find((l) => l.id === mealLog)!;
    expect(meal.items.map((i) => [i.foodId, i.macros.kcal])).toEqual([
      [id, portionMacros(batchFood, 350).kcal],
      [eggs.id, 86],
    ]);
    const rosterId = await b.saveMeal({
      id: null,
      name: 'Rice & eggs',
      inDailyPlan: false,
      usualTime: null,
      components: [{ food: batchFood, grams: 350 }],
    });

    // L6: cook again with one egg fewer — future logs use the new numbers, past logs don't change.
    const again = [ing(rice, 360), ing(eggs, 60)];
    await b.saveBatch({ id, name: 'E2E egg fried rice', ingredients: again, weighedG: null });
    const cooked = (await b.listBatches())[0]!;
    expect(cooked.food.per100g).toMatchObject(summariseBatch(again, null).per100g!);
    expect(cooked.food.per100g).toMatchObject({ kcal: 140, protein: 3.4, carbs: 29.3, fat: 0.8 });
    expect(cooked.food.batch).toMatchObject({ cookedWeightG: 960, weighed: false });
    const logsAfter = await b.listMealLogs(range);
    expect(logsAfter.find((l) => l.id === firstLog)!.items[0]!.macros.kcal).toBe(109);
    expect(logsAfter.find((l) => l.id === mealLog)!.items[0]!.macros.kcal).toBe(
      portionMacros(batchFood, 350).kcal,
    );
    const secondLog = await b.logMeal({
      name: cooked.food.name,
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: cooked.food, grams: 100 }],
    });
    expect(
      (await b.listMealLogs(range)).find((l) => l.id === secondLog)!.items[0]!.macros.kcal,
    ).toBe(140);
    // A stale client still holding the old per-100 g is refused, as with any food.
    await expect(
      b.logMeal({
        name: 'stale',
        savedMealId: null,
        loggedAt: new Date().toISOString(),
        components: [{ food: batchFood, grams: 100 }],
      }),
    ).rejects.toThrow(/has changed/);

    // L7: stars — starred first, then A–Z, across meals and batches.
    await b.saveMeal({
      id: null,
      name: 'Apple crumble',
      inDailyPlan: false,
      usualTime: null,
      components: [{ food: rice, grams: 10 }],
    });
    await b.setStarred({ kind: 'meal', id: rosterId }, true);
    await b.setStarred({ kind: 'batch', id }, true);
    const relaunched = p.relaunch().backend;
    const items = [
      ...(await relaunched.listSavedMeals()).map((m) => ({
        name: m.name,
        starred: Boolean(m.starred),
      })),
      ...(await relaunched.listBatches()).map((x) => ({
        name: x.food.name,
        starred: x.food.batch.starred,
      })),
    ];
    expect(sortSaved(items).map((i) => `${i.starred ? '★' : '☆'} ${i.name}`)).toEqual([
      '★ E2E egg fried rice',
      '★ Rice & eggs',
      '☆ Apple crumble',
    ]);
    await b.setStarred({ kind: 'batch', id }, false);
    expect((await b.listBatches())[0]!.food.batch.starred).toBe(false);
    // A batch that is in a saved meal can't be deleted out from under it.
    await expect(b.deleteBatch(id)).rejects.toThrow(/in a saved meal/);
  });

  it('L8, L9: another user sees none of it; consent off refuses batch writes and hides batches', async () => {
    const a = await signUp(s, 'batch-owner');
    await a.p.backend.setHealthConsent(true);
    const { rice, ing } = await ownIngredients(a.p);
    const pot = [ing(rice, 200)];
    const id = await a.p.backend.saveBatch({
      id: null,
      name: 'E2E private batch',
      ingredients: pot,
      weighedG: null,
    });
    await a.p.backend.setStarred({ kind: 'batch', id }, true);

    // L8: B can't see, search, star, cook or log A's batch.
    const other = await signUp(s, 'batch-other');
    const ob = other.p.backend;
    await ob.setHealthConsent(true);
    expect(await ob.listBatches()).toEqual([]);
    expect(await ob.searchFoods('E2E private batch')).toEqual([]);
    expect(await ob.getFoods([id])).toEqual([]);
    const otherToken = other.p.tokens()!.accessToken;
    expect((await rawData(s, otherToken, 'batch_ingredients?select=id')).body).toEqual([]);
    await ob.setStarred({ kind: 'batch', id }, false);
    await expect(
      ob.saveBatch({
        id,
        name: 'Mine now',
        ingredients: [{ food: (await ownIngredients(other.p)).rice, grams: 200, cooksAs: 'rice' }],
        weighedG: null,
      }),
    ).rejects.toThrow(/not found/i);
    const [batchFood] = (await a.p.backend.listBatches()).map((x) => x.food);
    await expect(
      ob.logMeal({
        name: 'steal',
        savedMealId: null,
        loggedAt: new Date().toISOString(),
        components: [{ food: batchFood!, grams: 100 }],
      }),
    ).rejects.toThrow();
    expect((await a.p.backend.listBatches())[0]!.food.batch.starred).toBe(true);

    // L9: A withdraws consent — batch writes refused, batches hidden; back on, all still there.
    await a.p.backend.setHealthConsent(false);
    await expect(
      a.p.backend.saveBatch({ id: null, name: 'No consent', ingredients: pot, weighedG: null }),
    ).rejects.toThrow(/Health data is off/);
    await expect(
      a.p.backend.saveBatch({ id, name: 'No consent', ingredients: pot, weighedG: null }),
    ).rejects.toThrow(/Health data is off/);
    const token = a.p.tokens()!.accessToken;
    const raw = await rawData(s, token, 'rpc/save_batch', {
      method: 'POST',
      body: JSON.stringify({
        p_id: null,
        p_name: 'raw',
        p_cooked_weight_g: 500,
        p_weighed: false,
        p_per_100g: summariseBatch(pot, null).per100g,
        p_ingredients: [{ food_id: rice.id, grams: 200, cooks_as: 'rice', cooked_ratio: 2.5 }],
      }),
    });
    expect(raw.body.code).toBe('42501');
    expect(await a.p.backend.searchFoods('E2E private batch')).toEqual([]);
    await a.p.backend.setStarred({ kind: 'batch', id }, false);
    await a.p.backend.setHealthConsent(true);
    const back = await a.p.backend.listBatches();
    expect(back.map((x) => [x.food.name, x.food.batch.starred])).toEqual([
      ['E2E private batch', true],
    ]);
  });

  // ---------------------------------------- Log meal: custom time, edit and delete, g or ml (T)

  /** A user with consent, Test oats (their own food) and a plan meal "Lunch · E2E oats bowl". */
  async function timeUser(tag: string) {
    const { p } = await signUp(s, tag);
    const b = p.backend;
    await b.setHealthConsent(true);
    const oats = toFood(
      await b.saveUserFood({
        name: 'E2E test oats',
        per100g: { kcal: 389, protein: 13.5, carbs: 66, fat: 6.9 },
        remembered: true,
      }),
    )!;
    const planId = await b.saveMeal({
      id: null,
      name: 'Lunch · E2E oats bowl',
      inDailyPlan: true,
      usualTime: '12:30',
      components: [{ food: oats, grams: 60 }],
    });
    const plan = (await b.listSavedMeals()).find((m) => m.id === planId)!;
    const w = logWindow(new Date());
    const dayRange = (date: string) => ({
      from: londonDateTimeToInstant(date, '00:00'),
      to: dayEnd(date),
    });
    const kcalOn = async (date: string) =>
      dayProgress({ meals: await b.listMealLogs(dayRange(date)) }, targets, date).kcal.consumed;
    return { p, b, oats, plan, w, dayRange, kcalOn };
  }

  it('T1: a meal logged at a custom time lands on its London day, in time order', async () => {
    const { b, oats, w, dayRange, kcalOn } = await timeUser('custom-time');
    const nowLog = await b.logMeal({
      name: 'E2E now meal',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: oats, grams: 60 }],
    });
    // 00:00 today is always inside the window, and earlier than "now".
    const early = await b.logMeal({
      name: 'E2E early meal',
      savedMealId: null,
      loggedAt: londonDateTimeToInstant(w.today, '00:00'),
      components: [{ food: oats, grams: 30 }],
    });
    const late = await b.logMeal({
      name: 'E2E yesterday meal',
      savedMealId: null,
      loggedAt: londonDateTimeToInstant(w.yesterday, '21:15'),
      components: [{ food: oats, grams: 100 }],
    });
    const today = buildTimeline({
      mealLogs: await b.listMealLogs(dayRange(w.today)),
      planMeals: [],
      calendar: [],
    }).map((i) => i.id);
    expect(today).toEqual([early, nowLog]);
    const yesterday = await b.listMealLogs(dayRange(w.yesterday));
    expect(yesterday.map((l) => [l.id, formatTimeUK(l.loggedAt)])).toEqual([[late, '21:15']]);
    expect(await kcalOn(w.today)).toBe(portionMacros(oats, 60).kcal + portionMacros(oats, 30).kcal);
    expect(await kcalOn(w.yesterday)).toBe(portionMacros(oats, 100).kcal);
  });

  it('T2: the server refuses a time more than an hour ahead or before yesterday 00:00', async () => {
    const { p, b, oats, w } = await timeUser('time-limit');
    const at = (loggedAt: string) =>
      b.logMeal({
        name: 'E2E out of window',
        savedMealId: null,
        loggedAt,
        components: [{ food: oats, grams: 60 }],
      });
    await expect(at(new Date(Date.now() + 2 * 3600_000).toISOString())).rejects.toThrow(
      /no more than an hour from now/,
    );
    await expect(at(new Date(Date.parse(w.earliest) - 60_000).toISOString())).rejects.toThrow(
      /from yesterday 00:00 onwards/,
    );
    // Straight to the Data API, skipping the app's picker: still refused.
    const honest = portionMacros(oats, 60);
    const raw = await rawData(s, p.tokens()!.accessToken, 'rpc/log_meal', {
      method: 'POST',
      body: JSON.stringify({
        p_name: 'E2E raw late',
        p_saved_meal_id: null,
        p_logged_at: new Date(Date.now() + 90 * 60_000).toISOString(),
        p_items: [{ food_id: oats.id, grams: 60, ...honest }],
      }),
    });
    expect(raw.status).toBe(400);
    expect(raw.body.code).toBe('22023');
    const all = await b.listMealLogs(wideRange());
    expect(
      all.filter((l) => l.name.startsWith('E2E out of window') || l.name === 'E2E raw late'),
    ).toEqual([]);
  });

  it('T3, T4: rename and retime change only the log; moving to yesterday moves the totals', async () => {
    const { b, plan, w, kcalOn } = await timeUser('retime');
    const id = await b.logMeal({
      name: plan.name,
      savedMealId: plan.id,
      loggedAt: londonDateTimeToInstant(w.today, '00:00'),
      components: plan.components,
    });
    const before = (await b.listMealLogs(wideRange())).find((l) => l.id === id)!;
    const kcal = before.items[0]!.macros.kcal;
    expect(await kcalOn(w.today)).toBe(kcal);
    const yBefore = await kcalOn(w.yesterday);

    await b.updateLoggedMeal({
      id,
      name: 'E2E overnight oats',
      loggedAt: londonDateTimeToInstant(w.yesterday, '21:30'),
      units: [],
    });
    const after = (await b.listMealLogs(wideRange())).find((l) => l.id === id)!;
    expect(after.name).toBe('E2E overnight oats');
    expect(formatTimeUK(after.loggedAt)).toBe('21:30');
    expect(toLondonDate(after.loggedAt)).toBe(w.yesterday);
    expect(after.items).toEqual(before.items);
    expect(after.savedMealId).toBe(plan.id);
    // T4: today down by the meal, yesterday up by it.
    expect(await kcalOn(w.today)).toBe(0);
    expect(await kcalOn(w.yesterday)).toBe(yBefore + kcal);
    // The plan meal it came from is untouched.
    const planAfter = (await b.listSavedMeals()).find((m) => m.id === plan.id)!;
    expect([planAfter.name, planAfter.usualTime, planAfter.components.map((c) => c.grams)]).toEqual(
      ['Lunch · E2E oats bowl', '12:30', [60]],
    );
    // A null time keeps the time; a new time out of the window is refused.
    await b.updateLoggedMeal({ id, name: 'E2E overnight oats', loggedAt: null, units: [] });
    expect((await b.listMealLogs(wideRange())).find((l) => l.id === id)!.loggedAt).toBe(
      after.loggedAt,
    );
    await expect(
      b.updateLoggedMeal({
        id,
        name: 'E2E overnight oats',
        loggedAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        units: [],
      }),
    ).rejects.toThrow(/no more than an hour from now/);
  });

  it('T5: amounts can’t be changed through the edit function or the Data API, even crafted', async () => {
    const { p, b, oats } = await timeUser('locked');
    const id = await b.logMeal({
      name: 'E2E locked',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: oats, grams: 60 }],
    });
    const token = p.tokens()!.accessToken;
    const before = (await b.listMealLogs(wideRange())).find((l) => l.id === id)!;
    const crafted = await rawData(s, token, 'rpc/update_logged_meal', {
      method: 'POST',
      body: JSON.stringify({
        p_id: id,
        p_name: 'E2E locked',
        p_logged_at: null,
        p_units: [{ position: 0, unit: 'g', grams: 999, kcal: 1 }],
      }),
    });
    expect(crafted.body.code).toBe('42501');
    expect(JSON.stringify(crafted.body)).toMatch(/amounts can't be changed/);
    const swapped = await rawData(s, token, 'rpc/update_logged_meal', {
      method: 'POST',
      body: JSON.stringify({
        p_id: id,
        p_name: 'E2E locked',
        p_logged_at: null,
        p_units: [{ position: 0, unit: 'g', food_id: oats.id }],
      }),
    });
    expect(swapped.body.code).toBe('42501');
    const patchItem = await rawData(s, token, `meal_log_items?meal_log_id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ grams: 999 }),
    });
    expect(patchItem.body.code).toBe('42501');
    const patchLog = await rawData(s, token, `meal_logs?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ logged_at: new Date(Date.now() - 5 * 86400_000).toISOString() }),
    });
    expect(patchLog.body.code).toBe('42501');
    const rawDelete = await rawData(s, token, `meal_logs?id=eq.${id}`, { method: 'DELETE' });
    expect(rawDelete.body.code).toBe('42501');
    const after = (await b.listMealLogs(wideRange())).find((l) => l.id === id)!;
    expect(after).toEqual(before);
  });

  it('T6: delete works, and a meal from the plan shows as not eaten again', async () => {
    const { b, plan } = await timeUser('delete');
    const offered = async () =>
      buildTimeline({
        mealLogs: await b.listMealLogs(wideRange()),
        planMeals: await b.listSavedMeals(),
        calendar: [],
      }).some((i) => i.kind === 'meal-planned' && i.savedMealId === plan.id);
    expect(await offered()).toBe(true);
    const id = await b.logMeal({
      name: plan.name,
      savedMealId: plan.id,
      loggedAt: new Date().toISOString(),
      components: plan.components,
    });
    expect(await offered()).toBe(false);
    await b.deleteMealLog(id);
    expect((await b.listMealLogs(wideRange())).some((l) => l.id === id)).toBe(false);
    expect(await offered()).toBe(true);
    expect((await b.listSavedMeals()).some((m) => m.id === plan.id)).toBe(true);
    await expect(b.deleteMealLog(id)).rejects.toThrow(/already gone/);
  });

  it('T7, T8: a barcode drink comes back per 100 ml; switching a logged item’s unit changes no numbers', async () => {
    const { b, oats } = await timeUser('units');
    // T8: the Open Food Facts stand-in's 330 ml shake.
    const found = await b.lookupBarcode('0000000000962');
    expect(found.status).toBe('found');
    if (found.status !== 'found') return;
    expect(found.food).toMatchObject({ nutritionUnit: 'ml', packGrams: 330, kcalPer100g: 62 });
    const shake = toFood(found.food)!;
    expect(shake.unit).toBe('ml');

    // Logged as 330 g by mistake, then corrected to ml in 7k.
    const id = await b.logMeal({
      name: 'E2E shake breakfast',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [
        { food: oats, grams: 60 },
        { food: shake, grams: 330, unit: 'g' },
      ],
    });
    const before = (await b.listMealLogs(wideRange())).find((l) => l.id === id)!;
    expect(before.items.map((i) => [i.grams, i.unit, i.macros.kcal])).toEqual([
      [60, 'g', 233],
      [330, 'g', 205],
    ]);
    expect((await b.listRecentFoods(10)).find((r) => r.food.id === shake.id)).toMatchObject({
      grams: 330,
      unit: 'g',
    });
    await b.updateLoggedMeal({
      id,
      name: 'E2E shake breakfast',
      loggedAt: null,
      units: [{ position: 1, unit: 'ml' }],
    });
    const after = (await b.listMealLogs(wideRange())).find((l) => l.id === id)!;
    expect(after.items).toEqual([before.items[0], { ...before.items[1], unit: 'ml' }]);
    expect(after.loggedAt).toBe(before.loggedAt);
  });

  it('T9, T10: another user can’t see, edit or delete any of it; consent off refuses edits and deletes', async () => {
    const a = await timeUser('time-owner');
    const id = await a.b.logMeal({
      name: 'E2E private meal',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: a.oats, grams: 60 }],
    });
    const before = (await a.b.listMealLogs(wideRange())).find((l) => l.id === id)!;

    // T9: B sees nothing and can change nothing — through the app or the Data API.
    const other = await signUp(s, 'time-other');
    const ob = other.p.backend;
    await ob.setHealthConsent(true);
    expect((await ob.listMealLogs(wideRange())).some((l) => l.id === id)).toBe(false);
    await expect(
      ob.updateLoggedMeal({ id, name: 'Mine now', loggedAt: null, units: [] }),
    ).rejects.toThrow(/not found/i);
    await expect(ob.deleteMealLog(id)).rejects.toThrow(/already gone/);
    const ot = other.p.tokens()!.accessToken;
    expect((await rawData(s, ot, `meal_log_items?meal_log_id=eq.${id}&select=grams`)).body).toEqual(
      [],
    );
    expect((await a.b.listMealLogs(wideRange())).find((l) => l.id === id)).toEqual(before);

    // T10: A withdraws consent — edits and deletes refused; back on, the meal is unchanged.
    await a.b.setHealthConsent(false);
    await expect(
      a.b.updateLoggedMeal({ id, name: 'No consent', loggedAt: null, units: [] }),
    ).rejects.toThrow(/Health data is off/);
    await expect(a.b.deleteMealLog(id)).rejects.toThrow(/Health data is off/);
    const raw = await rawData(s, a.p.tokens()!.accessToken, 'rpc/delete_logged_meal', {
      method: 'POST',
      body: JSON.stringify({ p_id: id }),
    });
    expect(raw.body.code).toBe('42501');
    await a.b.setHealthConsent(true);
    expect((await a.b.listMealLogs(wideRange())).find((l) => l.id === id)).toEqual(before);
  });
  // ------------------------------------------------------------------ log meal and water follow-ups
  const waterToday = async (b: Phone['backend']) =>
    (await b.listWaterLogs(dayRangeOf(logWindow(new Date()).today))).map((w) => w.ml);
  const dayRangeOf = (date: string) => ({
    from: londonDateTimeToInstant(date, '00:00'),
    to: dayEnd(date),
  });

  it('U1: a meal moved to yesterday shows on yesterday’s timeline and can still be edited', async () => {
    const { b, oats, w, dayRange } = await timeUser('yesterday-view');
    const id = await b.logMeal({
      name: 'E2E moved meal',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: oats, grams: 60 }],
    });
    await b.updateLoggedMeal({
      id,
      name: 'E2E moved meal',
      loggedAt: londonDateTimeToInstant(w.yesterday, '20:00'),
      units: [],
    });
    // What Today's "‹ Yesterday" shows: yesterday's meals only, no plan.
    const yesterday = buildTimeline({
      mealLogs: await b.listMealLogs(dayRange(w.yesterday)),
      planMeals: [],
      calendar: [],
    });
    expect(yesterday.map((i) => [i.id, i.time, i.kind])).toEqual([[id, '20:00', 'meal-eaten']]);
    await b.updateLoggedMeal({ id, name: 'E2E moved meal, renamed', loggedAt: null, units: [] });
    expect((await b.listMealLogs(dayRange(w.yesterday)))[0]!.name).toBe('E2E moved meal, renamed');
  });

  it('U2: a corrected copy replaces the meal atomically and keeps the plan link; failures leave the original', async () => {
    const { p, b, plan, oats, w } = await timeUser('corrected');
    const oldId = await b.logMeal({
      name: plan.name,
      savedMealId: plan.id,
      loggedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      components: plan.components,
    });
    const before = (await b.listMealLogs(wideRange())).find((l) => l.id === oldId)!;
    const token = p.tokens()!.accessToken;
    const honest = portionMacros(oats, 80);

    // Mismatched macros through the Data API: refused, nothing changes.
    const tampered = await rawData(s, token, 'rpc/replace_logged_meal', {
      method: 'POST',
      body: JSON.stringify({
        p_old_id: oldId,
        p_name: 'E2E tampered copy',
        p_logged_at: new Date().toISOString(),
        p_items: [{ food_id: oats.id, grams: 80, ...honest, kcal: honest.kcal + 50 }],
      }),
    });
    expect(tampered.status).toBe(400);
    expect(tampered.body.code).toBe('22023');
    // A new time outside the window: refused through the app, nothing changes.
    await expect(
      b.replaceLoggedMeal(oldId, {
        name: plan.name,
        savedMealId: null,
        loggedAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        components: [{ food: oats, grams: 80 }],
      }),
    ).rejects.toThrow(/no more than an hour from now/);
    expect(
      (await b.listMealLogs(wideRange())).filter((l) => l.name.startsWith('E2E tampered')),
    ).toEqual([]);
    expect((await b.listMealLogs(wideRange())).find((l) => l.id === oldId)).toEqual(before);

    // The corrected copy, from the meal as 7j pre-fills it, with one amount changed.
    const foods = new Map([[oats.id, oats]]);
    const pre = componentsFromLog(before.items, foods);
    expect(pre.unavailable).toEqual([]);
    const newId = await b.replaceLoggedMeal(oldId, {
      name: plan.name,
      savedMealId: null,
      loggedAt: londonDateTimeToInstant(w.today, '00:30'),
      components: pre.components.map((c) => ({ ...c, grams: 80 })),
    });
    const logs = await b.listMealLogs(wideRange());
    expect(logs.some((l) => l.id === oldId)).toBe(false);
    const copy = logs.find((l) => l.id === newId)!;
    expect(copy.savedMealId).toBe(plan.id);
    expect(copy.items.map((i) => [i.grams, i.macros.kcal])).toEqual([[80, honest.kcal]]);
    expect(formatTimeUK(copy.loggedAt)).toBe('00:30');
    // The plan meal stays eaten: Today doesn't offer "Ate it" for it.
    const offered = buildTimeline({
      mealLogs: logs,
      planMeals: await b.listSavedMeals(),
      calendar: [],
    }).some((i) => i.kind === 'meal-planned' && i.savedMealId === plan.id);
    expect(offered).toBe(false);
    await expect(
      b.replaceLoggedMeal(oldId, {
        name: plan.name,
        savedMealId: null,
        loggedAt: new Date().toISOString(),
        components: [{ food: oats, grams: 60 }],
      }),
    ).rejects.toThrow(/already gone/);
  });

  it('U3: Log again creates a second meal and leaves the first', async () => {
    const { b, oats } = await timeUser('log-again');
    const first = await b.logMeal({
      name: 'E2E log again',
      savedMealId: null,
      loggedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      components: [{ food: oats, grams: 45 }],
    });
    const before = (await b.listMealLogs(wideRange())).find((l) => l.id === first)!;
    const { components } = componentsFromLog(before.items, new Map([[oats.id, oats]]));
    const second = await b.logMeal({
      name: before.name,
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components,
    });
    const both = (await b.listMealLogs(wideRange())).filter((l) => l.name === 'E2E log again');
    expect(both.map((l) => l.id).sort()).toEqual([first, second].sort());
    expect(both.find((l) => l.id === first)).toEqual(before);
    expect(both.find((l) => l.id === second)!.items.map((i) => i.grams)).toEqual([45]);
  });

  it('U4: “Ate it” after the usual time logs at the usual time', async () => {
    const { b, oats, w } = await timeUser('ate-it-time');
    // 00:00 has always passed today, so "Ate it" logs at 00:00 rather than now.
    const id = await b.saveMeal({
      id: null,
      name: 'Breakfast · E2E midnight oats',
      inDailyPlan: true,
      usualTime: '00:00',
      components: [{ food: oats, grams: 60 }],
    });
    const plan = (await b.listSavedMeals()).find((m) => m.id === id)!;
    const at = ateItAt(plan.usualTime, new Date());
    expect(at).toBe(londonDateTimeToInstant(w.today, '00:00'));
    const logId = await b.logMeal({
      name: plan.name,
      savedMealId: plan.id,
      loggedAt: at,
      components: plan.components,
    });
    const logged = (await b.listMealLogs(wideRange())).find((l) => l.id === logId)!;
    expect([toLondonDate(logged.loggedAt), formatTimeUK(logged.loggedAt)]).toEqual([
      w.today,
      '00:00',
    ]);
  });

  it('U5: custom water is logged and deleted; out-of-range amounts are refused', async () => {
    const { b } = await timeUser('water');
    await b.addWater(330);
    await b.addWater(250);
    expect((await waterToday(b)).sort()).toEqual([250, 330]);
    await expect(b.addWater(5001)).rejects.toThrow();
    await expect(b.addWater(0)).rejects.toThrow();
    const entry = (await b.listWaterLogs(wideRange())).find((x) => x.ml === 330)!;
    await b.deleteWater(entry.id);
    expect(await waterToday(b)).toEqual([250]);
  });

  it('U6, U7: another user can’t see or change any of it; consent off refuses all of it', async () => {
    const a = await timeUser('follow-owner');
    const mealId = await a.b.logMeal({
      name: 'E2E private follow-up',
      savedMealId: null,
      loggedAt: new Date().toISOString(),
      components: [{ food: a.oats, grams: 60 }],
    });
    await a.b.addWater(330);
    const water = (await a.b.listWaterLogs(wideRange()))[0]!;
    const before = (await a.b.listMealLogs(wideRange())).find((l) => l.id === mealId)!;

    const other = await signUp(s, 'follow-other');
    const ob = other.p.backend;
    await ob.setHealthConsent(true);
    expect(await ob.listWaterLogs(wideRange())).toEqual([]);
    await expect(
      ob.replaceLoggedMeal(mealId, {
        name: 'Mine now',
        savedMealId: null,
        loggedAt: new Date().toISOString(),
        components: [],
      }),
    ).rejects.toThrow();
    const ot = other.p.tokens()!.accessToken;
    const raw = await rawData(s, ot, 'rpc/replace_logged_meal', {
      method: 'POST',
      body: JSON.stringify({
        p_old_id: mealId,
        p_name: 'Mine now',
        p_logged_at: new Date().toISOString(),
        p_items: [{ food_id: a.oats.id, grams: 60, ...portionMacros(a.oats, 60) }],
      }),
    });
    expect(raw.body.code).toBe('P0002');
    await ob.deleteWater(water.id);
    expect((await a.b.listWaterLogs(wideRange())).map((x) => x.id)).toEqual([water.id]);
    expect((await a.b.listMealLogs(wideRange())).find((l) => l.id === mealId)).toEqual(before);

    // U7: consent off — no corrected copy, no log again, no water added or deleted.
    await a.b.setHealthConsent(false);
    await expect(
      a.b.replaceLoggedMeal(mealId, {
        name: 'No consent',
        savedMealId: null,
        loggedAt: new Date().toISOString(),
        components: [{ food: a.oats, grams: 60 }],
      }),
    ).rejects.toThrow(/Health data is off|health data/i);
    await expect(
      a.b.logMeal({
        name: 'No consent again',
        savedMealId: null,
        loggedAt: new Date().toISOString(),
        components: [{ food: a.oats, grams: 60 }],
      }),
    ).rejects.toThrow();
    await expect(a.b.addWater(150)).rejects.toThrow();
    await a.b.deleteWater(water.id);
    await a.b.setHealthConsent(true);
    expect((await a.b.listWaterLogs(wideRange())).map((x) => x.id)).toEqual([water.id]);
    expect((await a.b.listMealLogs(wideRange())).find((l) => l.id === mealId)).toEqual(before);
  });

  // ------------------------------- Build meal: the time at any point, keep the draft (W)

  it('W1: a meal built at Now, kept on 7a, its time changed to yesterday 21:15 on 7b, logged → lands on yesterday with the same components', async () => {
    const { b, oats, w, dayRange } = await timeUser('build-time');
    const drink = toFood(
      await b.saveUserFood({
        name: 'E2E test oat drink',
        per100g: { kcal: 46, protein: 1, carbs: 6.5, fat: 1.5 },
        unit: 'ml',
        remembered: true,
      }),
    )!;
    const now = new Date();
    // 7a: Now, then + Build a meal from scratch; two components.
    const choices = whenChoices(
      await b.listSavedMeals(),
      { name: 'Now', time: '00:00' },
      w.today,
      now,
    );
    let slot: MealSlot = choices[0]!.slot;
    expect(slot.name).toBe('Now');
    const components: MealComponent[] = [
      { food: oats, grams: 60, unit: 'g' },
      { food: drink, grams: 250, unit: 'ml' },
    ];
    const draft = {
      kind: 'meal' as const,
      mode: 'log' as const,
      name: 'E2E built meal',
      components,
      replaces: null,
    };
    // ‹ Log meal keeps it (7a-C), at the same time.
    expect(keptDraft(draft, slot)).toMatchObject({ name: 'E2E built meal', count: 2 });
    // 7b-T2 → 7b-W → Other time…: 7i opens on Today at now; Yesterday 21:15 → Done.
    expect(pickerFrom(slot, now).date).toBe(w.today);
    slot = { name: 'Custom', date: w.yesterday, time: '21:15' };
    expect(timeChip(slot, w.today).label).toBe('Yesterday · 21:15 ▾');

    const loggedAt = loggedAtFor(slot, w.today, new Date());
    expect(loggedAt).toBe(londonDateTimeToInstant(w.yesterday, '21:15'));
    const id = await b.logMeal({ name: draft.name, savedMealId: null, loggedAt, components });
    const yesterday = await b.listMealLogs(dayRange(w.yesterday));
    const logged = yesterday.find((l) => l.id === id)!;
    expect(formatTimeUK(logged.loggedAt)).toBe('21:15');
    expect(toLondonDate(logged.loggedAt)).toBe(w.yesterday);
    expect(logged.items.map((i) => [i.foodName, i.grams, i.unit])).toEqual([
      ['E2E test oats', 60, 'g'],
      ['E2E test oat drink', 250, 'ml'],
    ]);
    expect(logged.items.map((i) => i.macros.kcal)).toEqual([
      portionMacros(oats, 60).kcal,
      portionMacros(drink, 250).kcal,
    ]);
    expect((await b.listMealLogs(dayRange(w.today))).map((l) => l.id)).not.toContain(id);
  });

  it('W2: a slot more than an hour ahead is refused by the server when forced through the Data API', async () => {
    const { p, b, oats, w } = await timeUser('slot-ahead');
    const now = new Date();
    const ahead = new Date(now.getTime() + 90 * 60_000);
    let forced = ahead.toISOString();
    if (toLondonDate(ahead) === w.today) {
      // A plan dinner 90 minutes from now: 7a and 7b-W grey it out.
      await b.saveMeal({
        id: null,
        name: 'Dinner · E2E late',
        inDailyPlan: true,
        usualTime: toLondonTime(ahead),
        components: [{ food: oats, grams: 60 }],
      });
      const choices = whenChoices(
        await b.listSavedMeals(),
        { name: 'Now', time: '00:00' },
        w.today,
        now,
      );
      const greyed = choices.find((c) => c.slot.name === 'Dinner')!;
      expect(greyed.disabled).toBe(true);
      forced = loggedAtFor(greyed.slot, w.today, now);
    }
    // Late in the evening every slot today has passed; the same time an hour and a half ahead
    // stands in for it.
    const raw = await rawData(s, p.tokens()!.accessToken, 'rpc/log_meal', {
      method: 'POST',
      body: JSON.stringify({
        p_name: 'E2E forced slot',
        p_saved_meal_id: null,
        p_logged_at: forced,
        p_items: [{ food_id: oats.id, grams: 60, ...portionMacros(oats, 60) }],
      }),
    });
    expect(raw.status).toBe(400);
    expect(raw.body.code).toBe('22023');
    await expect(
      b.logMeal({
        name: 'E2E forced slot',
        savedMealId: null,
        loggedAt: forced,
        components: [{ food: oats, grams: 60 }],
      }),
    ).rejects.toThrow(/no more than an hour from now/);
    expect((await b.listMealLogs(wideRange())).filter((l) => l.name === 'E2E forced slot')).toEqual(
      [],
    );
  });
});
