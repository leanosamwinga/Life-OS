import { describe, expect, it } from 'vitest';
import type { DailyTargets, Food, MealComponent, MealLog } from './types.ts';
import {
  dayProgress,
  portionMacros,
  checkPer100g,
  per100gFromServing,
  roundGrams,
  roundTo,
  snapshotComponents,
  sumMacros,
  toFood,
} from './nutrition.ts';

const food = (
  id: string,
  name: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
): Food => ({
  id,
  name,
  source: 'user',
  per100g: { kcal, protein, carbs, fat },
});

// Values from the wireframes (7b–7e).
const greekYoghurt = food('f-yog', 'Greek yoghurt', 57, 10.0, 3.6, 0.2);
const chicken = food('f-chk', 'Chicken breast, raw', 106, 24.0, 0, 1.2);
const rice = food('f-rice', 'Basmati rice, cooked', 130, 2.7, 28.0, 0.3);
const sweetChilli = food('f-chilli', 'Sweet chilli sauce', 120, 0.8, 28.0, 0.5);

describe('portionMacros', () => {
  it('Greek yoghurt 200 g → 114 kcal, P20.0 C7.2 F0.4', () => {
    expect(portionMacros(greekYoghurt, 200)).toEqual({
      kcal: 114,
      protein: 20.0,
      carbs: 7.2,
      fat: 0.4,
    });
  });

  it('Chicken breast raw 200 g → 212 kcal, P48.0 C0 F2.4', () => {
    expect(portionMacros(chicken, 200)).toEqual({ kcal: 212, protein: 48.0, carbs: 0, fat: 2.4 });
  });

  it('Basmati rice cooked 200 g → 260 kcal, P5.4 C56.0 F0.6', () => {
    expect(portionMacros(rice, 200)).toEqual({ kcal: 260, protein: 5.4, carbs: 56.0, fat: 0.6 });
  });

  it('Sweet chilli sauce 60 g → 72 kcal', () => {
    expect(portionMacros(sweetChilli, 60).kcal).toBe(72);
  });

  it('rounds kcal to whole numbers and macros to 1 dp', () => {
    expect(portionMacros(food('x', 'x', 57, 10.0, 3.6, 0.2), 33)).toEqual({
      kcal: 19, // 18.81
      protein: 3.3,
      carbs: 1.2, // 1.188
      fat: 0.1, // 0.066
    });
  });

  it('returns zeros for 0 g and rejects negative or non-finite grams', () => {
    expect(portionMacros(chicken, 0)).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
    expect(() => portionMacros(chicken, -1)).toThrow(RangeError);
    expect(() => portionMacros(chicken, Number.NaN)).toThrow(RangeError);
  });
});

