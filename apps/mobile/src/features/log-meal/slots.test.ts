import type { SavedMeal } from '@life-os/core';
import {
  defaultMealName,
  defaultSlot,
  isValidTime,
  loggedAtFor,
  slotForTime,
  slotOfPlanMeal,
  slotOptions,
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
