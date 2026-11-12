import type { DayRange, HealthDailyValue } from '@/lib/backend/health';

/**
 * Whether the HealthKit permission sheet has been shown for our three types. HealthKit never
 * tells an app whether *read* access was denied (that would leak that data exists), so this is
 * all we can know: `never_asked` → we know access isn't granted; `asked` → granted or denied,
 * we can't tell (no data looks the same as denied).
 */
export type RequestStatus = 'never_asked' | 'asked' | 'unknown';

/**
 * Apple Health on this device, read only: step count, sleep analysis and body mass. Behind an
 * interface so jest uses a fake (src/test/fakeHealth.ts) and web/Android have none.
 */
export interface HealthReader {
  requestStatus(): Promise<RequestStatus>;
  /** Show iOS's own Health permission sheet (read only). */
  requestAccess(): Promise<void>;
  /**
   * Daily values for the London days in `range`: steps summed per day, sleep for the night
   * ending that morning (with start and end), the latest weight each day. Days without data are
   * left out (never 0).
   */
  readDays(range: DayRange): Promise<HealthDailyValue[]>;
}