describe('sumMacros', () => {
  const meal: MealComponent[] = [
    { food: chicken, grams: 200 },
    { food: rice, grams: 200 },
  ];

  it('chicken 200 g + rice 200 g → 472 kcal, P53.4 C56.0 F3.0', () => {
    expect(sumMacros(meal)).toEqual({ kcal: 472, protein: 53.4, carbs: 56.0, fat: 3.0 });
  });

  it('adding sweet chilli 60 g → 544 kcal', () => {
    expect(sumMacros([...meal, { food: sweetChilli, grams: 60 }]).kcal).toBe(544);
  });

  it('sums snapshotted log items and plain macros the same way', () => {
    const items = snapshotComponents(meal);
    expect(sumMacros(items)).toEqual(sumMacros(meal));
    expect(sumMacros(items.map((i) => i.macros))).toEqual(sumMacros(meal));
  });

  it('is zero for an empty meal', () => {
    expect(sumMacros([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('snapshotComponents', () => {
  it('keeps logged macros when the food is edited later', () => {
    const editable = { ...chicken, per100g: { ...chicken.per100g } };
    const items = snapshotComponents([{ food: editable, grams: 200 }]);
    editable.per100g.kcal = 999;
    expect(items[0]).toEqual({
      foodId: 'f-chk',
      foodName: 'Chicken breast, raw',
      grams: 200,
      macros: { kcal: 212, protein: 48.0, carbs: 0, fat: 2.4 },
    });
  });
});

describe('toFood', () => {
  const base = {
    id: 'r1',
    userId: null,
    source: 'open_food_facts' as const,
    barcode: '0000000000000',
    name: 'Test food',
    brand: null,
    kcalPer100g: 100,
    proteinPer100g: 1,
    carbsPer100g: 2,
    fatPer100g: 3,
    fibrePer100g: null,
    sugarPer100g: null,
    saltPer100g: null,
  };

  it('converts a complete record', () => {
    expect(toFood(base)?.per100g).toEqual({
      kcal: 100,
      protein: 1,
      carbs: 2,
      fat: 3,
      fibre: null,
      sugar: null,
      salt: null,
    });
  });

  it('refuses to invent missing macros', () => {
    expect(toFood({ ...base, proteinPer100g: null })).toBeNull();
  });
});

describe('dayProgress', () => {
  const targets: DailyTargets = {
    kcal: 2450,
    protein: 180,
    carbs: 250,
    fat: 75,
    waterMl: 3000,
    steps: 10000,
  };
  const log = (id: string, loggedAt: string, components: MealComponent[]): MealLog => ({
    id,
    userId: 'u1',
    savedMealId: null,
    name: id,
    loggedAt,
    items: snapshotComponents(components),
  });

  const logs = [
    log('lunch', '2026-11-06T12:30:00Z', [
      { food: chicken, grams: 200 },
      { food: rice, grams: 200 },
    ]),
    log('snack', '2026-11-06T16:00:00Z', [{ food: greekYoghurt, grams: 200 }]),
    // 23:30 UTC on 5 Nov is still 5 Nov in London (GMT).
    log('late', '2026-11-05T23:30:00Z', [{ food: sweetChilli, grams: 60 }]),
  ];

  it('sums only logs on the Europe/London day', () => {
    const p = dayProgress({ meals: logs, water: [], steps: 6240 }, targets, '2026-11-06');
    expect(p.eaten).toEqual({ kcal: 586, protein: 73.4, carbs: 63.2, fat: 3.4 });
    expect(p.meals.map((m) => m.id)).toEqual(['lunch', 'snack']);
    expect(p.kcal.remaining).toBe(2450 - 586);
    expect(p.steps.fraction).toBeCloseTo(0.624);
  });

  it('uses the London day during British Summer Time', () => {
    // 23:30 UTC on 30 Jun is 00:30 on 1 Jul in London (BST, UTC+1).
    const summer = [log('midnight', '2026-06-30T23:30:00Z', [{ food: chicken, grams: 100 }])];
    expect(dayProgress({ meals: summer }, targets, '2026-07-01').eaten.kcal).toBe(106);
    expect(dayProgress({ meals: summer }, targets, '2026-06-30').eaten.kcal).toBe(0);
  });

  it('sums water for the day and clamps fractions to 1', () => {
    const water = [
      { id: 'w1', userId: 'u1', ml: 2500, loggedAt: '2026-11-06T09:00:00Z' },
      { id: 'w2', userId: 'u1', ml: 1000, loggedAt: '2026-11-06T15:00:00Z' },
      { id: 'w3', userId: 'u1', ml: 250, loggedAt: '2026-11-07T09:00:00Z' },
    ];
    const p = dayProgress({ meals: [], water }, targets, '2026-11-06');
    expect(p.water).toEqual({ consumed: 3500, target: 3000, fraction: 1, remaining: 0 });
  });
});

describe('roundTo', () => {
  it('rounds half away from zero without float artefacts', () => {
    expect(roundTo(0.35, 1)).toBe(0.4);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(Object.is(roundTo(-0.01, 1), 0)).toBe(true);
  });
});

describe('parity with the log_meal SQL function', () => {
  // The same cases as supabase/tests/05_log_meal.test.sql: the server recomputes these with
  // numeric round() and rejects the log if the client's numbers differ.
  const chicken = { per100g: { kcal: 106, protein: 24, carbs: 0, fat: 1.2 } };
  const rice = { per100g: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 } };
  const noodles = { per100g: { kcal: 360, protein: 6, carbs: 80, fat: 1 } };
  it.each([
    [chicken, 200, { kcal: 212, protein: 48, carbs: 0, fat: 2.4 }],
    [chicken, 45, { kcal: 48, protein: 10.8, carbs: 0, fat: 0.5 }],
    [rice, 150, { kcal: 195, protein: 4.1, carbs: 42, fat: 0.5 }],
    [rice, 50, { kcal: 65, protein: 1.4, carbs: 14, fat: 0.2 }],
    [rice, 180, { kcal: 234, protein: 4.9, carbs: 50.4, fat: 0.5 }],
    [noodles, 70, { kcal: 252, protein: 4.2, carbs: 56, fat: 0.7 }],
  ])('%#: matches the server', (f, grams, expected) => {
    expect(portionMacros(f, grams)).toEqual(expected);
  });

  it('rounds grams to 1 dp like the column', () => {
    expect(roundGrams(60.25)).toBe(60.3);
    expect(roundGrams(0.04)).toBe(0);
  });
});

describe('label entry (7e)', () => {
  it('converts per-serving values to per 100 g, keeping unknowns null', () => {
    expect(per100gFromServing({ kcal: 108, protein: 1.8, carbs: 24, fat: null }, 30)).toEqual({
      kcal: 360,
      protein: 6,
      carbs: 80,
      fat: null,
    });
    expect(per100gFromServing({ kcal: 50 }, 3)).toEqual({ kcal: 1666.67 });
    expect(() => per100gFromServing({ kcal: 1 }, 0)).toThrow(RangeError);
  });

  it('requires every headline value and rejects impossible ones', () => {
    expect(checkPer100g({ kcal: 360, protein: 6, carbs: 80, fat: 1 })).toEqual({});
    expect(checkPer100g({ kcal: null, protein: 6, carbs: 80 })).toEqual({
      kcal: 'missing',
      fat: 'missing',
    });
    expect(checkPer100g({ kcal: 950, protein: -1, carbs: 80, fat: 1 })).toEqual({
      kcal: 'too_high',
      protein: 'negative',
    });
    expect(checkPer100g({ kcal: 500, protein: 40, carbs: 50, fat: 20 })).toEqual({
      total: 'macros_over_100g',
    });
  });

  it('passes pack and serving sizes through toFood', () => {
    const f = toFood({
      id: 'x',
      userId: null,
      source: 'open_food_facts',
      barcode: '0000000000017',
      name: 'Pouch',
      brand: null,
      kcalPer100g: 120,
      proteinPer100g: 0.8,
      carbsPer100g: 28,
      fatPer100g: 0.5,
      fibrePer100g: null,
      sugarPer100g: null,
      saltPer100g: null,
      packGrams: 120,
    });
    expect([f?.packGrams, f?.servingGrams]).toEqual([120, null]);
  });
});
