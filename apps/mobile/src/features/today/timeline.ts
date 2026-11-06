import {
  formatGrams,
  formatKcal,
  formatTimeUK,
  sumMacros,
  type LocalTime,
  type Macros,
  type MealLog,
  type SavedMeal,
} from '@life-os/core';

export type TimelineKind = 'meal-eaten' | 'meal-planned' | 'event' | 'rhythm' | 'checkin';

/** Non-meal items on the Today timeline (calendar events, weekly rhythm, check-in). */
export interface CalendarItem {
  id: string;
  time: LocalTime;
  title: string;
  subtitle?: string;
  kind: Extract<TimelineKind, 'event' | 'rhythm' | 'checkin'>;
}

export interface TimelineItem {
  id: string;
  time: LocalTime;
  title: string;
  subtitle?: string;
  kind: TimelineKind;
  /** For planned meals: the saved meal to log with "Ate it". */
  savedMealId?: string;
}

const macroLine = (m: Macros): string =>
  `${formatKcal(m.kcal)} kcal · P ${Math.round(m.protein)} g`;

/**
 * Merge today's meal logs, not-yet-eaten plan meals and calendar items into one
 * time-ordered list. A plan meal disappears once a log references it.
 */
export function buildTimeline(input: {
  mealLogs: readonly MealLog[];
  planMeals: readonly SavedMeal[];
  calendar: readonly CalendarItem[];
}): TimelineItem[] {
  const loggedPlanIds = new Set(input.mealLogs.map((l) => l.savedMealId).filter(Boolean));

  const eaten: TimelineItem[] = input.mealLogs.map((log) => ({
    id: log.id,
    time: formatTimeUK(log.loggedAt),
    title: log.name,
    subtitle: macroLine(sumMacros(log.items)),
    kind: 'meal-eaten',
  }));

  const planned: TimelineItem[] = input.planMeals
    .filter((m) => m.inDailyPlan && m.usualTime && !loggedPlanIds.has(m.id))
    .map((m) => {
      const total = sumMacros(m.components);
      const parts = m.components
        .slice(0, 2)
        .map((c) => `${formatGrams(c.grams)} ${c.food.name.toLowerCase()}`)
        .join(', ');
      return {
        id: `plan-${m.id}`,
        time: m.usualTime as LocalTime,
        title: m.name,
        subtitle: `${formatKcal(total.kcal)} kcal · ${parts}`,
        kind: 'meal-planned' as const,
        savedMealId: m.id,
      };
    });

  return [...eaten, ...planned, ...input.calendar].sort((a, b) => a.time.localeCompare(b.time));
}

/** Index at which the "Now" line should be drawn (before the first item at or after `now`). */
export function nowIndex(items: readonly TimelineItem[], now: LocalTime): number {
  const i = items.findIndex((item) => item.time >= now);
  return i === -1 ? items.length : i;
}
