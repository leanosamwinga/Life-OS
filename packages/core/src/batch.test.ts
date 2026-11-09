import { describe, expect, it } from 'vitest';
import type { Food } from './types.ts';
import {
  COOKED_RATIOS,
  COOKS_AS_OPTIONS,
  batchPer100g,
  batchTotals,
  checkCookedWeight,
  cookedRatio,
  cooksAsLabel,
  estimateCookedWeight,
  explainEstimate,
  guessCooksAs,
  isCooksAs,
  isLiquidBatch,
  roundCookedWeight,
  summariseBatch,
  type BatchIngredient,
} from './batch.ts';
import { portionMacros } from './nutrition.ts';

const food = (id: string, name: string, kcal: number, p: number, c: number, f: number): Food => ({
  id,
  name,
  source: 'user',
  per100g: { kcal, protein: p, carbs: c, fat: f },
});

// The egg fried rice from wireframe 7f (the per-100 g values give the wireframe's rows).
const rice = food('rice', 'Sample rice, dry', 350, 7.0, 78.0, 0.6);
const eggs = food('eggs', 'Test eggs, large', 143, 12.6, 0.7, 9.5);
const peas = food('peas', 'Demo frozen peas', 77, 5.0, 10.0, 0.4);
const oil = food('oil', 'Sample vegetable oil', 900, 0, 0, 100);
const soy = food('soy', 'Example soy sauce', 60, 8.0, 6.0, 0);

const ing = (f: Food, grams: number): BatchIngredient => ({
  food: f,
  grams,
  cooksAs: guessCooksAs(f.name),
});
const eggFriedRice = [ing(rice, 360), ing(eggs, 120), ing(peas, 200), ing(oil, 20), ing(soy, 30)];

describe('the ratio table', () => {
  it('holds only the clear cases, with a reason for each', () => {
    expect(Object.keys(COOKED_RATIOS).sort()).toEqual(
      ['couscous', 'fish', 'lentils', 'meat', 'oats', 'pasta', 'poultry', 'quinoa', 'rice'].sort(),
    );
    for (const r of Object.values(COOKED_RATIOS)) {
      expect(r.why).toBe(r.ratio > 1 ? 'it soaks up water' : 'it loses water');
    }
    expect(COOKS_AS_OPTIONS[0]).toBe('as_added');
    expect(cookedRatio('as_added')).toBe(1);
    expect(cookedRatio('rice')).toBe(2.5);
    expect(cooksAsLabel('rice')).toBe('Dry rice × 2.5');
    expect(cooksAsLabel('poultry')).toBe('Raw poultry × 0.75');
    expect(cooksAsLabel('as_added')).toBe('As added');
    expect(isCooksAs('pasta')).toBe(true);
    expect(isCooksAs('eggs')).toBe(false);
  });
});

describe('guessCooksAs', () => {
  it.each([
    ['Sample rice, dry', 'rice'],
    ['Basmati rice', 'rice'],
    ['Wholewheat penne', 'pasta'],
    ['Spaghetti', 'pasta'],
    ['Porridge oats', 'oats'],
    ['Red lentils', 'lentils'],
    ['Giant couscous', 'couscous'],
    ['Quinoa', 'quinoa'],
    ['Chicken breast, raw', 'poultry'],
    ['Raw beef mince 5% fat', 'meat'],
    ['Salmon fillets (raw)', 'fish'],
  ])('%s → %s', (name, expected) => {
    expect(guessCooksAs(name)).toBe(expected);
  });

  it.each([
    'Basmati rice, cooked',
    'Microwave rice pouch',
    'Egg fried rice',
    'Rice cakes',
    'Oat milk',
    'Fresh egg pasta',
    'Green lentils in water',
    'Tinned lentils',
    'Rice noodles',
    'Chicken breast fillets', // no "raw": could be cooked
    'Roast chicken slices',
    'Smoked salmon, raw',
    'Test eggs, large',
    'Demo frozen peas',
    'Sample vegetable oil',
    'Example soy sauce',
  ])('%s counts as added', (name) => {
    expect(guessCooksAs(name)).toBe('as_added');
  });
});

describe('cooked weight', () => {
  it('rounds estimates to the nearest 10 g; small pots to the gram', () => {
    expect(roundCookedWeight(1008)).toBe(1010);
    expect(roundCookedWeight(1234.9)).toBe(1230);
    expect(roundCookedWeight(1235)).toBe(1240);
    expect(roundCookedWeight(100)).toBe(100);
    expect(roundCookedWeight(54.4)).toBe(54);
    expect(roundCookedWeight(0.3)).toBe(1);
    expect(roundCookedWeight(0)).toBe(0);
  });

  it('estimates Σ grams × ratio: dry rice × 2.5, the rest as added (liquids 1 ml = 1 g)', () => {
    // 360 × 2.5 + 120 + 200 + 20 + 30 ml of soy sauce
    expect(estimateCookedWeight(eggFriedRice)).toBe(1270);
    expect(estimateCookedWeight(eggFriedRice.slice(0, 2))).toBe(1020);
    expect(estimateCookedWeight([])).toBe(0);
  });

  it('a correction changes the estimate: rice marked "as added" counts its own weight', () => {
    const corrected = [
      { ...eggFriedRice[0]!, cooksAs: 'as_added' as const },
      ...eggFriedRice.slice(1),
    ];
    expect(estimateCookedWeight(corrected)).toBe(730);
    const chicken = food('chk', 'Chicken breast, raw', 106, 24, 0, 1.2);
    expect(estimateCookedWeight([ing(chicken, 500)])).toBe(380); // 375 → nearest 10
  });

  it('refuses impossible weights', () => {
    const totals = batchTotals(eggFriedRice);
    expect(checkCookedWeight(totals, 1310)).toBeNull();
    expect(checkCookedWeight(totals, null)).toBe('missing');
    expect(checkCookedWeight(totals, 0)).toBe('missing');
    expect(checkCookedWeight(totals, 300)).toBe('too_light'); // 390.5 g of macros went in
    expect(checkCookedWeight(totals, 50001)).toBe('too_heavy');
  });
});

