import { createContext, useContext, type ReactNode } from 'react';
import {
  dayEnd,
  editableDays,
  londonDateTimeToInstant,
  logWindow,
  sumMacros,
  toLondonDate,
  type LocalDate,
  type MealLog,
} from '@life-os/core';
import { useAsync } from '@/features/data/useAsync';
import type { RosterMeal } from '@/lib/backend/foods';
import { useSession } from '@/lib/session';

interface Data {
  logs: MealLog[];
  roster: RosterMeal[];
}

export interface LoggedMealValue {
  status: 'loading' | 'ready' | 'error' | 'consent-off';
  error: string | null;
  today: LocalDate;
  logs: MealLog[];
  roster: RosterMeal[];
  /** A day's kcal from the logs loaded (yesterday and today). */
  dayKcal(date: LocalDate): number;
  reload(): void;
}

const Ctx = createContext<LoggedMealValue | null>(null);

export function useLoggedMeals(): LoggedMealValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLoggedMeals() must be used inside the meal layout');
  return v;
}

/**
 * Logged meals that can be opened, edited and deleted (7j–7l): yesterday's and today's, the
 * same window log_meal and update_logged_meal allow. Reloads when data changes.
 */
export function LoggedMealProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const backend = session.backend;
  const consentOff = session.status === 'signedIn' && !session.healthConsent;
  const enabled = session.status === 'signedIn' && !consentOff && backend;
  const now = new Date();
  const [yesterday, today] = editableDays(now) as [LocalDate, LocalDate];

  const state = useAsync<Data>(
    enabled
      ? async () => {
          const [logs, roster] = await Promise.all([
            backend.listMealLogs({
              from: londonDateTimeToInstant(yesterday, '00:00'),
              to: dayEnd(today),
            }),
            backend.listSavedMeals(),
          ]);
          return { logs, roster };
        }
      : null,
    [enabled, backend, today, session.dataVersion],
  );
  const logs = state.data?.logs ?? [];

  const value: LoggedMealValue = {
    status: consentOff
      ? 'consent-off'
      : state.data
        ? 'ready'
        : state.status === 'error'
          ? 'error'
          : 'loading',
    error: state.error,
    today,
    logs,
    roster: state.data?.roster ?? [],
    dayKcal: (date) =>
      sumMacros(logs.filter((l) => toLondonDate(l.loggedAt) === date).flatMap((l) => l.items)).kcal,
    reload: () => session.notifyDataChanged(),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Whether a logged meal can still be changed (from yesterday 00:00 on). */
export const isChangeable = (log: MealLog, now: Date) =>
  Date.parse(log.loggedAt) >= Date.parse(logWindow(now).earliest);
