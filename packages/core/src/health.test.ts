import { describe, expect, it } from 'vitest';
import {
  adherence,
  averageOfDays,
  daysRange,
  elapsedDays,
  formatAdherence,
  formatKg1,
  formatKgChange,
  formatLitres,
  formatPeriod,
  formatSleep,
  formatSleepWindow,
  hitTarget,
  kcalWithinTarget,
  latestWeightPerDay,
  monthOf,
  sessionsOn,
  shiftPeriod,
  sleepNights,
  sleepWakeDate,
  splitShortName,
  suggestSplitDay,
  trainingTargetFor,
  weekOf,
  weekdayIndex,
  weeklyWeightChange,
  weightChange,
  type TrainedDay,
} from './health.ts';
import { makeRotation } from './training.ts';

describe('London-day periods', () => {
  it('a week runs Monday to Sunday', () => {
    const w = weekOf('2026-11-12'); // Thursday
    expect(w.start).toBe('2026-11-09');
    expect(w.end).toBe('2026-11-15');
    expect(w.days).toHaveLength(7);
    expect(weekOf('2026-11-09').start).toBe('2026-11-09'); // Monday is its own start
    expect(weekOf('2026-11-15').start).toBe('2026-11-09'); // Sunday belongs to the week before
    expect(weekdayIndex('2026-11-09')).toBe(0);
    expect(weekdayIndex('2026-11-15')).toBe(6);
  });

  it('a month is the calendar month, leap years included', () => {
    expect(monthOf('2026-10-17')).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
    expect(monthOf('2028-02-10').days).toHaveLength(29);
    expect(monthOf('2026-02-10').days).toHaveLength(28);
  });

  it('Previous / Next move a whole period, across years', () => {
    expect(shiftPeriod('week', '2026-11-12', -1).start).toBe('2026-11-02');
    expect(shiftPeriod('week', '2026-11-12', 1).start).toBe('2026-11-16');
    expect(shiftPeriod('month', '2026-11-30', -1).start).toBe('2026-10-01');
    expect(shiftPeriod('month', '2026-01-15', -1).start).toBe('2025-12-01');
    expect(shiftPeriod('month', '2026-12-15', 1).start).toBe('2027-01-01');
  });

  it('labels match the wireframes', () => {
    expect(formatPeriod(weekOf('2026-11-05'))).toBe('Mon 2 – Sun 8 Nov');
    expect(formatPeriod(weekOf('2026-10-29'))).toBe('Mon 26 Oct – Sun 1 Nov');
    expect(formatPeriod(monthOf('2026-10-03'))).toBe('October 2026');
  });

  it('the week of the clocks going back still has 7 London days and 169 hours', () => {
    const w = weekOf('2026-10-25'); // BST ends Sun 25 Oct 2026
    expect(w.days).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    const r = daysRange(w.start, w.end);
    expect(r.from).toBe('2026-10-18T23:00:00.000Z'); // Mon 00:00 BST
    expect(r.to).toBe('2026-10-26T00:00:00.000Z'); // next Mon 00:00 GMT
    expect((Date.parse(r.to) - Date.parse(r.from)) / 3_600_000).toBe(169);
  });

  it('"n of N" counts only days that have happened in the current period', () => {
    const w = weekOf('2026-11-12');
    expect(elapsedDays(w, '2026-11-12')).toHaveLength(4); // Mon–Thu
    expect(elapsedDays(shiftPeriod('week', '2026-11-12', -1), '2026-11-12')).toHaveLength(7);
    expect(elapsedDays(shiftPeriod('week', '2026-11-12', 1), '2026-11-12')).toHaveLength(0);
  });
});

describe('averages skip days with no data', () => {
  it('the mean of the days that have a value', () => {
    expect(averageOfDays([2400, null, 2200, undefined])).toBe(2300);
    expect(averageOfDays([0, 10])).toBe(5); // a real 0 is data
    expect(averageOfDays([null, undefined])).toBeNull();
    expect(averageOfDays([])).toBeNull();
  });
});

