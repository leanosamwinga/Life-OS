import {
  londonDateTimeToInstant,
  type Instant,
  type LocalDate,
  type LocalTime,
  type SavedMeal,
} from '@life-os/core';

export const SLOT_NAMES = ['Breakfast', 'Lunch', 'Snack', 'Dinner'] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/** When the meal is being logged for: "Now", or a named slot at a time today. */
export interface MealSlot {
  name: SlotName | 'Now';
  time: LocalTime;
}

export const DEFAULT_SLOT_TIMES: Record<SlotName, LocalTime> = {
  Breakfast: '08:00',
  Lunch: '12:30',
  Snack: '16:00',
  Dinner: '18:15',
};

/** Breakfast before 11:00, lunch before 15:00, snack before 17:30, then dinner. */
export function slotForTime(time: LocalTime): SlotName {
  if (time < '11:00') return 'Breakfast';
  if (time < '15:00') return 'Lunch';
  if (time < '17:30') return 'Snack';
  return 'Dinner';
}

/** "Dinner · salmon & potatoes" → Dinner; otherwise by its usual time. */
export function slotOfPlanMeal(meal: Pick<SavedMeal, 'name' | 'usualTime'>): SlotName {
  const prefix = meal.name.split(' · ')[0]?.trim().toLowerCase();
  const named = SLOT_NAMES.find((s) => s.toLowerCase() === prefix);
  return named ?? slotForTime(meal.usualTime ?? '12:00');
}

/** "Now" plus the four slots, using plan meals' usual times where the user has them. */
export function slotOptions(planMeals: readonly SavedMeal[], now: LocalTime): MealSlot[] {
  const times = { ...DEFAULT_SLOT_TIMES };
  for (const m of [...planMeals].sort((a, b) =>
    (b.usualTime ?? '').localeCompare(a.usualTime ?? ''),
  )) {
    if (m.inDailyPlan && m.usualTime) times[slotOfPlanMeal(m)] = m.usualTime;
  }
  return [{ name: 'Now', time: now }, ...SLOT_NAMES.map((name) => ({ name, time: times[name] }))];
}

/** Default: the first plan meal not yet logged today (e.g. "Snack · 16:00"), else "Now". */
export function defaultSlot(
  planMeals: readonly SavedMeal[],
  loggedPlanIds: ReadonlySet<string>,
  now: LocalTime,
): MealSlot {
  const next = planMeals
    .filter((m) => m.inDailyPlan && m.usualTime && !loggedPlanIds.has(m.id))
    .sort((a, b) => (a.usualTime ?? '').localeCompare(b.usualTime ?? ''))[0];
  return next ? { name: slotOfPlanMeal(next), time: next.usualTime! } : { name: 'Now', time: now };
}

export const slotLabel = (s: MealSlot): string => `${s.name} · ${s.time}`;

/** When a meal logged in this slot happened. "Now" means the moment of logging. */
export function loggedAtFor(slot: MealSlot, date: LocalDate, now: Date): Instant {
  return slot.name === 'Now' ? now.toISOString() : londonDateTimeToInstant(date, slot.time);
}

/** Name for a meal built from scratch when the user didn't type one. */
export const defaultMealName = (slot: MealSlot): string =>
  slot.name === 'Now' ? slotForTime(slot.time) : slot.name;

export const isValidTime = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(t.trim());
