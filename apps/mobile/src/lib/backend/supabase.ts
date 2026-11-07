import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { PRIVACY_POLICY_VERSION, toFood } from '@life-os/core';
import type { LifeOsClient } from '../supabase';
import {
  escapeLike,
  foodRecordFromRow,
  logMealItems,
  mealLogFromRow,
  saveMealComponents,
  savedMealFromRow,
  type FoodRow,
  type MealLogRow,
  type SavedMealRow,
} from './foods';
import { rowFromPatch, settingsFromRow } from './settings';
import { CancelledError, UserFacingError, type AuthUser, type Backend } from './types';

/** Where magic links and OAuth providers send the user back: `lifeos://auth/callback` (or the web origin). */
export const authRedirectUrl = (): string => Linking.createURL('auth/callback');

/** Read `code`, `error_description`, … from both the query string and the hash of a redirect URL. */
export function redirectParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const [beforeHash, hash = ''] = url.split('#');
  const query = beforeHash?.split('?')[1] ?? '';
  for (const part of [query, hash]) {
    for (const [k, v] of new URLSearchParams(part)) out[k] = v;
  }
  return out;
}

function friendly(error: { message?: string; code?: string; status?: number } | null): never {
  const msg = error?.message ?? 'Something went wrong. Please try again.';
  if (error?.code === '42501') {
    throw new UserFacingError(
      'Health data is off. Turn on “Use my health data” in Me to log meals and water.',
    );
  }
  // Raised by log_meal / save_meal with a message written for people.
  if (error?.code === '22023' || error?.code === 'P0002') {
    throw new UserFacingError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
  }
  if (/invalid login credentials/i.test(msg)) {
    throw new UserFacingError(
      'That email and password don’t match. Try again or use a sign-in link.',
    );
  }
  if (/rate limit|too many/i.test(msg) || error?.status === 429) {
    throw new UserFacingError('Too many attempts. Wait a minute and try again.');
  }
  if (/expired|invalid.*(otp|token|code)|verifier/i.test(msg)) {
    throw new UserFacingError(
      'That link has expired or was opened on another device. Send a new one.',
    );
  }
  throw new UserFacingError(msg);
}

const toUser = (u: { id: string; email?: string | null } | null | undefined): AuthUser | null =>
  u ? { id: u.id, email: u.email ?? null } : null;