describe('adherence', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
  it('counts days that met the rule', () => {
    const a = adherence(days, (d) => d !== '2026-11-03');
    expect(a).toEqual({ count: 3, of: 4 });
    expect(formatAdherence(a)).toBe('3 of 4 days');
    expect(formatAdherence({ count: 4, of: 7 }, 'nights')).toBe('4 of 7 nights');
  });
  it('kcal within ±10% of target; water, sleep, steps at or above', () => {
    expect(kcalWithinTarget(2310, 2450)).toBe(true);
    expect(kcalWithinTarget(2205, 2450)).toBe(true); // exactly −10%
    expect(kcalWithinTarget(2200, 2450)).toBe(false);
    expect(kcalWithinTarget(2700, 2450)).toBe(false);
    expect(kcalWithinTarget(0, 2450)).toBe(false); // nothing logged
    expect(kcalWithinTarget(2400, null)).toBe(false);
    expect(hitTarget(3000, 3000)).toBe(true);
    expect(hitTarget(2999, 3000)).toBe(false);
    expect(hitTarget(null, 3000)).toBe(false);
    expect(hitTarget(500, null)).toBe(false);
  });
  it('the training target for a month scales by its days', () => {
    expect(trainingTargetFor(weekOf('2026-11-12'), 4)).toBe(4);
    expect(trainingTargetFor(monthOf('2026-10-01'), 4)).toBe(18);
    expect(trainingTargetFor(monthOf('2026-02-01'), 4)).toBe(16);
  });
});

describe('weight', () => {
  const pts = [
    { day: '2026-11-02', value: 83.0 },
    { day: '2026-11-05', value: 82.8 },
    { day: '2026-11-08', value: 82.6 },
  ];
  it('change over a period is last minus first reading', () => {
    expect(weightChange(pts)).toBe(-0.4);
    expect(weightChange([pts[0]!])).toBeNull();
    expect(weightChange([])).toBeNull();
  });
  it('change this week compares with the latest reading a week earlier', () => {
    expect(weeklyWeightChange(pts, '2026-11-12')).toBe(-0.2); // 82.6 (8th) vs 82.8 (5th)
    expect(weeklyWeightChange(pts, '2026-11-08')).toBeNull(); // nothing on or before 1 Nov
    expect(weeklyWeightChange([{ day: '2026-11-01', value: 80 }], '2026-11-12')).toBeNull();
  });
  it('one reading per London day: the latest', () => {
    expect(
      latestWeightPerDay([
        { at: '2026-11-12T07:00:00Z', kg: 82.44 },
        { at: '2026-11-12T21:00:00Z', kg: 83.06 },
        { at: '2026-07-01T23:30:00Z', kg: 81 }, // 00:30 BST on 2 Jul
      ]),
    ).toEqual([
      { day: '2026-07-02', value: 81 },
      { day: '2026-11-12', value: 83.1 },
    ]);
  });
  it('formats', () => {
    expect(formatKgChange(-0.6)).toBe('−0.6 kg');
    expect(formatKgChange(0.25)).toBe('+0.3 kg');
    expect(formatKgChange(0)).toBe('0.0 kg');
    expect(formatKg1(80)).toBe('80.0 kg');
  });
});

