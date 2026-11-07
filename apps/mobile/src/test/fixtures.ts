/** Obviously fake foods and meals for jest flows. */
import { snapshotComponents, toFood, type Food, type MealLog } from '@life-os/core';
import type { StoredFood } from '@/lib/backend/foods';
import { createMemoryBackend, TEST_USER, type MemoryState } from './memoryBackend';

const record = (
  id: string,
  name: string,
  per: [number | null, number | null, number | null, number | null],
  over: Partial<StoredFood> = {},
): StoredFood => ({
  id,
  userId: null,
  source: 'open_food_facts',
  barcode: `00000000009${id.slice(-2)}`,
  name,
  brand: 'Sample Brand',
  kcalPer100g: per[0],
  proteinPer100g: per[1],
  carbsPer100g: per[2],
  fatPer100g: per[3],
  fibrePer100g: null,
  sugarPer100g: null,
  saltPer100g: null,
  ...over,
});

export const FOODS = {
  chicken: record('food-01', 'Chicken breast, raw', [106, 24, 0, 1.2]),
  rice: record('food-02', 'Basmati rice, cooked', [130, 2.7, 28, 0.3]),
  yoghurt: record('food-03', 'Greek yoghurt 0%', [57, 10, 3.6, 0.2]),
  berries: record('food-04', 'Berries', [45, 0.8, 9, 0.3], {
    source: 'user',
    userId: TEST_USER.id,
    barcode: null,
  }),
  oats: record('food-05', 'Porridge oats', [375, 11, 60, 8]),
  sauce: record('food-06', 'Sweet chilli sauce', [120, null, 28, 0.5]),
};

export const food = (r: StoredFood): Food => toFood(r)!;

/** A signed-in, onboarded user with health consent, a roster and breakfast logged today. */
export function liveState(over: Partial<MemoryState> = {}): Partial<MemoryState> {
  const base = createMemoryBackend().state.settings;
  const breakfast: MealLog = {
    id: 'log-breakfast',
    userId: TEST_USER.id,
    savedMealId: 'meal-breakfast',
    name: 'Breakfast · oats',
    loggedAt: '2026-11-06T08:00:00.000Z',
    items: snapshotComponents([{ food: food(FOODS.oats), grams: 80 }]),
  };
  const stirFry: MealLog = {
    id: 'log-stirfry',
    userId: TEST_USER.id,
    savedMealId: null,
    name: 'Chicken stir-fry',
    loggedAt: '2026-11-04T18:30:00.000Z',
    items: snapshotComponents([
      { food: food(FOODS.chicken), grams: 150 },
      { food: food(FOODS.rice), grams: 100 },
    ]),
  };
  return {
    user: TEST_USER,
    displayName: 'Sample',
    healthConsent: true,
    settings: {
      ...base,
      onboardingCompletedAt: '2026-11-01T09:00:00Z',
      targets: { kcal: 2450, protein: 180, carbs: 250, fat: 75, waterMl: 3000, steps: 10000 },
    },
    foods: Object.values(FOODS),
    savedMeals: [
      {
        id: 'meal-breakfast',
        name: 'Breakfast · oats',
        inDailyPlan: true,
        usualTime: '08:00',
        components: [{ foodId: FOODS.oats.id, grams: 80 }],
      },
      {
        id: 'meal-snack',
        name: 'Snack · yoghurt bowl',
        inDailyPlan: true,
        usualTime: '16:00',
        components: [
          { foodId: FOODS.yoghurt.id, grams: 200 },
          { foodId: FOODS.berries.id, grams: 80 },
        ],
      },
      {
        id: 'meal-dinner',
        name: 'Dinner · chicken & rice',
        inDailyPlan: true,
        usualTime: '18:15',
        components: [
          { foodId: FOODS.chicken.id, grams: 200 },
          { foodId: FOODS.rice.id, grams: 200 },
        ],
      },
      {
        id: 'meal-shake',
        name: 'Protein shake',
        inDailyPlan: false,
        usualTime: null,
        components: [{ foodId: FOODS.yoghurt.id, grams: 300 }],
      },
    ],
    mealLogs: [breakfast, stirFry],
    water: [{ id: 'w1', userId: TEST_USER.id, ml: 500, loggedAt: '2026-11-06T09:00:00.000Z' }],
    lastPortions: {
      [FOODS.chicken.id]: { grams: 150, loggedAt: '2026-11-04T18:30:00.000Z' },
      [FOODS.rice.id]: { grams: 100, loggedAt: '2026-11-04T18:30:00.000Z' },
      [FOODS.oats.id]: { grams: 80, loggedAt: '2026-11-06T08:00:00.000Z' },
    },
    ...over,
  };
}
