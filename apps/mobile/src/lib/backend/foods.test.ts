import { logMealItems, mealLogFromRow, savedMealFromRow, escapeLike, type FoodRow } from './foods';

const row = (over: Partial<FoodRow>): FoodRow => ({
  id: 'food-1',
  user_id: null,
  source: 'open_food_facts',
  barcode: '0000000000017',
  name: 'Greek yoghurt 0%',
  brand: 'Sample Dairy',
  kcal_per_100g: 57,
  protein_per_100g: 10,
  carbs_per_100g: 3.6,
  fat_per_100g: 0.2,
  fibre_per_100g: null,
  sugar_per_100g: 3.6,
  salt_per_100g: 0.1,
  off_fetched_at: null,
  pack_g: null,
  serving_g: null,
  remembered: true,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...over,
});

describe('backend row mapping', () => {
  it('maps a saved meal, sorting components and dropping incomplete foods', () => {
    const meal = savedMealFromRow({
      id: 'meal-1',
      user_id: 'u1',
      name: 'Snack · yoghurt bowl',
      in_daily_plan: true,
      usual_time: '16:00:00',
      sort_order: 0,
      saved_meal_components: [
        {
          food_id: 'b',
          grams: '80.0',
          position: 1,
          foods: row({ id: 'b', name: 'Berries', kcal_per_100g: 45 }),
        },
        { food_id: 'a', grams: 200, position: 0, foods: row({ id: 'a' }) },
        { food_id: 'c', grams: 30, position: 2, foods: row({ id: 'c', protein_per_100g: null }) },
      ],
    });
    expect(meal.usualTime).toBe('16:00');
    expect(meal.components.map((c) => [c.food.id, c.grams])).toEqual([
      ['a', 200],
      ['b', 80],
    ]);
    expect(meal.missingComponents).toBe(1);
  });

  it('maps a meal log with numeric strings', () => {
    const log = mealLogFromRow({
      id: 'log-1',
      user_id: 'u1',
      saved_meal_id: null,
      name: 'Lunch',
      logged_at: '2026-11-06T12:30:00+00:00',
      meal_log_items: [
        {
          food_id: 'a',
          food_name: 'Rice',
          grams: '150.0',
          kcal: 195,
          protein_g: '4.1',
          carbs_g: '42.0',
          fat_g: '0.5',
          position: 0,
        },
      ],
    });
    expect(log.loggedAt).toBe('2026-11-06T12:30:00.000Z');
    expect(log.items[0]!.macros).toEqual({ kcal: 195, protein: 4.1, carbs: 42, fat: 0.5 });
  });

  it('builds log_meal items with 1 dp grams and core macros', () => {
    const food = {
      id: 'r',
      name: 'Rice',
      source: 'user' as const,
      per100g: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    };
    expect(logMealItems([{ food, grams: 150.04 }])).toEqual([
      { food_id: 'r', grams: 150, kcal: 195, protein: 4.1, carbs: 42, fat: 0.5 },
    ]);
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
