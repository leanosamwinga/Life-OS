import { describe, expect, it } from 'vitest';
import {
  clampPick,
  dayLabel,
  deleteSummary,
  isPickable,
  isInLogWindow,
  logWindow,
  moveNote,
  pickedInstant,
  pickedLine,
  pickerDays,
  pickerHint,
  pickerLatest,
  pickerLimitNote,
  pickerStart,
  planBackNote,
  portionFormula,
  packWord,
  toLondonDate,
  unitHint,
  wheelTime,
  wheelValues,
} from './index.ts';

// Wireframes: Mon 9 Nov 2026, 13:40 in London (GMT).
const NOW = '2026-11-09T13:40:00.000Z';

describe('7i Pick a time', () => {
  it('offers Today and Yesterday', () => {
    expect(pickerDays(NOW)).toEqual([
      { label: 'Yesterday', date: '2026-11-08' },
      { label: 'Today', date: '2026-11-09' },
    ]);
  });

  it('allows up to an hour from now today, and all of yesterday', () => {
    expect(pickerLatest('2026-11-09', NOW)).toBe('14:40');
    expect(pickerLatest('2026-11-08', NOW)).toBe('23:59');
    expect(isPickable('2026-11-09', 14, 40, NOW)).toBe(true);
    expect(isPickable('2026-11-09', 14, 41, NOW)).toBe(false);
    expect(isPickable('2026-11-09', 15, null, NOW)).toBe(false);
    expect(isPickable('2026-11-08', 23, 59, NOW)).toBe(true);
  });

  it('holds a later time to the latest (more than an hour ahead)', () => {
    expect(clampPick('2026-11-09', '16:00', NOW)).toEqual({ time: '14:40', clamped: true });
    expect(clampPick('2026-11-09', '06:40', NOW)).toEqual({ time: '06:40', clamped: false });
    expect(pickerLimitNote('14:40').bold).toBe('Latest is 14:40.');
  });

  it('words the choice as the wireframes do', () => {
    expect(pickedLine('2026-11-09', '13:40', NOW)).toBe('Today · Mon 9 Nov · 13:40');
    expect(pickedLine('2026-11-08', '21:15', NOW)).toBe('Yesterday · Sun 8 Nov · 21:15');
    expect(pickerHint('2026-11-09', NOW)).toBe('Any time from yesterday 00:00 up to 14:40.');
    expect(pickerHint('2026-11-08', NOW)).toBe('Counts towards Sun 8 Nov’s totals, not today’s.');
    expect(dayLabel('2026-11-07', NOW)).toBe('Sat 7 Nov');
  });

  it('opens on the meal’s own time, held inside the window', () => {
    expect(pickerStart('2026-11-09T06:40:00.000Z', NOW)).toEqual({
      date: '2026-11-09',
      time: '06:40',
    });
    expect(pickerStart('2026-11-06T06:40:00.000Z', NOW)).toEqual({
      date: '2026-11-08',
      time: '00:00',
    });
  });

  it('builds wheel numbers and times', () => {
    expect(wheelValues(23)).toHaveLength(24);
    expect(wheelValues(59).at(-1)).toBe(59);
    expect(wheelTime(6, 5)).toBe('06:05');
  });
});

