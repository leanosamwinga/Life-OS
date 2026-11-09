import { describe, expect, it } from 'vitest';
import {
  ateItAt,
  componentsFromLog,
  snapshotComponents,
  unavailableNote,
  type Food,
  isPickable,
  LOOP_COPIES,
  loopHome,
  loopNearest,
  loopNeedsRecentre,
  loopRows,
  loopValue,
  parseWaterMl,
  pickerDays,
  viewDate,
  waterNewestFirst,
  wheelStep,
} from './index.ts';

// Mon 9 Nov 2026, 13:40 in London (GMT).
const NOW = '2026-11-09T13:40:00.000Z';

describe('7i picker order', () => {
  it('shows Yesterday on the left and Today on the right', () => {
    expect(pickerDays(NOW).map((d) => d.label)).toEqual(['Yesterday', 'Today']);
  });
});

describe('7i looping wheels', () => {
  it('draws each number several times over and rests in the middle copy', () => {
    expect(LOOP_COPIES % 2).toBe(1);
    expect(loopRows(60)).toBe(60 * LOOP_COPIES);
    expect(loopHome(0, 60)).toBe(180);
    expect(loopValue(loopHome(59, 60), 60)).toBe(59);
    expect(loopValue(loopHome(23, 24), 24)).toBe(23);
  });

  it('wraps 59 → 00 → 01 and back, and 23 → 00 → 01 and back', () => {
    const at59 = loopHome(59, 60);
    expect(loopValue(at59 + 1, 60)).toBe(0);
    expect(loopValue(at59 + 2, 60)).toBe(1);
    expect(loopValue(loopHome(0, 60) - 1, 60)).toBe(59);
    const at23 = loopHome(23, 24);
    expect(loopValue(at23 + 1, 24)).toBe(0);
    expect(loopValue(loopHome(0, 24) - 1, 24)).toBe(23);
  });

  it('moves to a number the short way round', () => {
    const at59 = loopHome(59, 60);
    expect(loopNearest(0, at59, 60)).toBe(at59 + 1);
    expect(loopNearest(59, loopHome(0, 60), 60)).toBe(loopHome(0, 60) - 1);
    expect(loopNearest(30, loopHome(30, 60), 60)).toBe(loopHome(30, 60));
    // Never off the ends of the wheel.
    expect(loopNearest(59, 0, 60)).toBe(59);
    expect(loopNearest(0, loopRows(60) - 1, 60)).toBe(loopRows(60) - 60);
  });

  it('moves back to the middle copy only when it has left it', () => {
    expect(loopNeedsRecentre(loopHome(10, 60), 60)).toBe(false);
    expect(loopNeedsRecentre(loopHome(59, 60) + 1, 60)).toBe(true);
    expect(loopNeedsRecentre(loopHome(0, 60) - 1, 60)).toBe(true);
  });

  it('only wraps the number: the day is unchanged and later times stay unpickable', () => {
    // Yesterday 23 → 00 is yesterday 00:00, which is pickable.
    expect(isPickable('2026-11-08', loopValue(loopHome(23, 24) + 1, 24), 0, NOW)).toBe(true);
    // Today: 00 wrapped back to 23 is past the latest (14:40) and still can't be chosen.
    expect(isPickable('2026-11-09', loopValue(loopHome(0, 24) - 1, 24), null, NOW)).toBe(false);
  });

  it('VoiceOver steps stop at the ends rather than wrapping', () => {
    expect(wheelStep(59, 1, 59)).toBeNull();
    expect(wheelStep(0, -1, 59)).toBeNull();
    expect(wheelStep(23, 1, 23)).toBeNull();
    expect(wheelStep(22, 1, 23)).toBe(23);
    expect(wheelStep(1, -1, 59)).toBe(0);
  });
});

