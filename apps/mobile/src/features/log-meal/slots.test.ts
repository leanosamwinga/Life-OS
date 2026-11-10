import type { SavedMeal } from '@life-os/core';
import {
  defaultMealName,
  defaultSlot,
  isValidTime,
  loggedAtFor,
  otherTimeChoice,
  pickerFrom,
  slotForTime,
  slotOfPlanMeal,
  slotOptions,
  timeChip,
  whenChoices,
  whenSheetNote,
} from './slots';

const plan = (id: string, name: string, usualTime: string): SavedMeal => ({
  id,
  userId: 'u',
  name,
  components: [],
  inDailyPlan: true,
  usualTime,
});

const meals = [
  plan('b', 'Breakfast · oats & whey', '07:45'),
  plan('l', 'Lunch · chicken rice bowl', '12:30'),
  plan('s', 'Snack · yoghurt bowl', '16:00'),
  plan('d', 'Salmon & potatoes', '18:45'),
];

describe('meal slots', () => {
  it('maps times and plan-meal names to slots', () => {
    expect(slotForTime('10:59')).toBe('Breakfast');
    expect(slotForTime('13:40')).toBe('Lunch');
    expect(slotForTime('17:29')).toBe('Snack');
    expect(slotForTime('21:00')).toBe('Dinner');
    expect(slotOfPlanMeal(meals[0]!)).toBe('Breakfast');
    expect(slotOfPlanMeal(meals[3]!)).toBe('Dinner');
  });

  it('defaults to the first plan meal not logged yet, else Now', () => {
    expect(defaultSlot(meals, new Set(['b', 'l']), '13:40')).toEqual({
      name: 'Snack',
      time: '16:00',
    });
    expect(defaultSlot(meals, new Set(['b', 'l', 's', 'd']), '20:10')).toEqual({
      name: 'Now',
      time: '20:10',
    });
  });

  it('offers Now and four slots with the user’s plan times', () => {
    expect(slotOptions(meals, '13:40').map((s) => `${s.name} ${s.time}`)).toEqual([
      'Now 13:40',
      'Breakfast 07:45',
      'Lunch 12:30',
      'Snack 16:00',
      'Dinner 18:45',
    ]);
  });

  it('turns a slot into an instant on the London day', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    expect(loggedAtFor({ name: 'Breakfast', time: '08:00' }, '2026-07-01', now)).toBe(
      '2026-07-01T07:00:00.000Z',
    );
    expect(loggedAtFor({ name: 'Now', time: '13:00' }, '2026-07-01', now)).toBe(
      '2026-07-01T12:00:00.000Z',
    );
    expect(defaultMealName({ name: 'Now', time: '19:05' })).toBe('Dinner');
  });

  it('validates HH:MM', () => {
    expect(isValidTime('08:00')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('8:00')).toBe(false);
  });
});

// The wireframes' moment: Mon 9 Nov 2026, 13:40 in London (GMT).
const NOW = new Date('2026-11-09T13:40:00Z');
const TODAY = '2026-11-09';
const plain = [
  plan('l', 'Lunch · chicken rice bowl', '12:30'),
  plan('s', 'Snack · yoghurt bowl', '16:00'),
];

describe('the WHEN choices shared by 7a and 7b-W', () => {
  const now = { name: 'Now', time: '13:40' } as const;

  it('Now first, then the four slots, with plan meals’ usual times and 7a’s labels', () => {
    const c = whenChoices(plain, now, TODAY, NOW);
    expect(c.map((x) => x.label)).toEqual([
      'Now · 13:40',
      'Breakfast 08:00',
      'Lunch 12:30',
      'Snack 16:00',
      'Dinner 18:15',
    ]);
  });

  it('greys slots more than an hour ahead, with the reason for VoiceOver', () => {
    const c = whenChoices(plain, now, TODAY, NOW);
    expect(c.map((x) => x.disabled)).toEqual([false, false, false, true, true]);
    expect(c[3]!.a11yLabel).toBe('Snack 16:00, more than an hour from now');
    expect(c[2]!.a11yLabel).toBe('Lunch 12:30');
    // An hour ahead exactly is still allowed.
    const at1500 = whenChoices(plain, now, TODAY, new Date('2026-11-09T15:00:00Z'));
    expect(at1500[3]!.disabled).toBe(false);
  });

  it('selects Now, a slot, or nothing for a picked time (Other time… is selected then)', () => {
    const sel = (s: Parameters<typeof whenChoices>[1]) =>
      whenChoices(plain, s, TODAY, NOW)
        .filter((x) => x.selected)
        .map((x) => x.slot.name);
    expect(sel(now)).toEqual(['Now']);
    expect(sel({ name: 'Lunch', time: '12:30' })).toEqual(['Lunch']);
    const custom = { name: 'Custom', date: '2026-11-08', time: '21:15' } as const;
    expect(sel(custom)).toEqual([]);
    expect(otherTimeChoice(custom, TODAY)).toEqual({ selected: true, picked: 'Yesterday · 21:15' });
    expect(otherTimeChoice(now, TODAY)).toEqual({ selected: false, picked: null });
  });

  it('7b’s chip has the same label as 7a’s chip for a picked time', () => {
    const custom = { name: 'Custom', date: '2026-11-08', time: '21:15' } as const;
    expect(timeChip(custom, TODAY)).toEqual({
      label: 'Yesterday · 21:15 ▾',
      a11yLabel: 'Time eaten: Yesterday · 21:15. Change',
    });
    expect(timeChip(now, TODAY).label).toBe('Now · 13:40 ▾');
    expect(timeChip({ name: 'Lunch', time: '12:30' }, TODAY).label).toBe('Lunch · 12:30 ▾');
  });

  it('7b-W’s quiet line names greyed slots only when there are some', () => {
    expect(whenSheetNote(whenChoices(plain, now, TODAY, NOW))).toBe(
      'Your meal stays as it is. Later slots are more than an hour away.',
    );
    expect(whenSheetNote(whenChoices(plain, now, TODAY, new Date('2026-11-09T20:00:00Z')))).toBe(
      'Your meal stays as it is.',
    );
  });

  it('7i opens on Today at now from Now or a slot, on the meal’s own day for a picked time', () => {
    expect(pickerFrom(now, NOW)).toEqual({ date: TODAY, time: '13:40' });
    expect(pickerFrom({ name: 'Lunch', time: '12:30' }, NOW)).toEqual({
      date: TODAY,
      time: '13:40',
    });
    expect(pickerFrom({ name: 'Custom', date: '2026-11-08', time: '21:15' }, NOW)).toEqual({
      date: '2026-11-08',
      time: '21:15',
    });
  });
});
