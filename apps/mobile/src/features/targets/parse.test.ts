import {
  macroKcal,
  parseAmount,
  parsePerWeek,
  parsePlanName,
  parseSleepTarget,
  parseSplit,
  parseTargets,
  parseTargetWeight,
  parseTime24,
} from './parse';

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

describe('Health targets (6B)', () => {
  it('weight: 20–400 kg, 1 dp, empty = not set', () => {
    expect(parseTargetWeight('80')).toEqual({ ok: true, value: 80 });
    expect(parseTargetWeight('79.95')).toEqual({ ok: true, value: 80 });
    expect(parseTargetWeight('')).toEqual({ ok: true, value: null });
    expect(parseTargetWeight('12')).toEqual({ ok: false, error: 'Must be 20 kg or more' });
    expect(parseTargetWeight('401').ok).toBe(false);
  });
  it('sleep: hours and minutes', () => {
    expect(parseSleepTarget('7', '30')).toEqual({ ok: true, value: 450 });
    expect(parseSleepTarget('8', '')).toEqual({ ok: true, value: 480 });
    expect(parseSleepTarget('', '')).toEqual({ ok: true, value: null });
    expect(parseSleepTarget('7', '75')).toEqual({ ok: false, error: 'Minutes go up to 59' });
    expect(parseSleepTarget('0', '30')).toEqual({ ok: false, error: 'Between 1 and 24 hours' });
    expect(parseSleepTarget('seven', '').ok).toBe(false);
  });
  it('training per week and the split', () => {
    expect(parsePerWeek('4')).toEqual({ ok: true, value: 4 });
    expect(parsePerWeek('15').ok).toBe(false);
    expect(parsePerWeek('').ok).toBe(false);
    expect(parseSplit([' Legs ', '', 'Back'])).toEqual({ ok: true, value: ['Legs', 'Back'] });
    expect(parseSplit(['x'.repeat(41)]).ok).toBe(false);
  });
  it('24-hour reminder times', () => {
    expect(parseTime24('08:00')).toEqual({ ok: true, value: '08:00' });
    expect(parseTime24('8:05')).toEqual({ ok: true, value: '08:05' });
    expect(parseTime24('2130')).toEqual({ ok: true, value: '21:30' });
    expect(parseTime24('21.30')).toEqual({ ok: true, value: '21:30' });
    expect(parseTime24('24:00').ok).toBe(false);
    expect(parseTime24('8pm').ok).toBe(false);
  });
  it('plan name and macro kcal', () => {
    expect(parsePlanName(' Plan A ')).toEqual({ ok: true, value: 'Plan A' });
    expect(parsePlanName('')).toEqual({ ok: true, value: null });
    expect(macroKcal(180, 250, 75)).toBe(2395);
  });
});
