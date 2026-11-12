/**
 * In-memory Backend for jest. Mirrors the rules that matter to the UI (e.g. health data
 * requires consent, like RLS) so flows can be tested without Supabase.
 */
import {
  componentUnit,
  toLondonDate,
  type TrainedDay,
  logWindow,
  portionMacros,
  summariseBatch,
  toFood,
  type AmountUnit,
  type CooksAs,
  type MealComponent,
  type MealLog,
  type WaterLog,
} from '@life-os/core';
import {
  batchIssueMessage,
  logMealItems,
  type RosterMeal,
  type SavedBatch,
  type StoredFood,
} from '@/lib/backend/foods';
import {
  sortSupplements,
  type HealthDailyValue,
  type Supplement,
  type SupplementLog,
} from '@/lib/backend/health';
import {
  applyPatch,
  defaultUserSettings,
  type SettingsPatch,
  type UserSettings,
} from '@/lib/backend/settings';
import {
  UserFacingError,
  type AuthUser,
  type Backend,
  type LogMealInput,
} from '@/lib/backend/types';
import { createMemoryAuth, type MemoryAuth, type MemoryAuthState } from './memoryAuth';

export interface MemoryState {
  user: AuthUser | null;
  displayName: string | null;
  settings: UserSettings;
  healthConsent: boolean;
  /** Every consent change, as the audit trail would record it. */
  consentLog: ('granted' | 'withdrawn')[];
  calls: string[];
  foods: StoredFood[];
  savedMeals: {
    id: string;
    name: string;
    inDailyPlan: boolean;
    usualTime: string | null;
    starred?: boolean;
    components: { foodId: string; grams: number; unit?: AmountUnit }[];
  }[];
  /** Batches are foods (with `batch` set); their ingredients by batch id. */
  batchIngredients: Record<string, { foodId: string; grams: number; cooksAs: CooksAs }[]>;
  mealLogs: MealLog[];
  water: WaterLog[];
  lastPortions: Record<string, { grams: number; loggedAt: string; unit?: AmountUnit }>;
  /** Internal edited-at bookkeeping by log id (never shown in the app). */
  editedAt: Record<string, string>;
  supplements: Supplement[];
  supplementLogs: SupplementLog[];
  trainingDays: TrainedDay[];
  /** What the iPhone has synced from Apple Health (health_daily). */
  healthDaily: HealthDailyValue[];
}

export type MemoryBackend = Backend & {
  state: MemoryState;
  /** The fake auth-api (accounts, codes, tickets, sessions). */
  auth: MemoryAuth;
  /** Make the next call of `method` reject with this error (data or auth methods). */
  failNext(method: string, error: Error): void;
  signInAs(user: AuthUser | null): void;
};

export { MEMORY_EMAIL_CODE, TEST_PASSWORD, BREACHED_PASSWORD } from './memoryAuth';

export const TEST_USER: AuthUser = { id: 'user-test-0001', email: 'user-a@example.test' };

