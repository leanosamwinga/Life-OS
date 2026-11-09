import {
  addDays,
  dayProgress,
  londonDateTimeToInstant,
  type DayProgress,
  type LocalDate,
  type MealLog,
  type WaterLog,
} from '@life-os/core';
import type { RosterMeal } from '@/lib/backend/foods';
import { targetsForProgress } from '@/lib/backend/settings';
import { useSession } from '@/lib/session';
import { useAsync } from './useAsync';

export interface DayData {
  meals: MealLog[];
  water: WaterLog[];
  roster: RosterMeal[];
}

/** Bounds of a Europe/London calendar day as UTC instants. */
export const londonDayRange = (date: LocalDate) => ({
  from: londonDateTimeToInstant(date, '00:00'),
  to: londonDateTimeToInstant(addDays(date, 1), '00:00'),
});

export interface UseDay {
  /** `false` when signed out/disconnected (callers show sample data). */
  live: boolean;
  /** Signed in without health-data consent: nothing health-related is loaded. */
  consentOff: boolean;
  loading: boolean;
  error: string | null;
  data: DayData;
  progress: DayProgress;
  targetsSet: boolean;
}

const EMPTY: DayData = { meals: [], water: [], roster: [] };

/**
 * A day's meals, water and roster for the signed-in user, reloaded when data changes. Meals in
 * `hiddenMealIds` (a delete waiting on "Undo") are left out of the meals and the totals.
 */
export function useDay(date: LocalDate, hiddenMealIds: readonly string[] = []): UseDay {
  const session = useSession();
  const live = session.status === 'signedIn';
  const consentOff = live && !session.healthConsent;
  const backend = session.backend;
  const state = useAsync<DayData>(
    live && !consentOff && backend
      ? async () => {
          const range = londonDayRange(date);
          const [meals, water, roster] = await Promise.all([
            backend.listMealLogs(range),
            backend.listWaterLogs(range),
            backend.listSavedMeals(),
          ]);
          return { meals, water, roster };
        }
      : null,
    [live, consentOff, backend, date, session.dataVersion],
  );
  const loaded = consentOff ? EMPTY : (state.data ?? EMPTY);
  const data = hiddenMealIds.length
    ? { ...loaded, meals: loaded.meals.filter((m) => !hiddenMealIds.includes(m.id)) }
    : loaded;
  const targets = session.settings?.targets;
  return {
    live,
    consentOff,
    loading: live && !consentOff && state.status === 'loading' && state.data === null,
    error: state.error,
    data,
    progress: dayProgress(
      { meals: data.meals, water: data.water },
      targetsForProgress(
        targets ?? {
          kcal: null,
          protein: null,
          carbs: null,
          fat: null,
          waterMl: null,
          steps: null,
        },
      ),
      date,
    ),
    targetsSet: Boolean(targets && Object.values(targets).some((v) => v != null)),
  };
}
