import {
  cookedRatio,
  isCooksAs,
  portionMacros,
  roundGrams,
  toFood,
  type BatchIngredient,
  type BatchInfo,
  type CookedWeightIssue,
  type Food,
  type FoodRecord,
  type MealComponent,
  type MealLog,
  type SavedMeal,
} from '@life-os/core';
import type { Database } from '../database.types';

export type FoodRow = Database['public']['Tables']['foods']['Row'];
/** A stored food. `remembered: false` keeps a user food out of search and suggestions. */
export type StoredFood = FoodRecord & { id: string; remembered?: boolean };

const n = (v: number | string | null | undefined): number | null =>
  v == null || v === '' ? null : Number(v);

export function foodRecordFromRow(row: FoodRow): StoredFood {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source as FoodRecord['source'],
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    kcalPer100g: n(row.kcal_per_100g),
    proteinPer100g: n(row.protein_per_100g),
    carbsPer100g: n(row.carbs_per_100g),
    fatPer100g: n(row.fat_per_100g),
    fibrePer100g: n(row.fibre_per_100g),
    sugarPer100g: n(row.sugar_per_100g),
    saltPer100g: n(row.salt_per_100g),
    packGrams: n(row.pack_g),
    servingGrams: n(row.serving_g),
    remembered: row.remembered,
    ...(row.is_batch ? { batch: batchInfoFromRow(row) } : {}),
  };
}

function batchInfoFromRow(row: FoodRow): BatchInfo {
  return {
    cookedWeightG: Number(row.cooked_weight_g),
    weighed: Boolean(row.cooked_weight_weighed),
    cookedAt: new Date(row.cooked_at ?? row.updated_at).toISOString(),
    starred: row.starred,
  };
}

interface ComponentRow {
  food_id: string;
  grams: number | string;
  position: number;
  foods: FoodRow | null;
}

export interface SavedMealRow {
  id: string;
  user_id: string;
  name: string;
  in_daily_plan: boolean;
  usual_time: string | null;
  sort_order: number;
  starred: boolean;
  saved_meal_components: ComponentRow[];
}

/**
 * A roster meal with loggable components. Components whose food is gone or incomplete are
 * dropped and counted in `missingComponents` so the UI can say so.
 */
export type RosterMeal = SavedMeal & { missingComponents: number };

export function savedMealFromRow(row: SavedMealRow): RosterMeal {
  const components: MealComponent[] = [];
  let missing = 0;
  for (const c of [...row.saved_meal_components].sort((a, b) => a.position - b.position)) {
    const food = c.foods ? toFood(foodRecordFromRow(c.foods)) : null;
    if (food) components.push({ food, grams: Number(c.grams) });
    else missing++;
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    inDailyPlan: row.in_daily_plan,
    usualTime: row.usual_time ? row.usual_time.slice(0, 5) : null,
    starred: row.starred,
    components,
    missingComponents: missing,
  };
}

/** A batch (7f–7h): the food you log, plus the ingredients it was cooked from last time. */
export interface SavedBatch {
  food: Food & { batch: BatchInfo };
  ingredients: BatchIngredient[];
  /** Ingredients whose food is gone or incomplete (shown, never invented). */
  missingIngredients: number;
}

export interface BatchIngredientRow {
  food_id: string;
  grams: number | string;
  cooks_as: string;
  cooked_ratio: number | string;
  position: number;
  foods: FoodRow | null;
}

export type BatchRow = FoodRow & { batch_ingredients: BatchIngredientRow[] };

export function batchFromRow(row: BatchRow): SavedBatch | null {
  const food = toFood(foodRecordFromRow(row));
  if (!food?.batch) return null;
  const ingredients: BatchIngredient[] = [];
  let missing = 0;
  for (const i of [...row.batch_ingredients].sort((a, b) => a.position - b.position)) {
    const f = i.foods ? toFood(foodRecordFromRow(i.foods)) : null;
    if (f) {
      ingredients.push({
        food: f,
        grams: Number(i.grams),
        cooksAs: isCooksAs(i.cooks_as) ? i.cooks_as : 'as_added',
      });
    } else missing++;
  }
  return { food: food as SavedBatch['food'], ingredients, missingIngredients: missing };
}

/** Why a batch can't be saved yet, in words for people. */
export function batchIssueMessage(issue: CookedWeightIssue): string {
  if (issue === 'too_light') return 'That’s lighter than what went in the pot. Check the scales.';
  if (issue === 'too_heavy') return 'That’s over 50 kg. Check the scales.';
  return 'Add at least one ingredient.';
}

/** Ingredients for `save_batch`: grams to 1 dp, the chosen ratio and its key. */
export const saveBatchIngredients = (ingredients: readonly BatchIngredient[]) =>
  ingredients.map((i) => ({
    food_id: i.food.id,
    grams: roundGrams(i.grams),
    cooks_as: i.cooksAs,
    cooked_ratio: cookedRatio(i.cooksAs),
  }));

export interface MealLogRow {
  id: string;
  user_id: string;
  saved_meal_id: string | null;
  name: string;
  logged_at: string;
  meal_log_items: {
    food_id: string | null;
    food_name: string;
    grams: number | string;
    kcal: number;
    protein_g: number | string;
    carbs_g: number | string;
    fat_g: number | string;
    position: number;
  }[];
}

export function mealLogFromRow(row: MealLogRow): MealLog {
  return {
    id: row.id,
    userId: row.user_id,
    savedMealId: row.saved_meal_id,
    name: row.name,
    loggedAt: new Date(row.logged_at).toISOString(),
    items: [...row.meal_log_items]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        foodId: i.food_id,
        foodName: i.food_name,
        grams: Number(i.grams),
        macros: {
          kcal: Number(i.kcal),
          protein: Number(i.protein_g),
          carbs: Number(i.carbs_g),
          fat: Number(i.fat_g),
        },
      })),
  };
}

/** Items for `log_meal`: grams to 1 dp and macros from core, which the server re-checks. */
export function logMealItems(components: readonly MealComponent[]) {
  return components.map((c) => {
    const grams = roundGrams(c.grams);
    const m = portionMacros(c.food, grams);
    return {
      food_id: c.food.id,
      grams,
      kcal: m.kcal,
      protein: m.protein,
      carbs: m.carbs,
      fat: m.fat,
    };
  });
}

export const saveMealComponents = (components: readonly MealComponent[]) =>
  components.map((c) => ({ food_id: c.food.id, grams: roundGrams(c.grams) }));

/** Escape LIKE wildcards in user search text. */
export const escapeLike = (q: string): string => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A food the user adds from the label (7e) or corrects after a scan. */
export interface UserFoodInput {
  name: string;
  brand?: string | null;
  barcode?: string | null;
  per100g: { kcal: number; protein: number; carbs: number; fat: number };
  packGrams?: number | null;
  servingGrams?: number | null;
  /** "Remember this food": off keeps it out of search and suggestions. */
  remembered: boolean;
}

export type BarcodeLookup =
  | { status: 'found'; food: StoredFood; source: 'yours' | 'open_food_facts' }
  | { status: 'not_found' };

export type { Food };
