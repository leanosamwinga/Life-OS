import { FunctionsHttpError } from '@supabase/supabase-js';
import { PRIVACY_POLICY_VERSION, summariseBatch, toFood } from '@life-os/core';
import type { AuthClient } from '../auth/client';
import type { LifeOsClient } from '../supabase';
import {
  batchFromRow,
  batchIssueMessage,
  escapeLike,
  foodRecordFromRow,
  logMealItems,
  mealLogFromRow,
  saveBatchIngredients,
  saveMealComponents,
  savedMealFromRow,
  unitOf,
  type BatchRow,
  type FoodRow,
  type MealLogRow,
  type SavedMealRow,
} from './foods';
import { rowFromPatch, settingsFromRow } from './settings';
import { SESSION_ENDED_CODES } from './sessionFetch';
import { SessionEndedError, UserFacingError, type Backend } from './types';
import type { StoredFood } from './foods';

/**
 * Generated RPC argument types can't say that a SQL parameter accepts NULL (postgres-meta types
 * every argument as its base type), but save_meal and log_meal take NULL for "new" and "none".
 */
const sqlNull = <T>(value: T | null) => value as T;

function friendly(error: { message?: string; code?: string; status?: number } | null): never {
  const msg = error?.message ?? 'Something went wrong. Please try again.';
  if (error?.code && SESSION_ENDED_CODES.has(error.code)) throw new SessionEndedError();
  if (error?.code === '42501') {
    throw new UserFacingError(
      'Health data is off. Turn on “Use my health data” in Me to log meals and water.',
    );
  }
  // Raised by log_meal / save_meal with a message written for people.
  if (error?.code === '22023' || error?.code === 'P0002') {
    throw new UserFacingError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
  }
  if (/rate limit|too many/i.test(msg) || error?.status === 429) {
    throw new UserFacingError('Too many attempts. Wait a minute and try again.');
  }
  throw new UserFacingError(msg);
}

