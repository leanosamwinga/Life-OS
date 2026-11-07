import { parseAmount, parseTargets } from './parse';

describe('target parsing', () => {
  it('treats empty as not set and accepts thousands separators', () => {
    expect(parseAmount('', { max: 20000, decimals: 0 })).toEqual({ ok: true, value: null });
    expect(parseAmount('2,450', { max: 20000, decimals: 0 })).toEqual({ ok: true, value: 2450 });
    expect(parseAmount('180.25', { max: 2000, decimals: 1 })).toEqual({ ok: true, value: 180.3 });
  });

  it('rejects text, negatives and values over the limit', () => {
    expect(parseAmount('lots', { max: 100, decimals: 0 }).ok).toBe(false);
    expect(parseAmount('-5', { max: 100, decimals: 0 }).ok).toBe(false);
    expect(parseAmount('20001', { max: 20000, decimals: 0 })).toEqual({
      ok: false,
      error: 'Must be 20,000 or less',
    });
  });

  it('parses a full form and reports every bad field', () => {
    const ok = parseTargets({
      kcal: '2450',
      protein: '180',
      carbs: '250',
      fat: '75',
      waterMl: '3000',
      steps: '',
    });
    expect(ok).toEqual({
      ok: true,
      targets: { kcal: 2450, protein: 180, carbs: 250, fat: 75, waterMl: 3000, steps: null },
    });
    const bad = parseTargets({
      kcal: 'x',
      protein: '',
      carbs: '',
      fat: '',
      waterMl: '99999',
      steps: '',
    });
    expect(bad).toEqual({
      ok: false,
      errors: { kcal: 'Enter a number', waterMl: 'Must be 20,000 or less' },
    });
  });
});
