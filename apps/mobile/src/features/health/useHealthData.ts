import {
  addDays,
  daysRange,
  type LocalDate,
  type MealLog,
  type Period,
  type TrainedDay,
  type WaterLog,
} from '@life-os/core';
import type { HealthDailyValue, HealthKind, Supplement, SupplementLog } from '@/lib/backend/health';
import { useSession } from '@/lib/session';
import { useAsync } from '@/features/data/useAsync';

/** How far back the Day view looks: the 14-day weight line and its weekly change, 7-day sleep. */
export const DAY_LOOKBACK = 20;
/** Trained days loaded to find the last split day before today. */
export const TRAINING_LOOKBACK = 90;

export interface HealthDayData {
  supplements: Supplement[];
  /** Today's ticks. */
  taken: SupplementLog[];
  /** Trained days from TRAINING_LOOKBACK days ago to today. */
  training: TrainedDay[];
  /** Synced Apple Health values from DAY_LOOKBACK days ago to today. */
  values: HealthDailyValue[];
}

const EMPTY_DAY: HealthDayData = { supplements: [], taken: [], training: [], values: [] };

export interface UseHealth<T> {
  live: boolean;
  consentOff: boolean;
  loading: boolean;
  error: string | null;
  data: T;
}

/** Health data for the Day view (supplements, ticks, training, Apple Health values). */
export function useHealthDay(today: LocalDate): UseHealth<HealthDayData> {
  const session = useSession();
  const live = session.status === 'signedIn';
  const consentOff = live && !session.healthConsent;
  const backend = session.backend;
  const state = useAsync<HealthDayData>(
    live && !consentOff && backend
      ? async () => {
          const [supplements, taken, training, values] = await Promise.all([
            backend.listSupplements(),
            backend.listSupplementLogs({ start: today, end: today }),
            backend.listTrainingDays({ start: addDays(today, -TRAINING_LOOKBACK), end: today }),
            backend.listHealthDaily({ start: addDays(today, -DAY_LOOKBACK), end: today }),
          ]);
          return { supplements, taken, training, values };
        }
      : null,
    [live, consentOff, backend, today, session.dataVersion],
  );
  return {
    live,
    consentOff,
    loading: live && !consentOff && state.data === null && state.status === 'loading',
    error: state.error,
    data: consentOff ? EMPTY_DAY : (state.data ?? EMPTY_DAY),
  };
}

export interface HealthPeriodData {
  meals: MealLog[];
  water: WaterLog[];
  supplements: Supplement[];
  taken: SupplementLog[];
  training: TrainedDay[];
  values: HealthDailyValue[];
}

const EMPTY_PERIOD: HealthPeriodData = {
  meals: [],
  water: [],
  supplements: [],
  taken: [],
  training: [],
  values: [],
};

/** Everything a Week or Month view averages over. */
export function useHealthPeriod(period: Period): UseHealth<HealthPeriodData> {
  const session = useSession();
  const live = session.status === 'signedIn';
  const consentOff = live && !session.healthConsent;
  const backend = session.backend;
  const state = useAsync<HealthPeriodData>(
    live && !consentOff && backend
      ? async () => {
          const days = { start: period.start, end: period.end };
          const range = daysRange(period.start, period.end);
          const [meals, water, supplements, taken, training, values] = await Promise.all([
            backend.listMealLogs(range),
            backend.listWaterLogs(range),
            backend.listSupplements(),
            backend.listSupplementLogs(days),
            backend.listTrainingDays(days),
            backend.listHealthDaily(days),
          ]);
          return { meals, water, supplements, taken, training, values };
        }
      : null,
    [live, consentOff, backend, period.start, period.end, session.dataVersion],
  );
  return {
    live,
    consentOff,
    loading: live && !consentOff && state.data === null && state.status === 'loading',
    error: state.error,
    data: consentOff ? EMPTY_PERIOD : (state.data ?? EMPTY_PERIOD),
  };
}

/** The values of one kind by day. */
export function valuesOf(values: readonly HealthDailyValue[], kind: HealthKind) {
  return values
    .filter((v) => v.kind === kind)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((v) => ({ day: v.day, value: v.value, start: v.sleepStart, end: v.sleepEnd }));
}