describe('sleep attribution to the wake date', () => {
  it('a night is counted on the morning it ends', () => {
    const nights = sleepNights([
      { start: '2026-11-11T23:48:00Z', end: '2026-11-12T03:00:00Z' },
      { start: '2026-11-12T03:10:00Z', end: '2026-11-12T07:00:00Z' },
    ]);
    expect(nights).toHaveLength(1);
    expect(nights[0]).toMatchObject({ day: '2026-11-12', minutes: 422 });
    expect(formatSleepWindow(nights[0]!.start, nights[0]!.end)).toBe('23:48–07:00');
  });

  it('the part before midnight belongs to the same night', () => {
    expect(sleepWakeDate('2026-11-11T23:59:00Z')).toBe('2026-11-12');
    expect(sleepWakeDate('2026-11-12T17:59:00Z')).toBe('2026-11-12'); // afternoon nap
    expect(sleepWakeDate('2026-11-12T18:00:00Z')).toBe('2026-11-13');
  });

  it('two sources for the same night count once', () => {
    const [n] = sleepNights([
      { start: '2026-11-11T23:00:00Z', end: '2026-11-12T06:00:00Z' },
      { start: '2026-11-11T23:30:00Z', end: '2026-11-12T06:30:00Z' },
    ]);
    expect(n!.minutes).toBe(450);
  });

  it('across the BST → GMT change (Sun 25 Oct 2026) the night is 9 real hours', () => {
    // In bed 23:00 BST Sat (22:00Z), up 07:00 GMT Sun (07:00Z): the clocks went back at 02:00.
    const [n] = sleepNights([{ start: '2026-10-24T22:00:00Z', end: '2026-10-25T07:00:00Z' }]);
    expect(n).toMatchObject({ day: '2026-10-25', minutes: 540 });
    expect(formatSleepWindow(n!.start, n!.end)).toBe('23:00–07:00');
  });

  it('across the GMT → BST change (Sun 29 Mar 2026) the night is 7 real hours', () => {
    // 23:00 GMT Sat (23:00Z) to 07:00 BST Sun (06:00Z).
    const [n] = sleepNights([{ start: '2026-03-28T23:00:00Z', end: '2026-03-29T06:00:00Z' }]);
    expect(n).toMatchObject({ day: '2026-03-29', minutes: 420 });
    // 18:30 BST is 17:30Z: still the next night's.
    expect(sleepWakeDate('2026-03-29T17:30:00Z')).toBe('2026-03-30');
  });

  it('formats durations', () => {
    expect(formatSleep(432)).toBe('7h 12m');
    expect(formatSleep(422)).toBe('7h 02m');
    expect(formatSleep(45)).toBe('45m');
  });
});

describe('the split suggestion', () => {
  const rotation = makeRotation(['Arms & shoulders', 'Chest & triceps', 'Legs', 'Back'], 4);
  const day = (trainedOn: string, splitDay: number | null): TrainedDay => ({
    trainedOn,
    splitDay,
    splitName: splitDay ? rotation.days[splitDay - 1]!.name : null,
  });

  it('starts at Day 1', () => {
    expect(suggestSplitDay(rotation, [], '2026-11-12')).toEqual({
      day: { day: 1, name: 'Arms & shoulders' },
      after: null,
    });
  });

  it('suggests the next day after the last one trained (wireframe: Legs after Chest)', () => {
    const history = [day('2026-11-09', 1), day('2026-11-11', 2)];
    expect(suggestSplitDay(rotation, history, '2026-11-12')).toEqual({
      day: { day: 3, name: 'Legs' },
      after: 'Chest & triceps',
    });
  });

  it('wraps after the last day of the rotation', () => {
    expect(suggestSplitDay(rotation, [day('2026-11-11', 4)], '2026-11-12')!.day.day).toBe(1);
  });

  it('Change: the rotation continues from the day picked', () => {
    // Suggested Legs (Day 3) but the user picked Back (Day 4) today.
    const history = [day('2026-11-11', 2), day('2026-11-12', 4)];
    expect(suggestSplitDay(rotation, history, '2026-11-13')!.day.name).toBe('Arms & shoulders');
    // And picking Arms on a day after Arms suggests Chest next.
    expect(suggestSplitDay(rotation, [day('2026-11-12', 1)], '2026-11-13')!.day.day).toBe(2);
  });

  it('ignores today and later, and days marked without a split', () => {
    const history = [day('2026-11-10', 1), day('2026-11-11', null), day('2026-11-12', 3)];
    expect(suggestSplitDay(rotation, history, '2026-11-12')!.day.day).toBe(2);
  });

  it('no rotation, no suggestion', () => {
    expect(suggestSplitDay(makeRotation([], 4), [], '2026-11-12')).toBeNull();
  });

  it('counts sessions and shortens names for the week strip', () => {
    expect(
      sessionsOn([day('2026-11-09', 1), day('2026-11-02', 2)], weekOf('2026-11-12').days),
    ).toBe(1);
    expect(splitShortName('Arms & shoulders')).toBe('Arms');
    expect(splitShortName('Chest & triceps')).toBe('Chest');
    expect(splitShortName(null)).toBe('');
  });
});

describe('small formats', () => {
  it('litres and steps', () => {
    expect(formatLitres(2600)).toBe('2.6 L');
    expect(formatLitres(3000)).toBe('3.0 L');
  });
});
