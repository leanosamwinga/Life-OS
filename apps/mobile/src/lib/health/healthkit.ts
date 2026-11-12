import {
  getRequestStatusForAuthorization,
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  queryStatisticsCollectionForQuantity,
  requestAuthorization,
} from '@kingstinct/react-native-healthkit';
import {
  addDays,
  latestWeightPerDay,
  londonDateTimeToInstant,
  sleepNights,
  toLondonDate,
  SLEEP_DAY_CUTOFF,
} from '@life-os/core';
import type { DayRange, HealthDailyValue } from '@/lib/backend/health';
import type { HealthReader, RequestStatus } from './reader';

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
const WEIGHT = 'HKQuantityTypeIdentifierBodyMass' as const;
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis' as const;

/** Read only, these three and nothing else. Life OS never writes to Apple Health. */
const READ = { toRead: [STEPS, SLEEP, WEIGHT] } as const;

/** HKCategoryValueSleepAnalysis: asleep (unspecified), core, deep, REM. Not in bed (0), awake (2). */
const ASLEEP = new Set([1, 3, 4, 5]);

/** The HealthKit module, or null when HealthKit isn't on this device (iPad, simulator without it). */
export function createHealthKitReader(): HealthReader | null {
  if (!isHealthDataAvailable()) return null;
  return {
    async requestStatus(): Promise<RequestStatus> {
      // AuthorizationRequestStatus: 0 unknown, 1 shouldRequest, 2 unnecessary.
      const s = Number(await getRequestStatusForAuthorization(READ));
      return s === 1 ? 'never_asked' : s === 2 ? 'asked' : 'unknown';
    },
    async requestAccess() {
      await requestAuthorization(READ);
    },
    async readDays({ start, end }: DayRange): Promise<HealthDailyValue[]> {
      const from = new Date(londonDateTimeToInstant(start, '00:00'));
      const to = new Date(londonDateTimeToInstant(addDays(end, 1), '00:00'));
      const inRange = (d: string) => d >= start && d <= end;
      const out: HealthDailyValue[] = [];

      // Steps: one bucket per day from London midnight (HealthKit de-duplicates sources).
      const buckets = await queryStatisticsCollectionForQuantity(
        STEPS,
        ['cumulativeSum'],
        from,
        { day: 1 },
        { filter: { date: { startDate: from, endDate: to } }, unit: 'count' },
      );
      for (const b of buckets) {
        const steps = b.sumQuantity?.quantity;
        if (!b.startDate || steps == null) continue;
        const day = toLondonDate(b.startDate);
        if (inRange(day)) out.push({ day, kind: 'steps', value: Math.round(steps) });
      }

      // Sleep: asleep stages from 18:00 the evening before the first day, grouped by wake date.
      const sleepFrom = new Date(londonDateTimeToInstant(addDays(start, -1), SLEEP_DAY_CUTOFF));
      const sleepTo = new Date(londonDateTimeToInstant(end, SLEEP_DAY_CUTOFF));
      const sleep = await queryCategorySamples(SLEEP, {
        limit: 0,
        ascending: true,
        filter: { date: { startDate: sleepFrom, endDate: sleepTo } },
      });
      const asleep = sleep
        .filter((s) => ASLEEP.has(Number(s.value)))
        .map((s) => ({ start: s.startDate.toISOString(), end: s.endDate.toISOString() }));
      for (const n of sleepNights(asleep)) {
        if (inRange(n.day) && n.minutes > 0)
          out.push({
            day: n.day,
            kind: 'sleep_min',
            value: Math.min(1440, n.minutes),
            sleepStart: n.start,
            sleepEnd: n.end,
          });
      }

      // Weight: the latest reading each day, in kg.
      const weights = await queryQuantitySamples(WEIGHT, {
        limit: 0,
        ascending: true,
        unit: 'kg',
        filter: { date: { startDate: from, endDate: to } },
      });
      for (const w of latestWeightPerDay(
        weights.map((s) => ({ at: s.endDate.toISOString(), kg: s.quantity })),
      )) {
        if (inRange(w.day) && w.value >= 20 && w.value <= 400)
          out.push({ day: w.day, kind: 'weight_kg', value: w.value });
      }
      return out;
    },
  };
}
