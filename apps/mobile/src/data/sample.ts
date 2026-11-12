/**
 * Obviously fake sample data, shown while the app is not connected to Supabase.
 * Built from @life-os/core types so screens are wired to the real domain model.
 */
import {
  addDays,
  londonDateTimeToInstant,
  makeRotation,
  type TrainedDay,
  snapshotComponents,
  type DailyTargets,
  type Food,
  type LocalDate,
  type MealLog,
  type SavedMeal,
  type WaterLog,
} from '@life-os/core';
import type { CalendarItem } from '@/features/today/timeline';
import type { HealthDailyValue, Supplement, SupplementLog } from '@/lib/backend/health';
import type { HealthTargets } from '@/lib/backend/settings';

const USER = 'sample-user';

const food = (
  id: string,
  name: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
): Food => ({ id, name, source: 'user', per100g: { kcal, protein, carbs, fat } });

export const sampleFoods = {
  oats: food('sample-oats', 'Oats', 375, 11, 60, 8),
  whey: food('sample-whey', 'Whey', 400, 80, 8, 6),
  banana: food('sample-banana', 'Banana', 89, 1.1, 23, 0.3),
  chicken: food('sample-chicken', 'Chicken breast, raw', 106, 24.0, 0, 1.2),
  rice: food('sample-rice', 'Basmati rice, cooked', 130, 2.7, 28.0, 0.3),
  yoghurt: food('sample-yoghurt', 'Greek yoghurt', 57, 10.0, 3.6, 0.2),
  berries: food('sample-berries', 'Berries', 45, 0.8, 9, 0.3),
  salmon: food('sample-salmon', 'Salmon', 208, 20, 0, 13),
  potatoes: food('sample-potatoes', 'Potatoes', 77, 2, 17, 0.1),
};

const f = sampleFoods;

export const sampleTargets: DailyTargets = {
  kcal: 2450,
  protein: 180,
  carbs: 250,
  fat: 75,
  waterMl: 3000,
  steps: 10000,
};

const plan = (
  id: string,
  name: string,
  usualTime: string,
  components: SavedMeal['components'],
): SavedMeal => ({
  id,
  userId: USER,
  name,
  components,
  inDailyPlan: true,
  usualTime,
});

/** Plan A — saved meals flagged as part of the daily plan. */
export const samplePlanMeals: SavedMeal[] = [
  plan('plan-breakfast', 'Breakfast · oats & whey', '08:00', [
    { food: f.oats, grams: 80 },
    { food: f.whey, grams: 30 },
    { food: f.banana, grams: 120 },
  ]),
  plan('plan-lunch', 'Lunch · chicken rice bowl', '12:30', [
    { food: f.chicken, grams: 200 },
    { food: f.rice, grams: 200 },
  ]),
  plan('plan-snack', 'Snack · yoghurt & berries', '16:00', [
    { food: f.yoghurt, grams: 200 },
    { food: f.berries, grams: 80 },
  ]),
  plan('plan-dinner', 'Dinner · salmon & potatoes', '18:15', [
    { food: f.salmon, grams: 180 },
    { food: f.potatoes, grams: 250 },
  ]),
];

/** Sample day: breakfast and lunch already logged from the plan. */
export function sampleMealLogs(date: LocalDate): MealLog[] {
  return samplePlanMeals.slice(0, 2).map((meal) => ({
    id: `log-${meal.id}`,
    userId: USER,
    savedMealId: meal.id,
    name: meal.name,
    loggedAt: londonDateTimeToInstant(date, meal.usualTime ?? '12:00'),
    items: snapshotComponents(meal.components),
  }));
}

export function sampleWaterLogs(date: LocalDate): WaterLog[] {
  const drinks: [string, number][] = [
    ['08:00', 500],
    ['10:00', 500],
    ['12:00', 250],
  ];
  return drinks.map(([time, ml], i) => ({
    id: `water-${i}`,
    userId: USER,
    ml,
    loggedAt: londonDateTimeToInstant(date, time),
  }));
}

