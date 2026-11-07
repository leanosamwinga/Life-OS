/**
 * In-memory Backend for jest. Mirrors the rules that matter to the UI (e.g. health data
 * requires consent, like RLS) so flows can be tested without Supabase.
 */
import {
  portionMacros,
  toFood,
  type MealComponent,
  type MealLog,
  type WaterLog,
} from '@life-os/core';
import { logMealItems, type RosterMeal, type StoredFood } from '@/lib/backend/foods';
import {
  applyPatch,
  defaultUserSettings,
  type SettingsPatch,
  type UserSettings,
} from '@/lib/backend/settings';
import {
  UserFacingError,
  type AuthListener,
  type AuthUser,
  type Backend,
} from '@/lib/backend/types';

export interface MemoryState {
  user: AuthUser | null;
  displayName: string | null;
  settings: UserSettings;
  healthConsent: boolean;
  /** Every consent change, as the audit trail would record it. */
  consentLog: ('granted' | 'withdrawn')[];
  magicLinksSent: string[];
  passwords: Record<string, string>;
  calls: string[];
  foods: StoredFood[];
  savedMeals: {
    id: string;
    name: string;
    inDailyPlan: boolean;
    usualTime: string | null;
    components: { foodId: string; grams: number }[];
  }[];
  mealLogs: MealLog[];
  water: WaterLog[];
  lastPortions: Record<string, { grams: number; loggedAt: string }>;
}

export type MemoryBackend = Backend & {
  state: MemoryState;
  /** Make the next call of `method` reject with this error. */
  failNext(method: string, error: Error): void;
  /** Simulate signing in (e.g. after a magic link). */
  signInAs(user: AuthUser): void;
};

export const TEST_USER: AuthUser = { id: 'user-test-0001', email: 'user-a@example.test' };

