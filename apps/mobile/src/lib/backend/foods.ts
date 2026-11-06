import {
  portionMacros,
  roundGrams,
  toFood,
  type Food,
  type FoodRecord,
  type MealComponent,
  type MealLog,
  type SavedMeal,
} from '@life-os/core';
import type { Database } from '../database.types';

export type FoodRow = Database['public']['Tables']['foods']['Row'];
export type StoredFood = FoodRecord & { id: string };

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
    components,
    missingComponents: missing,
  };
}

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

export type { Food };