describe('per 100 g', () => {
  it('whole batch = the ingredients summed like a meal (wireframe 7f)', () => {
    expect(eggFriedRice.map((i) => portionMacros(i.food, i.grams).kcal)).toEqual([
      1260, 172, 154, 180, 18,
    ]);
    expect(batchTotals(eggFriedRice)).toEqual({
      kcal: 1784,
      protein: 52.7,
      carbs: 303.4,
      fat: 34.4,
    });
  });

  it('estimated: totals ÷ 1,270 g × 100, whole kcal and 1 dp macros', () => {
    const s = summariseBatch(eggFriedRice, null);
    expect(s).toMatchObject({ estimatedG: 1270, cookedWeightG: 1270, weighed: false, issue: null });
    expect(s.per100g).toEqual({ kcal: 140, protein: 4.1, carbs: 23.9, fat: 2.7 });
  });

  it('"I weighed it" replaces the estimate (wireframe 7f weighed: 1,310 g → 136 kcal)', () => {
    const s = summariseBatch(eggFriedRice, 1310);
    expect(s).toMatchObject({ estimatedG: 1270, cookedWeightG: 1310, weighed: true });
    expect(s.per100g).toEqual({ kcal: 136, protein: 4.0, carbs: 23.2, fat: 2.6 });
    // and 350 g of it is 7h's "Log it · 476 kcal"
    expect(portionMacros({ per100g: s.per100g! }, 350)).toEqual({
      kcal: 476,
      protein: 14.0,
      carbs: 81.2,
      fat: 9.1,
    });
  });

  it('cook again with one egg fewer: totals and per 100 g recalculate (wireframe 7g)', () => {
    const again = eggFriedRice.map((i) => (i.food.id === 'eggs' ? { ...i, grams: 60 } : i));
    const s = summariseBatch(again, null);
    expect(s.totals).toEqual({ kcal: 1698, protein: 45.2, carbs: 303.0, fat: 28.7 });
    expect(s.estimatedG).toBe(1210);
    expect(s.per100g).toEqual({ kcal: 140, protein: 3.7, carbs: 25.0, fat: 2.4 });
  });

  it('liquids: a soup logged by the gram, 300 g of a 59 kcal per 100 g batch = 177 kcal (7h)', () => {
    expect(
      portionMacros({ per100g: { kcal: 59, protein: 3.7, carbs: 7.8, fat: 1.1 } }, 300),
    ).toEqual({ kcal: 177, protein: 11.1, carbs: 23.4, fat: 3.3 });
    expect(isLiquidBatch('Lentil soup')).toBe(true);
    expect(isLiquidBatch('Chicken stock')).toBe(true);
    expect(isLiquidBatch('Egg fried rice')).toBe(false);
  });

  it('rounds half away from zero, without float artefacts', () => {
    // 1005 kcal over 1000 g = 100.5 → 101; 0.45 g protein per 100 g → 0.5
    expect(batchPer100g({ kcal: 1005, protein: 4.5, carbs: 0.5, fat: 1.05 }, 1000)).toEqual({
      kcal: 101,
      protein: 0.5,
      carbs: 0.1,
      fat: 0.1,
    });
    expect(batchPer100g({ kcal: 100, protein: 1, carbs: 1, fat: 1 }, 300)).toEqual({
      kcal: 33,
      protein: 0.3,
      carbs: 0.3,
      fat: 0.3,
    });
    expect(() => batchPer100g({ kcal: 1, protein: 0, carbs: 0, fat: 0 }, 0)).toThrow(RangeError);
  });

  it('an empty batch or an impossible weight has no per-100 g values (never invented)', () => {
    expect(summariseBatch([], null)).toMatchObject({ issue: 'missing', per100g: null });
    expect(summariseBatch(eggFriedRice, 200)).toMatchObject({ issue: 'too_light', per100g: null });
  });
});

describe('explainEstimate', () => {
  it('says how each ratio was chosen', () => {
    expect(explainEstimate(eggFriedRice)).toBe(
      'dry rice × 2.5 (it soaks up water), the rest as added.',
    );
    const chicken = food('chk', 'Chicken breast, raw', 106, 24, 0, 1.2);
    expect(explainEstimate([ing(chicken, 500), ing(rice, 200)])).toBe(
      'raw poultry × 0.75 (it loses water), dry rice × 2.5 (it soaks up water).',
    );
    expect(explainEstimate([ing(eggs, 120)])).toBe('Everything counts as added.');
  });
});
