// Acts like the phone, end to end, on the real local stack: the app's own AuthClient and
// Supabase backend (apps/mobile/src/lib), talking to the gateway like Expo Go does
// (→ auth-api in Deno → Supabase Auth; → PostgREST with pgrst.db_pre_request =
// public.check_request → Postgres; → food-lookup). Codes come from Mailpit.
//
//   npm run local-auth && npm run test:e2e         (Docker-free stack, scripts/local-auth)
//   E2E_API_URL=… E2E_ANON_KEY=… npm run test:e2e  (`supabase start`; see e2e/stack.ts)
import {
  dayProgress,
  toFood,
  toLondonDate,
  type DailyTargets,
  type Food,
  type MealComponent,
} from '@life-os/core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection } from '../apps/mobile/src/lib/supabase';
import { supabaseBackend } from '../apps/mobile/src/lib/backend/supabase';
import { SessionEndedError, type AuthUser } from '../apps/mobile/src/lib/backend/types';
import { keychain } from './stubs/expo-secure-store';
import { codeFromMailpit, findStack, uniqueEmail, type Stack } from './stack';

const stack = findStack();
const PASSWORD = 'a perfectly long local e2e password';

/** One "phone": a fresh app launch reading the (shared, in-memory) Keychain. */
function launch(s: Stack) {
  const c = createConnection({ url: s.apiUrl, anonKey: s.anonKey })!;
  const backend = supabaseBackend(c.client, c.auth);
  const changes: (AuthUser | null)[] = [];
  c.auth.onChange((u) => changes.push(u));
  return { ...c, backend, changes };
}
type Phone = ReturnType<typeof launch>;

async function signUp(s: Stack, tag: string) {
  keychain.clear();
  const p = launch(s);
  const email = uniqueEmail(tag);
  const t0 = Date.now() - 1000;
  const challenge = await p.auth.createAccount(email, PASSWORD);
  const code = await codeFromMailpit(s, email, t0);
  const result = await p.auth.confirmEmail(challenge.challengeId, code);
  return { p, email, result };
}

/** What SessionProvider does right after sign-in. */
const loadLikeTheApp = (p: Phone) =>
  Promise.all([p.backend.getProfile(), p.backend.getSettings(), p.backend.hasHealthConsent()]);

const rawData = (s: Stack, token: string, path: string) =>
  fetch(`${s.apiUrl}/rest/v1/${path}`, {
    headers: { apikey: s.anonKey, Authorization: `Bearer ${token}` },
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as { code?: string } }));

const storedTokens = () =>
  JSON.parse(keychain.get('lifeos.session') ?? 'null') as {
    accessToken: string;
    refreshToken: string;
  } | null;

describe.skipIf(!stack)('phone end to end on the real stack', () => {
  const s = stack!;
  let sql: postgres.Sql | null = null;

  beforeAll(() => {
    process.env.EXPO_PUBLIC_DEVICE_CHECKS = 'off';
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

  it('sign up → code from Mailpit → data reads with the returned token (0b-3 → 0b-4 → 0c)', async () => {
    const { p, result } = await signUp(s, 'signup');
    expect(result).toEqual({ accountCreated: true, scope: 'FULL' });
    const user = await p.auth.currentUser();
    expect(user?.scope).toBe('FULL');
    const [profile, settings, consent] = await loadLikeTheApp(p);
    expect(profile.displayName).toBeNull();
    expect(settings.onboardingCompletedAt).toBeNull();
    expect(consent).toBe(false);
    // The token carries what check_request needs.
    const claims = JSON.parse(
      Buffer.from(storedTokens()!.accessToken.split('.')[1]!, 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(claims.lifeos_scope).toBe('FULL');
    expect(typeof claims.session_id).toBe('string');
  });

  it('onboarding 0c–0g, log meal 7a–7e, "Ate it", water +250 ml, Today and Health totals', async () => {
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
    const targets: DailyTargets = {
      kcal: 2200,
      protein: 150,
      carbs: 220,
      fat: 70,
      waterMl: 2500,
      steps: 9000,
    };
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
    // 7d: "how much" uses the amount last time.
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
    const before = storedTokens()!;
    const fresh = await p.auth.refreshNow();
    expect(fresh).not.toBeNull();
    expect(storedTokens()!.refreshToken).not.toBe(before.refreshToken);
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
    // The phone's next Data API call is refused by check_request → session forgotten → 0a.
    await expect(p.backend.getProfile()).rejects.toBeInstanceOf(SessionEndedError);
    expect(await p.auth.currentUser()).toBeNull();
    expect(keychain.has('lifeos.session')).toBe(false);
    expect(p.changes.at(-1)).toBeNull();
  });

  it('sign out ends the session on the server too (the old token is refused)', async () => {
    const { p } = await signUp(s, 'signout');
    const token = storedTokens()!.accessToken;
    expect((await rawData(s, token, 'profiles?select=id')).status).toBe(200);
    await p.auth.signOut();
    expect(await p.auth.currentUser()).toBeNull();
    const after = await rawData(s, token, 'profiles?select=id');
    expect(after).toMatchObject({ status: 401, body: { code: 'SESSION_REVOKED' } });
  });

  it('ROOT CAUSE: a token kept in the Keychain whose session is gone (db reset / restart) → 0a, not a dead error', async () => {
    if (!sql) return;
    const { p } = await signUp(s, 'stale');
    const token = storedTokens()!.accessToken;
    const sessionId = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
      .session_id as string;
    // What `supabase db reset` (or stopping without a backup) does to every session.
    await sql`delete from auth.sessions where id = ${sessionId}`;
    // Relaunch the app: it signs in from the Keychain without asking the server…
    const relaunched = launch(s);
    expect(await relaunched.auth.currentUser()).not.toBeNull();
    // …and the Data API says SESSION_REVOKED. The app forgets the session instead of showing
    // "Couldn't load your data — Session revoked" with a "Try again" that can never work.
    await expect(loadLikeTheApp(relaunched)).rejects.toBeInstanceOf(SessionEndedError);
    expect(await relaunched.auth.currentUser()).toBeNull();
    expect(keychain.has('lifeos.session')).toBe(false);
    void p;
  });

  it('delete account: PENDING_DELETION from the Data API → the app switches to S-5h', async () => {
    const { p } = await signUp(s, 'delete');
    const reauth = await p.auth.reauthWithPassword(PASSWORD);
    await p.auth.requestDeletion(reauth);
    expect((await p.auth.currentUser())?.scope).toBe('PENDING_DELETION');
    const token = storedTokens()!.accessToken;
    expect(await rawData(s, token, 'profiles?select=id')).toMatchObject({
      status: 403,
      body: { code: 'PENDING_DELETION' },
    });
    expect(await p.auth.getDeletion()).not.toBeNull();
    await p.auth.cancelDeletion();
    expect((await p.auth.currentUser())?.scope).toBe('FULL');
    await loadLikeTheApp(p);
  });
});