export const sampleSteps = 6240;
export const sampleSleepMinutes = 7 * 60 + 12;

export const sampleCalendar: CalendarItem[] = [
  { id: 'ev-standup', time: '09:30', title: 'Team standup', kind: 'event' },
  {
    id: 'ev-review',
    time: '14:00',
    title: 'Design review',
    subtitle: '45 min · Sample Calendar',
    kind: 'event',
  },
  {
    id: 'rh-club',
    time: '19:30',
    title: 'Book club',
    subtitle: 'Weekly rhythm · every Friday',
    kind: 'rhythm',
  },
  {
    id: 'checkin',
    time: '21:30',
    title: 'Evening check-in',
    subtitle: 'Supplements · mood · one line',
    kind: 'checkin',
  },
];

export const sampleRotation = makeRotation(
  ['Arms & shoulders', 'Chest & triceps', 'Legs', 'Back'],
  4,
);
export const sampleCompletedThisCycle = 3;

// ---------------------------------------------------------------------------
// Phase 3 · Health (not connected): fake supplements, training and Apple Health values
// ---------------------------------------------------------------------------

export const sampleHealthTargets: HealthTargets = {
  weightKg: 80,
  sleepMin: 450,
  planName: 'Plan A',
  trainingPerWeek: 4,
  split: sampleRotation.days.map((d) => d.name),
};

export const sampleSupplements: Supplement[] = [
  {
    id: 's-1',
    name: 'Creatine',
    dose: '5 g',
    timeOfDay: 'morning',
    reminderTime: '08:00',
    sortOrder: 0,
  },
  {
    id: 's-2',
    name: 'Vitamin D',
    dose: '25 µg',
    timeOfDay: 'morning',
    reminderTime: null,
    sortOrder: 1,
  },
  {
    id: 's-3',
    name: 'Omega-3',
    dose: '1 g',
    timeOfDay: 'morning',
    reminderTime: null,
    sortOrder: 2,
  },
  {
    id: 's-4',
    name: 'Magnesium',
    dose: '200 mg',
    timeOfDay: 'evening',
    reminderTime: '21:30',
    sortOrder: 3,
  },
];

/** Ticks: the first two every day, the others most days. */
export function sampleSupplementLogs(days: readonly LocalDate[]): SupplementLog[] {
  return days.flatMap((d, i) =>
    sampleSupplements
      .filter((s, j) => j < 2 || (i + j) % 3 !== 0)
      .map((s) => ({ supplementId: s.id, takenOn: d })),
  );
}

/** Two sessions so far this week and four in each week before (Arms, Chest, …). */
export function sampleTraining(today: LocalDate): TrainedDay[] {
  const out: TrainedDay[] = [];
  let split = 0;
  for (let d = 41; d >= 1; d--) {
    if ([1, 3, 4, 6].includes(d % 7)) {
      const day = sampleRotation.days[split % 4]!;
      out.push({ trainedOn: addDays(today, -d), splitDay: day.day, splitName: day.name });
      split++;
    }
  }
  return out;
}

/** Six weeks of synced values: weight trending down, sleep around 7 hours, steps 5–11k. */
export function sampleHealthValues(today: LocalDate): HealthDailyValue[] {
  const out: HealthDailyValue[] = [];
  for (let d = 41; d >= 0; d--) {
    const day = addDays(today, -d);
    out.push({ day, kind: 'weight_kg', value: Math.round((82.4 + d * 0.05) * 10) / 10 });
    out.push({ day, kind: 'steps', value: d === 0 ? sampleSteps : 5200 + ((d * 1370) % 6100) });
    const minutes = d === 0 ? sampleSleepMinutes : 390 + ((d * 17) % 80);
    const start = londonDateTimeToInstant(addDays(day, -1), '23:48');
    out.push({
      day,
      kind: 'sleep_min',
      value: minutes,
      sleepStart: start,
      sleepEnd: new Date(Date.parse(start) + minutes * 60000).toISOString(),
    });
  }
  return out;
}