describe('day boundaries', () => {
  it('counts a meal at yesterday 23:59 towards yesterday and 00:00 towards today', () => {
    expect(toLondonDate(pickedInstant('2026-11-08', '23:59'))).toBe('2026-11-08');
    expect(toLondonDate(pickedInstant('2026-11-09', '00:00'))).toBe('2026-11-09');
  });

  it('just after midnight, yesterday is the day that just ended and the latest is 01:05', () => {
    const now = '2026-11-09T00:05:00.000Z';
    expect(pickerDays(now)[0]!.date).toBe('2026-11-08');
    expect(pickerLatest('2026-11-09', now)).toBe('01:05');
    expect(isInLogWindow(pickedInstant('2026-11-08', '00:00'), now)).toBe(true);
    expect(isInLogWindow(pickedInstant('2026-11-07', '23:59'), now)).toBe(false);
  });

  it('late in the evening, today’s latest stops at 23:59 (tomorrow isn’t offered)', () => {
    const now = '2026-11-09T23:30:00.000Z';
    expect(pickerLatest('2026-11-09', now)).toBe('23:59');
  });

  it('in summer time, uses London days and an hour from London now', () => {
    const now = '2026-07-01T12:00:00.000Z'; // 13:00 BST
    expect(pickerLatest('2026-07-01', now)).toBe('14:00');
    expect(logWindow(now).earliest).toBe('2026-06-29T23:00:00.000Z'); // 30 Jun 00:00 BST
  });

  it('on the October clock change, the window starts at yesterday 00:00 BST', () => {
    const now = '2026-10-26T09:00:00.000Z'; // Mon 26 Oct 09:00 GMT
    expect(logWindow(now).earliest).toBe('2026-10-24T23:00:00.000Z'); // Sun 25 Oct 00:00 BST
    // 01:30 happens twice on 25 Oct; the second (GMT) one is used and it counts towards 25 Oct.
    expect(pickedInstant('2026-10-25', '01:30')).toBe('2026-10-25T01:30:00.000Z');
    expect(pickedInstant('2026-10-25', '00:30')).toBe('2026-10-24T23:30:00.000Z');
    expect(toLondonDate(pickedInstant('2026-10-25', '01:30'))).toBe('2026-10-25');
  });

  it('on the March clock change, a time that doesn’t exist still lands on the right day', () => {
    const now = '2026-03-30T09:00:00.000Z'; // Mon 30 Mar 10:00 BST
    expect(logWindow(now).earliest).toBe('2026-03-29T00:00:00.000Z'); // Sun 29 Mar 00:00 GMT
    expect(toLondonDate(pickedInstant('2026-03-29', '01:30'))).toBe('2026-03-29');
    expect(pickedInstant('2026-03-29', '00:30')).toBe('2026-03-29T00:30:00.000Z');
    expect(pickedInstant('2026-03-29', '02:30')).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('7k and 7l', () => {
  it('says how a move changes both days (moved to yesterday)', () => {
    expect(
      moveNote({
        from: '2026-11-09',
        to: '2026-11-08',
        kcal: 353,
        fromTotal: 1458,
        today: '2026-11-09',
      }),
    ).toEqual({
      bold: 'Moves to Sun 8 Nov.',
      rest: 'Today goes down by 353 kcal (1,458 → 1,105). Sun 8 Nov goes up by 353 kcal.',
    });
    expect(
      moveNote({
        from: '2026-11-09',
        to: '2026-11-09',
        kcal: 353,
        fromTotal: 1458,
        today: '2026-11-09',
      }),
    ).toBeNull();
    expect(
      moveNote({
        from: '2026-11-08',
        to: '2026-11-09',
        kcal: 100,
        fromTotal: 900,
        today: '2026-11-09',
      })?.rest,
    ).toBe('Sun 8 Nov goes down by 100 kcal (900 → 800). Today goes up by 100 kcal.');
  });

  it('words the delete sheet (ordinary meal)', () => {
    expect(
      deleteSummary({
        name: 'Test oats bowl',
        day: '2026-11-09',
        today: '2026-11-09',
        kcal: 353,
        protein: 32.1,
        dayTotal: 1458,
      }),
    ).toEqual({
      title: 'Delete Test oats bowl?',
      body: 'It comes off Mon 9 Nov. This can’t be undone; you can log it again.',
      nowLabel: 'Today now',
      now: '1,458 kcal',
      down: '353 kcal · P 32.1 g',
      afterLabel: 'Today after',
      after: '1,105 kcal',
    });
  });

  it('words a plan meal coming back (from the plan)', () => {
    expect(planBackNote('Lunch', '12:30')).toEqual({
      bold: 'Lunch goes back on your plan as not eaten.',
      rest: '“Ate it” comes back at 12:30. The plan meal itself isn’t changed.',
    });
  });
});

describe('g or ml', () => {
  it('shows the ≈ line only for the other unit', () => {
    expect(unitHint('ml', 'ml')).toBeNull();
    expect(unitHint('g', 'ml')).toBe('≈ 1 ml counts as 1 g');
  });

  it('writes the formula in the chosen unit and the food’s basis', () => {
    expect(portionFormula(330, 'g', 'ml')).toBe('330 g × per-100 ml values ÷ 100');
    expect(portionFormula(300, 'ml', 'g')).toBe('300 ml × per-100 g values ÷ 100');
    expect(portionFormula(null, 'g', 'g')).toBe('— g × per-100 g values ÷ 100');
  });

  it('calls a drink’s pack a bottle', () => {
    expect(packWord('ml')).toBe('bottle');
    expect(packWord('g')).toBe('pack');
  });
});
