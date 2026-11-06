import type { NudgeSettings } from './types.ts';

/**
 * Nudges are quiet by default and individually toggleable.
 * Matches the "Me · Nudges" wireframe.
 */
export const DEFAULT_NUDGE_SETTINGS: Readonly<NudgeSettings> = Object.freeze({
  morningBriefing: { enabled: true, weekdayTime: '07:30', weekendTime: '08:30' },
  eveningCheckIn: { enabled: true, time: '21:30' },
  eventReminders: { enabled: false },
  urgentBillAlerts: { enabled: true },
  monthlyStatementImport: { enabled: true, dayOfMonth: 1, time: '09:00' },
  quietHours: { start: '22:30', end: '07:00' },
});

/** Credit line required wherever Open Food Facts data is shown (ODbL). */
export const OPEN_FOOD_FACTS_CREDIT = 'Food data from Open Food Facts (ODbL)';