export function supabaseBackend(client: LifeOsClient): Backend {
  const auth = client.auth;

  async function uid(): Promise<string> {
    const { data } = await auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new UserFacingError('You’re signed out. Sign in again to continue.');
    return id;
  }

  async function exchange(params: Record<string, string | undefined>): Promise<void> {
    if (params.error_description || params.error) {
      friendly({ message: params.error_description ?? params.error });
    }
    if (params.code) {
      const { error } = await auth.exchangeCodeForSession(
        params.code,
        params.sb_flow_id ? { flowId: params.sb_flow_id } : undefined,
      );
      if (error) friendly(error);
      return;
    }
    // Implicit-flow fallback (tokens in the hash).
    if (params.access_token && params.refresh_token) {
      const { error } = await auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });
      if (error) friendly(error);
      return;
    }
    throw new UserFacingError('That sign-in link is incomplete. Send a new one.');
  }

  /** OAuth via the system browser sheet (iOS/Android) or a full-page redirect (web). */
  async function oauth(provider: 'google' | 'apple'): Promise<void> {
    const redirectTo = authRedirectUrl();
    if (Platform.OS === 'web') {
      const { error } = await auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) friendly(error);
      return; // The page navigates away; /auth/callback finishes the sign-in.
    }
    const { data, error } = await auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) friendly(error);
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') throw new CancelledError('Sign-in cancelled');
    await exchange({ ...redirectParams(result.url), sb_flow_id: data.flowId ?? undefined });
  }

  return {
    auth: {
      async currentUser() {
        const { data } = await auth.getSession();
        return toUser(data.session?.user);
      },
      onChange(listener) {
        const { data } = auth.onAuthStateChange((_event, session) =>
          listener(toUser(session?.user)),
        );
        return () => data.subscription.unsubscribe();
      },
      async sendMagicLink(email) {
        const { error } = await auth.signInWithOtp({
          email,
          options: { emailRedirectTo: authRedirectUrl(), shouldCreateUser: true },
        });
        if (error) friendly(error);
      },
      async signInWithPassword(email, password) {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) friendly(error);
      },
      async signUpWithPassword(email, password) {
        const { data, error } = await auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authRedirectUrl() },
        });
        if (error) friendly(error);
        return { needsEmailConfirmation: !data.session };
      },
      async signInWithApple() {
        if (Platform.OS !== 'ios') return oauth('apple');
        let credential: AppleAuthentication.AppleAuthenticationCredential;
        try {
          credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
              AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
              AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
          });
        } catch (err) {
          if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') {
            throw new CancelledError('Sign-in cancelled');
          }
          throw err;
        }
        if (!credential.identityToken)
          throw new UserFacingError('Apple didn’t return a sign-in token.');
        const { error } = await auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) friendly(error);
        // Apple only shares the name on the very first sign-in, and not inside the token.
        const given = credential.fullName?.givenName?.trim();
        if (given) {
          await auth.updateUser({
            data: {
              given_name: given,
              full_name: [given, credential.fullName?.familyName].filter(Boolean).join(' '),
            },
          });
          const id = await uid();
          await client
            .from('profiles')
            .update({ display_name: given })
            .eq('id', id)
            .is('display_name', null);
        }
      },
      signInWithGoogle: () => oauth('google'),
      completeRedirect: exchange,
      async signOut() {
        const { error } = await auth.signOut();
        if (error) friendly(error);
      },
    },

    async getProfile() {
      const id = await uid();
      const { data, error } = await client
        .from('profiles')
        .select('display_name')
        .eq('id', id)
        .maybeSingle();
      if (error) friendly(error);
      return { displayName: data?.display_name ?? null };
    },
    async updateProfile({ displayName }) {
      const id = await uid();
      const name = displayName?.trim().slice(0, 80) || null;
      const { error } = await client.from('profiles').update({ display_name: name }).eq('id', id);
      if (error) friendly(error);
    },

    async getSettings() {
      const id = await uid();
      const { data, error } = await client
        .from('user_settings')
        .select('*')
        .eq('user_id', id)
        .single();
      if (error) friendly(error);
      return settingsFromRow(data);
    },
    async updateSettings(patch) {
      const id = await uid();
      const { error } = await client
        .from('user_settings')
        .update(rowFromPatch(patch))
        .eq('user_id', id);
      if (error) friendly(error);
    },

    async hasHealthConsent() {
      const { data, error } = await client.rpc('has_active_consent', {
        consent_type: 'health_data',
      });
      if (error) friendly(error);
      return Boolean(data);
    },
    async setHealthConsent(granted) {
      if (granted) {
        const { error } = await client
          .from('consents')
          .insert({ type: 'health_data', policy_version: PRIVACY_POLICY_VERSION });
        // 23505: already granted (one active consent per type) — nothing to do.
        if (error && error.code !== '23505') friendly(error);
        return;
      }
      const { error } = await client
        .from('consents')
        .update({ withdrawn_at: new Date().toISOString() })
        .eq('type', 'health_data')
        .is('withdrawn_at', null);
      if (error) friendly(error);
    },

    async listSavedMeals() {
      const { data, error } = await client
        .from('saved_meals')
        .select(
          'id, user_id, name, in_daily_plan, usual_time, sort_order, saved_meal_components(food_id, grams, position, foods(*))',
        )
        .order('sort_order')
        .order('created_at');
      if (error) friendly(error);
      return (data as unknown as SavedMealRow[]).map(savedMealFromRow);
    },
    async saveMeal(input) {
      const { data, error } = await client.rpc('save_meal', {
        p_id: input.id,
        p_name: input.name,
        p_in_daily_plan: input.inDailyPlan,
        p_usual_time: input.inDailyPlan ? input.usualTime : null,
        p_components: saveMealComponents(input.components),
      });
      if (error) friendly(error);
      return data as string;
    },
    async deleteSavedMeal(id) {
      const { error } = await client.from('saved_meals').delete().eq('id', id);
      if (error) friendly(error);
    },
    async listMealLogs({ from, to }) {
      const { data, error } = await client
        .from('meal_logs')
        .select(
          'id, user_id, saved_meal_id, name, logged_at, meal_log_items(food_id, food_name, grams, kcal, protein_g, carbs_g, fat_g, position)',
        )
        .gte('logged_at', from)
        .lt('logged_at', to)
        .order('logged_at');
      if (error) friendly(error);
      return (data as unknown as MealLogRow[]).map(mealLogFromRow);
    },
    async logMeal(input) {
      const { data, error } = await client.rpc('log_meal', {
        p_name: input.name,
        p_saved_meal_id: input.savedMealId,
        p_logged_at: input.loggedAt,
        p_items: logMealItems(input.components),
      });
      if (error) friendly(error);
      return data as string;
    },
    async listWaterLogs({ from, to }) {
      const { data, error } = await client
        .from('water_logs')
        .select('id, user_id, ml, logged_at')
        .gte('logged_at', from)
        .lt('logged_at', to)
        .order('logged_at');
      if (error) friendly(error);
      return data.map((w) => ({
        id: w.id,
        userId: w.user_id,
        ml: w.ml,
        loggedAt: new Date(w.logged_at).toISOString(),
      }));
    },
    async addWater(ml) {
      const { error } = await client.from('water_logs').insert({ ml });
      if (error) friendly(error);
    },
    async searchFoods(query) {
      const q = query.trim();
      if (!q) return [];
      const { data, error } = await client
        .from('foods')
        .select('*')
        .ilike('name', `%${escapeLike(q)}%`)
        .order('name')
        .limit(25);
      if (error) friendly(error);
      return data.map(foodRecordFromRow);
    },
    async getFoods(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await client
        .from('foods')
        .select('*')
        .in('id', [...ids]);
      if (error) friendly(error);
      return data.map(foodRecordFromRow);
    },
    async listRecentFoods(limit) {
      const { data, error } = await client
        .from('food_portions_last')
        .select('grams, logged_at, foods(*)')
        .order('logged_at', { ascending: false })
        .limit(limit);
      if (error) friendly(error);
      return (
        data as unknown as { grams: number; logged_at: string; foods: FoodRow | null }[]
      ).flatMap((r) => {
        const food = r.foods ? toFood(foodRecordFromRow(r.foods)) : null;
        return food
          ? [{ food, grams: Number(r.grams), loggedAt: new Date(r.logged_at).toISOString() }]
          : [];
      });
    },
  };
}