export function createMemoryBackend(init: Partial<MemoryState> = {}): MemoryBackend {
  const state: MemoryState = {
    user: null,
    displayName: null,
    settings: defaultUserSettings(),
    healthConsent: false,
    consentLog: [],
    magicLinksSent: [],
    passwords: {},
    calls: [],
    foods: [],
    savedMeals: [],
    mealLogs: [],
    water: [],
    lastPortions: {},
    ...init,
  };
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-${++seq}`;
  const listeners = new Set<AuthListener>();
  const failures = new Map<string, Error>();

  const emit = () => listeners.forEach((l) => l(state.user));
  const call = async (name: string) => {
    state.calls.push(name);
    const err = failures.get(name);
    if (err) {
      failures.delete(name);
      throw err;
    }
  };
  const requireUser = () => {
    if (!state.user) throw new UserFacingError('Signed out');
  };
  /** Like RLS on health tables: nothing without an active consent. */
  const requireConsent = () => {
    requireUser();
    if (!state.healthConsent) {
      throw new UserFacingError(
        'Health data is off. Turn on “Use my health data” in Me to log meals and water.',
      );
    }
  };
  const food = (id: string) => {
    const r = state.foods.find((f) => f.id === id);
    return r ? toFood(r) : null;
  };
  const toRoster = (m: MemoryState['savedMeals'][number]): RosterMeal => {
    const components: MealComponent[] = [];
    let missing = 0;
    for (const c of m.components) {
      const f = food(c.foodId);
      if (f) components.push({ food: f, grams: c.grams });
      else missing++;
    }
    return {
      id: m.id,
      userId: state.user!.id,
      name: m.name,
      inDailyPlan: m.inDailyPlan,
      usualTime: m.usualTime,
      components,
      missingComponents: missing,
    };
  };
  const inRange = (t: string, r: { from: string; to: string }) =>
    Date.parse(t) >= Date.parse(r.from) && Date.parse(t) < Date.parse(r.to);

  const backend: MemoryBackend = {
    state,
    failNext: (method, error) => failures.set(method, error),
    signInAs(user) {
      state.user = user;
      emit();
    },
    auth: {
      async currentUser() {
        return state.user;
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async sendMagicLink(email) {
        await call('sendMagicLink');
        state.magicLinksSent.push(email);
      },
      async signInWithPassword(email, password) {
        await call('signInWithPassword');
        if (state.passwords[email] !== password) {
          throw new UserFacingError(
            'That email and password don’t match. Try again or use a sign-in link.',
          );
        }
        backend.signInAs({ id: TEST_USER.id, email });
      },
      async signUpWithPassword(email, password) {
        await call('signUpWithPassword');
        state.passwords[email] = password;
        backend.signInAs({ id: TEST_USER.id, email });
        return { needsEmailConfirmation: false };
      },
      async signInWithApple() {
        await call('signInWithApple');
        backend.signInAs(TEST_USER);
      },
      async signInWithGoogle() {
        await call('signInWithGoogle');
        backend.signInAs(TEST_USER);
      },
      async completeRedirect(params) {
        await call('completeRedirect');
        if (!params.code)
          throw new UserFacingError('That sign-in link is incomplete. Send a new one.');
        backend.signInAs(TEST_USER);
      },
      async signOut() {
        await call('signOut');
        state.user = null;
        emit();
      },
    },
    async getProfile() {
      await call('getProfile');
      requireUser();
      return { displayName: state.displayName };
    },
    async updateProfile({ displayName }) {
      await call('updateProfile');
      state.displayName = displayName?.trim() || null;
    },
    async getSettings() {
      await call('getSettings');
      requireUser();
      return structuredClone(state.settings);
    },
    async updateSettings(patch: SettingsPatch) {
      await call('updateSettings');
      state.settings = applyPatch(state.settings, patch);
    },
    async hasHealthConsent() {
      return state.healthConsent;
    },
    async setHealthConsent(granted) {
      await call('setHealthConsent');
      if (granted === state.healthConsent) return;
      state.healthConsent = granted;
      state.consentLog.push(granted ? 'granted' : 'withdrawn');
    },

    async listSavedMeals() {
      await call('listSavedMeals');
      requireConsent();
      return state.savedMeals.map(toRoster);
    },
    async saveMeal(input) {
      await call('saveMeal');
      requireConsent();
      if (input.inDailyPlan && !input.usualTime)
        throw new UserFacingError('Plan meals need a usual time.');
      const row = {
        id: input.id ?? newId('meal'),
        name: input.name.trim(),
        inDailyPlan: input.inDailyPlan,
        usualTime: input.inDailyPlan ? input.usualTime : null,
        components: input.components.map((c) => ({ foodId: c.food.id, grams: c.grams })),
      };
      const i = state.savedMeals.findIndex((m) => m.id === input.id);
      if (input.id && i === -1) throw new UserFacingError('Meal not found.');
      if (i === -1) state.savedMeals.push(row);
      else state.savedMeals[i] = row;
      return row.id;
    },
    async deleteSavedMeal(id) {
      await call('deleteSavedMeal');
      requireConsent();
      state.savedMeals = state.savedMeals.filter((m) => m.id !== id);
      state.mealLogs = state.mealLogs.map((l) =>
        l.savedMealId === id ? { ...l, savedMealId: null } : l,
      );
    },
    async listMealLogs(range) {
      await call('listMealLogs');
      requireConsent();
      return state.mealLogs.filter((l) => inRange(l.loggedAt, range));
    },
    async logMeal(input) {
      await call('logMeal');
      requireConsent();
      if (input.components.length === 0)
        throw new UserFacingError('A meal needs at least one component.');
      // Same check as the log_meal SQL function: recompute from the stored food.
      const items = logMealItems(input.components).map((item) => {
        const f = food(item.food_id);
        if (!f) throw new UserFacingError('Unknown food.');
        const m = portionMacros(f, item.grams);
        if (
          m.kcal !== item.kcal ||
          m.protein !== item.protein ||
          m.carbs !== item.carbs ||
          m.fat !== item.fat
        ) {
          throw new UserFacingError(`Nutrition for ${f.name} has changed; refresh and try again.`);
        }
        return { foodId: f.id, foodName: f.name, grams: item.grams, macros: m };
      });
      const log: MealLog = {
        id: newId('log'),
        userId: state.user!.id,
        savedMealId: input.savedMealId,
        name: input.name.trim(),
        loggedAt: input.loggedAt,
        items,
      };
      state.mealLogs.push(log);
      for (const i of items) {
        const prev = state.lastPortions[i.foodId!];
        if (!prev || Date.parse(prev.loggedAt) <= Date.parse(log.loggedAt)) {
          state.lastPortions[i.foodId!] = { grams: i.grams, loggedAt: log.loggedAt };
        }
      }
      return log.id;
    },
    async listWaterLogs(range) {
      await call('listWaterLogs');
      requireConsent();
      return state.water.filter((w) => inRange(w.loggedAt, range));
    },
    async addWater(ml) {
      await call('addWater');
      requireConsent();
      state.water.push({
        id: newId('water'),
        userId: state.user!.id,
        ml,
        loggedAt: new Date().toISOString(),
      });
    },
    async searchFoods(query) {
      await call('searchFoods');
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return state.foods.filter(
        (f) =>
          f.remembered !== false &&
          (f.userId === null || f.userId === state.user?.id) &&
          (f.name ?? '').toLowerCase().includes(q),
      );
    },
    async getFoods(ids) {
      return state.foods.filter((f) => ids.includes(f.id));
    },
    async listRecentFoods(limit) {
      await call('listRecentFoods');
      requireConsent();
      return Object.entries(state.lastPortions)
        .sort((a, b) => Date.parse(b[1].loggedAt) - Date.parse(a[1].loggedAt))
        .flatMap(([id, p]) => {
          const f = food(id);
          const remembered = state.foods.find((r) => r.id === id)?.remembered !== false;
          return f && remembered ? [{ food: f, grams: p.grams, loggedAt: p.loggedAt }] : [];
        })
        .slice(0, limit);
    },
    async lookupBarcode(barcode) {
      await call('lookupBarcode');
      requireUser();
      const own = state.foods.find((f) => f.barcode === barcode && f.userId === state.user!.id);
      if (own) return { status: 'found', food: own, source: 'yours' };
      const cached = state.foods.find((f) => f.barcode === barcode && f.userId === null);
      return cached
        ? { status: 'found', food: cached, source: 'open_food_facts' }
        : { status: 'not_found' };
    },
    async saveUserFood(input) {
      await call('saveUserFood');
      requireUser();
      const existing = input.barcode
        ? state.foods.find((f) => f.barcode === input.barcode && f.userId === state.user!.id)
        : undefined;
      const rec: StoredFood = {
        id: existing?.id ?? newId('food'),
        userId: state.user!.id,
        source: 'user',
        barcode: input.barcode ?? null,
        name: input.name.trim(),
        brand: input.brand ?? null,
        kcalPer100g: input.per100g.kcal,
        proteinPer100g: input.per100g.protein,
        carbsPer100g: input.per100g.carbs,
        fatPer100g: input.per100g.fat,
        fibrePer100g: null,
        sugarPer100g: null,
        saltPer100g: null,
        packGrams: input.packGrams ?? null,
        servingGrams: input.servingGrams ?? null,
        remembered: input.remembered,
      };
      state.foods = existing
        ? state.foods.map((f) => (f.id === existing.id ? rec : f))
        : [...state.foods, rec];
      return rec;
    },
  };
  return backend;
}
