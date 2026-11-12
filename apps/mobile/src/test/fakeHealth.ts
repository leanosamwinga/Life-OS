/**
 * jest stand-ins for the device: a fake Apple Health (HealthReader) and a fake local
 * notification scheduler. jest.setup.ts points `@/lib/health/current` and `expo-notifications`
 * here; set a reader with `setHealthReader()` before rendering (the app reads it once).
 */
import type { DayRange, HealthDailyValue } from '@/lib/backend/health';
import type { HealthReader, RequestStatus } from '@/lib/health/reader';

let reader: HealthReader | null = null;

export const getHealthReader = (): HealthReader | null => reader;
export const setHealthReader = (r: HealthReader | null) => {
  reader = r;
};

export interface FakeHealth extends HealthReader {
  status: RequestStatus;
  /** What Apple Health on the phone holds, as daily values. */
  values: HealthDailyValue[];
  calls: string[];
  /** What the next permission sheet does to the status ("asked" whatever the user taps). */
  afterRequest: RequestStatus;
}

export function createFakeHealth(init: Partial<FakeHealth> = {}): FakeHealth {
  const fake: FakeHealth = {
    status: 'asked',
    values: [],
    calls: [],
    afterRequest: 'asked',
    ...init,
    async requestStatus() {
      fake.calls.push('requestStatus');
      return fake.status;
    },
    async requestAccess() {
      fake.calls.push('requestAccess');
      fake.status = fake.afterRequest;
    },
    async readDays(range: DayRange) {
      fake.calls.push(`readDays ${range.start}..${range.end}`);
      return fake.values.filter((v) => v.day >= range.start && v.day <= range.end);
    },
  };
  return fake;
}

// ---------------------------------------------------------------------------
// expo-notifications: a scheduled list tests can inspect
// ---------------------------------------------------------------------------

export interface ScheduledReminder {
  identifier: string;
  content: { title: string; body: string };
  trigger: { type: string; hour: number; minute: number };
}

export const scheduled: ScheduledReminder[] = [];

export const notificationsMock = {
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  async getAllScheduledNotificationsAsync() {
    return scheduled.map((s) => ({ ...s }));
  },
  async cancelScheduledNotificationAsync(id: string) {
    const i = scheduled.findIndex((s) => s.identifier === id);
    if (i !== -1) scheduled.splice(i, 1);
  },
  async scheduleNotificationAsync(req: ScheduledReminder) {
    scheduled.push(req);
    return req.identifier;
  },
  async getPermissionsAsync() {
    return { granted: true };
  },
  async requestPermissionsAsync() {
    return { granted: true };
  },
};