export function supabaseBackend(client: LifeOsClient, authClient: AuthClient): Backend {
  async function uid(): Promise<string> {
    const id = await authClient.userId();
    if (!id) throw new UserFacingError('You’re signed out. Sign in again to continue.');
    return id;
  }

  return {
    auth: authClient,

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
          'id, user_id, name, in_daily_plan, usual_time, sort_order, starred, saved_meal_components(food_id, grams, unit, position, foods(*))',
        )
        .order('sort_order')
        .order('created_at');
      if (error) friendly(error);
      return (data as unknown as SavedMealRow[]).map(savedMealFromRow);
    },
    async saveMeal(input) {
      const { data, error } = await client.rpc('save_meal', {
        p_id: sqlNull(input.id),
        p_name: input.name,
        p_in_daily_plan: input.inDailyPlan,
        p_usual_time: sqlNull(input.inDailyPlan ? input.usualTime : null),
        p_components: saveMealComponents(input.components),
      });
      if (error) friendly(error);
      return data as string;
    },
    async deleteSavedMeal(id) {
      const { error } = await client.from('saved_meals').delete().eq('id', id);
      if (error) friendly(error);
    },
    async listBatches() {
      const { data, error } = await client
        .from('foods')
        .select(
          '*, batch_ingredients!batch_ingredients_batch_fkey(food_id, grams, cooks_as, cooked_ratio, position, foods!batch_ingredients_food_id_fkey(*))',
        )
        .eq('is_batch', true)
        .order('name');
      if (error) friendly(error);
      return (data as unknown as BatchRow[]).flatMap((r) => batchFromRow(r) ?? []);
    },
    async saveBatch(input) {
      // Core's numbers; save_batch recomputes them from the foods and refuses any mismatch.
      const s = summariseBatch(input.ingredients, input.weighedG);
      if (!s.per100g) throw new UserFacingError(batchIssueMessage(s.issue ?? 'missing'));
      const { data, error } = await client.rpc('save_batch', {
        p_id: sqlNull(input.id),
        p_name: input.name,
        p_cooked_weight_g: s.cookedWeightG,
        p_weighed: s.weighed,
        p_per_100g: {
          kcal: s.per100g.kcal,
          protein: s.per100g.protein,
          carbs: s.per100g.carbs,
          fat: s.per100g.fat,
        },
        p_ingredients: saveBatchIngredients(input.ingredients),
      });
      if (error) friendly(error);
      return data as string;
    },
    async deleteBatch(id) {
      const { error } = await client.from('foods').delete().eq('id', id).eq('is_batch', true);
      if (error?.code === '23503') {
        throw new UserFacingError(
          'This batch is in a saved meal. Take it out of that meal first, then delete the batch.',
        );
      }
      if (error) friendly(error);
    },
    async setStarred(target, starred) {
      const { error } =
        target.kind === 'meal'
          ? await client.from('saved_meals').update({ starred }).eq('id', target.id)
          : await client.from('foods').update({ starred }).eq('id', target.id);
      if (error) friendly(error);
    },
    async listMealLogs({ from, to }) {
      const { data, error } = await client
        .from('meal_logs')
        .select(
          'id, user_id, saved_meal_id, name, logged_at, meal_log_items(food_id, food_name, grams, unit, kcal, protein_g, carbs_g, fat_g, position)',
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
        p_saved_meal_id: sqlNull(input.savedMealId),
        p_logged_at: input.loggedAt,
        p_items: logMealItems(input.components),
      });
      if (error) friendly(error);
      return data as string;
    },
    async updateLoggedMeal(edit) {
      const { error } = await client.rpc('update_logged_meal', {
        p_id: edit.id,
        p_name: edit.name,
        p_logged_at: sqlNull(edit.loggedAt),
        p_units: edit.units.length ? edit.units : sqlNull(null),
      });
      if (error) friendly(error);
    },
    async deleteMealLog(id) {
      const { error } = await client.rpc('delete_logged_meal', { p_id: id });
      if (error?.code === 'P0002') throw new UserFacingError('That meal has already gone.');
      if (error) friendly(error);
    },
    async replaceLoggedMeal(oldId, input) {
      const { data, error } = await client.rpc('replace_logged_meal', {
        p_old_id: oldId,
        p_name: input.name,
        p_logged_at: input.loggedAt,
        p_items: logMealItems(input.components),
      });
      if (error?.code === 'P0002') throw new UserFacingError('That meal has already gone.');
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
    async deleteWater(id) {
      const { error } = await client.from('water_logs').delete().eq('id', id);
      if (error) friendly(error);
    },
    async searchFoods(query) {
      const q = query.trim();
      if (!q) return [];
      const { data, error } = await client
        .from('foods')
        .select('*')
        .ilike('name', `%${escapeLike(q)}%`)
        .eq('remembered', true)
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
        .select('grams, unit, logged_at, foods(*)')
        .order('logged_at', { ascending: false })
        .limit(limit);
      if (error) friendly(error);
      return (
        data as unknown as {
          grams: number;
          unit: string | null;
          logged_at: string;
          foods: FoodRow | null;
        }[]
      ).flatMap((r) => {
        const food = r.foods?.remembered ? toFood(foodRecordFromRow(r.foods)) : null;
        return food
          ? [
              {
                food,
                grams: Number(r.grams),
                unit: unitOf(r.unit),
                loggedAt: new Date(r.logged_at).toISOString(),
              },
            ]
          : [];
      });
    },
    async lookupBarcode(barcode) {
      const id = await uid();
      const own = await client
        .from('foods')
        .select('*')
        .eq('user_id', id)
        .eq('barcode', barcode)
        .maybeSingle();
      if (own.error) friendly(own.error);
      if (own.data) return { status: 'found', food: foodRecordFromRow(own.data), source: 'yours' };

      const { data, error } = await client.functions.invoke<{ food: StoredFood }>('food-lookup', {
        body: { barcode },
      });
      if (error) {
        const status = error instanceof FunctionsHttpError ? (error.context as Response).status : 0;
        if (status === 404) return { status: 'not_found' };
        if (status === 400) {
          throw new UserFacingError(
            'That doesn’t look like a food barcode. Try again or type it in.',
          );
        }
        throw new UserFacingError(
          'Couldn’t look that barcode up right now. Try again, or add it from the label.',
        );
      }
      if (!data?.food?.id) return { status: 'not_found' };
      return { status: 'found', food: data.food, source: 'open_food_facts' };
    },
    async saveUserFood(input) {
      const id = await uid();
      const row = {
        user_id: id,
        source: 'user' as const,
        name: input.name.trim().slice(0, 200),
        brand: input.brand?.trim() || null,
        barcode: input.barcode || null,
        kcal_per_100g: input.per100g.kcal,
        protein_per_100g: input.per100g.protein,
        carbs_per_100g: input.per100g.carbs,
        fat_per_100g: input.per100g.fat,
        nutrition_unit: input.unit ?? 'g',
        pack_g: input.packGrams ?? null,
        serving_g: input.servingGrams ?? null,
        remembered: input.remembered,
      };
      // One own food per barcode: correcting a scanned product updates your version.
      let existingId: string | null = null;
      if (input.barcode) {
        const { data, error } = await client
          .from('foods')
          .select('id')
          .eq('user_id', id)
          .eq('barcode', input.barcode)
          .maybeSingle();
        if (error) friendly(error);
        existingId = data?.id ?? null;
      }
      const query = existingId
        ? client.from('foods').update(row).eq('id', existingId)
        : client.from('foods').insert(row);
      const { data, error } = await query.select('*').single();
      if (error) friendly(error);
      return foodRecordFromRow(data);
    },
  };
}
