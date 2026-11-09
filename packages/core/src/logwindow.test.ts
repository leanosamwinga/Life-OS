import { describe, expect, it } from 'vitest';
import { isInLogWindow, latestTimeOn, logWindow, londonDateTimeToInstant } from './time.ts';
import { formatAmount } from './format.ts';
import { componentUnit, foodUnit, snapshotComponents, toFood } from './nutrition.ts';
import type { Food } from './types.ts';

// Mon 9 Nov 2026, 13:40:25 in London (GMT, so UTC too).
const NOW = '2026-11-09T13:40:25.000Z';

describe('logWindow (7i)', () => {
  it('runs from yesterday 00:00 to an hour from now, to the minute', () => {
    expect(logWindow(NOW)).toEqual({
      today: '2026-11-09',
      yesterday: '2026-11-08',
      earliest: '2026-11-08T00:00:00.000Z',
      latest: '2026-11-09T14:40:00.000Z',
    });
  });

  it('uses London days in summer time', () => {
    const w = logWindow('2026-07-01T23:30:00.000Z'); // 00:30 BST on 2 Jul
    expect(w.today).toBe('2026-07-02');
    expect(w.earliest).toBe('2026-06-30T23:00:00.000Z'); // 1 Jul 00:00 BST
  });

  it('includes both ends and nothing outside', () => {
    expect(isInLogWindow('2026-11-08T00:00:00.000Z', NOW)).toBe(true);
    expect(isInLogWindow('2026-11-07T23:59:00.000Z', NOW)).toBe(false);
    expect(isInLogWindow('2026-11-09T14:40:00.000Z', NOW)).toBe(true);
    expect(isInLogWindow('2026-11-09T14:41:00.000Z', NOW)).toBe(false);
    expect(isInLogWindow(londonDateTimeToInstant('2026-11-08', '21:15'), NOW)).toBe(true);
  });

  it('gives the latest pickable time on each day', () => {
    expect(latestTimeOn('2026-11-09', NOW)).toBe('14:40');
    expect(latestTimeOn('2026-11-08', NOW)).toBe('23:59');
    // 23:30: an hour from now is tomorrow, so all of today can be picked.
    expect(latestTimeOn('2026-11-09', '2026-11-09T23:30:00.000Z')).toBe('23:59');
    expect(latestTimeOn('2026-11-10', NOW)).toBeNull();
  });
});

describe('amount units (-U frames)', () => {
  const shake: Food = {
    id: 'f-shake',
    name: 'Sample protein shake',
    source: 'open_food_facts',
    unit: 'ml',
    per100g: { kcal: 62, protein: 6.1, carbs: 6.6, fat: 1.2 },
  };
  const oats: Food = {
    id: 'f-oats',
    name: 'Test oats',
    source: 'user',
    per100g: { kcal: 389, protein: 13.5, carbs: 66, fat: 6.9 },
  };

  it('formats an amount in its unit', () => {
    expect(formatAmount(330, 'ml')).toBe('330 ml');
    expect(formatAmount(60)).toBe('60 g');
    expect(formatAmount(1200.5, 'ml')).toBe('1,200.5 ml');
  });

  it('defaults to the food’s unit, and older foods are g', () => {
    expect(foodUnit(shake)).toBe('ml');
    expect(foodUnit(oats)).toBe('g');
    expect(componentUnit({ food: shake })).toBe('ml');
    expect(componentUnit({ food: shake, unit: 'g' })).toBe('g');
  });

  it('counts 1 ml as 1 g: switching the unit changes no numbers', () => {
    const [ml] = snapshotComponents([{ food: shake, grams: 330 }]);
    const [g] = snapshotComponents([{ food: shake, grams: 330, unit: 'g' }]);
    expect(ml).toMatchObject({ unit: 'ml', grams: 330 });
    expect(g).toMatchObject({ unit: 'g', grams: 330 });
    expect(ml!.macros).toEqual({ kcal: 205, protein: 20.1, carbs: 21.8, fat: 4 });
    expect(g!.macros).toEqual(ml!.macros);
  });

  it('carries the nutrition unit from a stored record', () => {
    const food = toFood({
      id: 'x',
      userId: null,
      source: 'open_food_facts',
      barcode: '0000000000000',
      name: 'Sample protein shake',
      brand: null,
      kcalPer100g: 62,
      proteinPer100g: 6.1,
      carbsPer100g: 6.6,
      fatPer100g: 1.2,
      fibrePer100g: null,
      sugarPer100g: null,
      saltPer100g: null,
      nutritionUnit: 'ml',
      packGrams: 330,
    });
    expect(food).toMatchObject({ unit: 'ml', packGrams: 330 });
  });
});