export function createMemoryBackend(
  init: Partial<MemoryState> = {},
  authInit: Partial<MemoryAuthState> = {},
): MemoryBackend {
  const state: MemoryState = {
    user: null,
    displayName: null,
    settings: defaultUserSettings(),
    healthConsent: false,
    consentLog: [],
    calls: [],
    foods: [],
    savedMeals: [],
    mealLogs: [],
    water: [],
    lastPortions: {},
    editedAt: {},
    batchIngredients: {},
    supplements: [],
    supplementLogs: [],
    trainingDays: [],
    healthDaily: [],
    ...init,
  };
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-${++seq}`;
  const failures = new Map<string, Error>();
  const auth = createMemoryAuth({ ...authInit, user: authInit.user ?? state.user });
  // One user for both halves: the data fake follows the auth fake.
  auth.onChange((u) => {
    state.user = u;
  });
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
  /** Like RLS on foods: batches are health data, hidden without consent. */
  const visible = (f: StoredFood) => !f.batch || state.healthConsent;
  const food = (id: string) => {
    const r = state.foods.find((f) => f.id === id && visible(f));
    return r ? toFood(r) : null;
  };
  /** log_meal's checks and writes; throws before changing anything. */
  const logInto = (input: LogMealInput): string => {
    requireConsent();
    if (input.components.length === 0)
      throw new UserFacingError('A meal needs at least one component.');
    requireMealTime(input.loggedAt);
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
      return {
        foodId: f.id,
        foodName: f.name,
        grams: item.grams,
        unit: item.unit,
        macros: m,
      };
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
        state.lastPortions[i.foodId!] = {
          grams: i.grams,
          unit: i.unit,
          loggedAt: log.loggedAt,
        };
      }
    }
    return log.id;
  };
  const toRoster = (m: MemoryState['savedMeals'][number]): RosterMeal => {
    const components: MealComponent[] = [];
    let missing = 0;
    for (const c of m.components) {
      const f = food(c.foodId);
      if (f) components.push({ food: f, grams: c.grams, unit: c.unit ?? f.unit ?? 'g' });
      else missing++;
    }
    return {
      id: m.id,
      userId: state.user!.id,
      name: m.name,
      inDailyPlan: m.inDailyPlan,
      usualTime: m.usualTime,
      starred: Boolean(m.starred),
      components,
      missingComponents: missing,
    };
  };
  const toBatch = (rec: StoredFood): SavedBatch => {
    const ingredients: SavedBatch['ingredients'] = [];
    let missing = 0;
    for (const i of state.batchIngredients[rec.id] ?? []) {
      const f = food(i.foodId);
      if (f) ingredients.push({ food: f, grams: i.grams, cooksAs: i.cooksAs });
      else missing++;
    }
    return { food: toFood(rec) as SavedBatch['food'], ingredients, missingIngredients: missing };
  };
  /** Same window as check_meal_time: yesterday 00:00 to an hour from now (+2 min grace). */
  const requireMealTime = (at: string) => {
    const w = logWindow(new Date());
    if (Date.parse(at) < Date.parse(w.earliest))
      throw new UserFacingError('Pick a time from yesterday 00:00 onwards.');
    if (Date.parse(at) > Date.parse(w.latest) + 2 * 60000)
      throw new UserFacingError('Pick a time no more than an hour from now.');
  };
  /** As lock_logged_meal: a meal from before yesterday is history (no edits, no deletes). */
  const requireChangeable = (at: string) => {
    if (Date.parse(at) < Date.parse(logWindow(new Date()).earliest))
      throw new UserFacingError('Meals from before yesterday can’t be changed.');
  };
  const inRange = (t: string, r: { from: string; to: string }) =>
    Date.parse(t) >= Date.parse(r.from) && Date.parse(t) < Date.parse(r.to);
  const inDays = (d: string, r: { start: string; end: string }) => d >= r.start && d <= r.end;
  const today = () => toLondonDate(new Date());

  const backend: MemoryBackend = {
    state,
    failNext: (method, error) => {
      failures.set(method, error);
      auth.failNext(method, error);
    },
    signInAs(user) {
      state.user = user;
      auth.signInAs(user);
    },
    auth,
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
        starred: state.savedMeals.find((m) => m.id === input.id)?.starred ?? false,
        name: input.name.trim(),
        inDailyPlan: input.inDailyPlan,
        usualTime: input.inDailyPlan ? input.usualTime : null,
        components: input.components.map((c) => ({
          foodId: c.food.id,
          grams: c.grams,
          unit: componentUnit(c),
        })),
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
    async listBatches() {
      await call('listBatches');
      requireConsent();
      return state.foods.filter((f) => f.batch && f.userId === state.user!.id).map(toBatch);
    },
    async saveBatch(input) {
      await call('saveBatch');
      requireConsent();
      if (!input.name.trim()) throw new UserFacingError('Give the batch a name.');
      // Same checks as the save_batch SQL function: current foods, recomputed numbers.
      const ingredients = input.ingredients.map((i) => {
        const f = food(i.food.id);
        if (!f) throw new UserFacingError('Unknown food.');
        if (f.batch) throw new UserFacingError('A batch can’t go in another batch.');
        return { ...i, food: f };
      });
      const s = summariseBatch(ingredients, input.weighedG);
      if (!s.per100g) throw new UserFacingError(batchIssueMessage(s.issue ?? 'missing'));
      const existing = input.id ? state.foods.find((f) => f.id === input.id && f.batch) : null;
      if (input.id && !existing) throw new UserFacingError('Batch not found.');
      const id = input.id ?? newId('batch');
      const rec: StoredFood = {
        id,
        userId: state.user!.id,
        source: 'user',
        barcode: null,
        name: input.name.trim(),
        brand: null,
        kcalPer100g: s.per100g.kcal,
        proteinPer100g: s.per100g.protein,
        carbsPer100g: s.per100g.carbs,
        fatPer100g: s.per100g.fat,
        fibrePer100g: null,
        sugarPer100g: null,
        saltPer100g: null,
        packGrams: null,
        servingGrams: null,
        remembered: true,
        batch: {
          cookedWeightG: s.cookedWeightG,
          weighed: s.weighed,
          cookedAt: new Date().toISOString(),
          starred: existing?.batch?.starred ?? false,
        },
      };
      state.foods = existing
        ? state.foods.map((f) => (f.id === id ? rec : f))
        : [...state.foods, rec];
      state.batchIngredients[id] = ingredients.map((i) => ({
        foodId: i.food.id,
        grams: i.grams,
        cooksAs: i.cooksAs,
      }));
      return id;
    },
    async deleteBatch(id) {
      await call('deleteBatch');
      requireConsent();
      if (state.savedMeals.some((m) => m.components.some((c) => c.foodId === id))) {
        throw new UserFacingError(
          'This batch is in a saved meal. Take it out of that meal first, then delete the batch.',
        );
      }
      state.foods = state.foods.filter((f) => f.id !== id);
      delete state.batchIngredients[id];
      delete state.lastPortions[id];
      state.mealLogs = state.mealLogs.map((l) => ({
        ...l,
        items: l.items.map((i) => (i.foodId === id ? { ...i, foodId: null } : i)),
      }));
    },
    async setStarred(target, starred) {
      await call('setStarred');
      requireConsent();
      if (target.kind === 'meal') {
        state.savedMeals = state.savedMeals.map((m) =>
          m.id === target.id ? { ...m, starred } : m,
        );
      } else {
        state.foods = state.foods.map((f) =>
          f.id === target.id && f.batch ? { ...f, batch: { ...f.batch, starred } } : f,
        );
      }
    },
    async listMealLogs(range) {
      await call('listMealLogs');
      requireConsent();
      return state.mealLogs.filter((l) => inRange(l.loggedAt, range));
    },
    async logMeal(input) {
      await call('logMeal');
      return logInto(input);
    },
    async replaceLoggedMeal(oldId, input) {
      await call('replaceLoggedMeal');
      requireConsent();
      // Like replace_logged_meal: the old meal must be yours and inside the window, the new one
      // passes log_meal's checks, and either both happen or neither.
      const old = state.mealLogs.find((l) => l.id === oldId);
      if (!old) throw new UserFacingError('That meal has already gone.');
      requireChangeable(old.loggedAt);
      const id = logInto({ ...input, savedMealId: old.savedMealId });
      state.mealLogs = state.mealLogs.filter((l) => l.id !== oldId);
      return id;
    },
    async updateLoggedMeal(edit) {
      await call('updateLoggedMeal');
      requireConsent();
      const i = state.mealLogs.findIndex((l) => l.id === edit.id);
      if (i === -1) throw new UserFacingError('Meal not found.');
      const name = edit.name.trim();
      if (!name || name.length > 120) throw new UserFacingError('Give the meal a name.');
      const log = state.mealLogs[i]!;
      requireChangeable(log.loggedAt);
      if (edit.loggedAt && edit.loggedAt !== log.loggedAt) requireMealTime(edit.loggedAt);
      // Only labels change: amounts and macros stay as logged (1 ml counts as 1 g).
      state.mealLogs[i] = {
        ...log,
        name,
        loggedAt: edit.loggedAt ?? log.loggedAt,
        items: log.items.map((item, position) => {
          const u = edit.units.find((x) => x.position === position);
          return u ? { ...item, unit: u.unit } : item;
        }),
      };
      state.editedAt[edit.id] = new Date().toISOString();
    },
    async deleteMealLog(id) {
      await call('deleteMealLog');
      requireConsent();
      const log = state.mealLogs.find((l) => l.id === id);
      if (!log) throw new UserFacingError('That meal has already gone.');
      requireChangeable(log.loggedAt);
      state.mealLogs = state.mealLogs.filter((l) => l.id !== id);
    },
    async listWaterLogs(range) {
      await call('listWaterLogs');
      requireConsent();
      return state.water.filter((w) => inRange(w.loggedAt, range));
    },
    async addWater(ml) {
      await call('addWater');
      requireConsent();
      // Like the water_logs check: a whole number from 1 to 5,000.
      if (!Number.isInteger(ml) || ml < 1 || ml > 5000)
        throw new UserFacingError('Water must be a whole number from 1 to 5,000 ml.');
      state.water.push({
        id: newId('water'),
        userId: state.user!.id,
        ml,
        loggedAt: new Date().toISOString(),
      });
    },
    async deleteWater(id) {
      await call('deleteWater');
      requireConsent();
      state.water = state.water.filter((w) => w.id !== id);
    },
    async searchFoods(query) {
      await call('searchFoods');
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return state.foods.filter(
        (f) =>
          f.remembered !== false &&
          visible(f) &&
          (f.userId === null || f.userId === state.user?.id) &&
          (f.name ?? '').toLowerCase().includes(q),
      );
    },
    async getFoods(ids) {
      return state.foods.filter((f) => ids.includes(f.id) && visible(f));
    },
    async listRecentFoods(limit) {
      await call('listRecentFoods');
      requireConsent();
      return Object.entries(state.lastPortions)
        .sort((a, b) => Date.parse(b[1].loggedAt) - Date.parse(a[1].loggedAt))
        .flatMap(([id, p]) => {
          const f = food(id);
          const remembered = state.foods.find((r) => r.id === id)?.remembered !== false;
          return f && remembered
            ? [{ food: f, grams: p.grams, unit: p.unit ?? 'g', loggedAt: p.loggedAt }]
            : [];
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
        nutritionUnit: input.unit ?? 'g',
        packGrams: input.packGrams ?? null,
        servingGrams: input.servingGrams ?? null,
        remembered: input.remembered,
      };
      state.foods = existing
        ? state.foods.map((f) => (f.id === existing.id ? rec : f))
        : [...state.foods, rec];
      return rec;
    },


    async listSupplements() {
      await call('listSupplements');
      requireConsent();
      return sortSupplements(state.supplements);
    },
    async saveSupplement(input) {
      await call('saveSupplement');
      requireConsent();
      const name = input.name.trim();
      // Like the supplements checks: a name of 1–80 characters, a dose of up to 40.
      if (!name || name.length > 80) throw new UserFacingError('Give the supplement a name.');
      if ((input.dose ?? '').length > 40) throw new UserFacingError('Keep the dose short.');
      const row: Supplement = {
        id: input.id ?? newId('supp'),
        name,
        dose: input.dose?.trim() || null,
        timeOfDay: input.timeOfDay,
        reminderTime: input.reminderTime,
        sortOrder: input.sortOrder,
      };
      if (input.id && !state.supplements.some((x) => x.id === input.id))
        throw new UserFacingError('Supplement not found.');
      state.supplements = input.id
        ? state.supplements.map((x) => (x.id === input.id ? row : x))
        : [...state.supplements, row];
      return row.id;
    },
    async deleteSupplement(id) {
      await call('deleteSupplement');
      requireConsent();
      state.supplements = state.supplements.filter((x) => x.id !== id);
      state.supplementLogs = state.supplementLogs.filter((l) => l.supplementId !== id);
    },
    async listSupplementLogs(range) {
      await call('listSupplementLogs');
      requireConsent();
      return state.supplementLogs.filter((l) => inDays(l.takenOn, range));
    },
    async setSupplementTaken(id, taken) {
      await call('setSupplementTaken');
      requireConsent();
      const day = today();
      const has = state.supplementLogs.some((l) => l.supplementId === id && l.takenOn === day);
      if (taken && !has) state.supplementLogs.push({ supplementId: id, takenOn: day });
      if (!taken)
        state.supplementLogs = state.supplementLogs.filter(
          (l) => !(l.supplementId === id && l.takenOn === day),
        );
    },
    async listTrainingDays(range) {
      await call('listTrainingDays');
      requireConsent();
      return state.trainingDays
        .filter((d) => inDays(d.trainedOn, range))
        .sort((a, b) => (a.trainedOn < b.trainedOn ? -1 : 1));
    },
    async markTrained(date, split) {
      await call('markTrained');
      requireConsent();
      // Like training_days_guard and the unique (user_id, trained_on) with on conflict do nothing.
      if (date > today())
        throw new UserFacingError('Training can’t be marked for a day that hasn’t happened yet.');
      if (state.trainingDays.some((d) => d.trainedOn === date)) return;
      state.trainingDays.push({
        trainedOn: date,
        splitDay: split?.day ?? null,
        splitName: split?.name ?? null,
      });
    },
    async unmarkTrained(date) {
      await call('unmarkTrained');
      requireConsent();
      state.trainingDays = state.trainingDays.filter((d) => d.trainedOn !== date);
    },
    async listHealthDaily(range) {
      await call('listHealthDaily');
      requireConsent();
      return state.healthDaily.filter((v) => inDays(v.day, range));
    },
    async upsertHealthDaily(values) {
      await call('upsertHealthDaily');
      requireConsent();
      for (const v of values) {
        state.healthDaily = [
          ...state.healthDaily.filter((x) => !(x.day === v.day && x.kind === v.kind)),
          { ...v },
        ];
      }
    },
  };
  return backend;
}