describe('"Ate it" time', () => {
  it('logs at the usual time when it has already passed today', () => {
    expect(ateItAt('08:00', NOW)).toBe('2026-11-09T08:00:00.000Z');
    expect(ateItAt('13:40', NOW)).toBe('2026-11-09T13:40:00.000Z');
  });

  it('logs now when the usual time is still to come', () => {
    expect(ateItAt('13:41', NOW)).toBe(NOW);
    expect(ateItAt('19:00', NOW)).toBe(NOW);
  });

  it('logs now with no usual time', () => {
    expect(ateItAt(null, NOW)).toBe(NOW);
    expect(ateItAt(undefined, new Date(NOW))).toBe(NOW);
  });

  it('uses London time across BST and never leaves the window', () => {
    // Fri 3 Jul 2026, 12:00 BST = 11:00 UTC; usual time 08:00 BST = 07:00 UTC.
    expect(ateItAt('08:00', '2026-07-03T11:00:00.000Z')).toBe('2026-07-03T07:00:00.000Z');
    // Just after midnight: 23:00 hasn't happened yet today, so now (inside the window).
    expect(ateItAt('23:00', '2026-11-09T00:05:00.000Z')).toBe('2026-11-09T00:05:00.000Z');
  });
});

describe('water amounts', () => {
  it('accepts whole numbers from 1 to 5,000', () => {
    expect(parseWaterMl('1')).toEqual({ ok: true, ml: 1 });
    expect(parseWaterMl('330')).toEqual({ ok: true, ml: 330 });
    expect(parseWaterMl(' 5000 ')).toEqual({ ok: true, ml: 5000 });
    expect(parseWaterMl('5,000')).toEqual({ ok: true, ml: 5000 });
    expect(parseWaterMl('750 ml')).toEqual({ ok: true, ml: 750 });
  });

  it('refuses 0, over 5,000, decimals and text with a clear message', () => {
    expect(parseWaterMl('0')).toEqual({ ok: false, message: 'Enter at least 1 ml.' });
    expect(parseWaterMl('5001')).toEqual({
      ok: false,
      message: 'That’s more than 5,000 ml. Log up to 5,000 ml at a time.',
    });
    expect(parseWaterMl('5,001').ok).toBe(false);
    expect(parseWaterMl('250.5')).toEqual({
      ok: false,
      message: 'Use a whole number of ml, with no decimals.',
    });
    expect(parseWaterMl('0,5').ok).toBe(false);
    expect(parseWaterMl('lots')).toEqual({
      ok: false,
      message: 'Enter a whole number of ml, like 330.',
    });
    expect(parseWaterMl('-5').ok).toBe(false);
    expect(parseWaterMl('1e3').ok).toBe(false);
    expect(parseWaterMl('')).toEqual({ ok: false, message: 'Enter an amount in ml.' });
  });

  it('lists water newest first', () => {
    const list = waterNewestFirst([
      { id: 'a', loggedAt: '2026-11-09T08:00:00.000Z' },
      { id: 'b', loggedAt: '2026-11-09T12:00:00.000Z' },
    ]);
    expect(list.map((l) => l.id)).toEqual(['b', 'a']);
  });
});

describe('yesterday on Today', () => {
  it('shows only today or yesterday', () => {
    expect(viewDate('today', NOW)).toBe('2026-11-09');
    expect(viewDate('yesterday', NOW)).toBe('2026-11-08');
  });
});

describe('log again and corrected copy', () => {
  const oats: Food = {
    id: 'f-oats',
    name: 'Test oats',
    per100g: { kcal: 389, protein: 13.5, carbs: 66, fat: 6.9 },
  } as Food;
  const shake: Food = {
    id: 'f-shake',
    name: 'Sample shake',
    unit: 'ml',
    per100g: { kcal: 62, protein: 6.1, carbs: 6.6, fat: 1.2 },
  } as Food;
  const items = snapshotComponents([
    { food: oats, grams: 60 },
    { food: shake, grams: 330, unit: 'ml' },
  ]);

  it('keeps amounts and units, and uses the foods as they are now', () => {
    const newer = { ...oats, per100g: { ...oats.per100g, kcal: 400 } };
    const r = componentsFromLog(
      items,
      new Map([
        [oats.id, newer],
        [shake.id, shake],
      ]),
    );
    expect(r.components).toEqual([
      { food: newer, grams: 60, unit: 'g' },
      { food: shake, grams: 330, unit: 'ml' },
    ]);
    expect(r.unavailable).toEqual([]);
  });

  it('lists a deleted food separately so it can be removed', () => {
    const r = componentsFromLog(items, new Map([[oats.id, oats]]));
    expect(r.components).toHaveLength(1);
    expect(r.unavailable).toEqual([{ name: 'Sample shake', grams: 330, unit: 'ml' }]);
    expect(unavailableNote('Sample shake')).toBe(
      'Sample shake is no longer available, so it can’t be added again. Remove it to carry on.',
    );
  });
});
