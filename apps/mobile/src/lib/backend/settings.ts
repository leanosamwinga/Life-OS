import { DEFAULT_NUDGE_SETTINGS, type DailyTargets, type NudgeSettings } from '@life-os/core';
import type { Database } from '../database.types';

type SettingsRow = Database['public']['Tables']['user_settings']['Row'];
type SettingsUpdate = Database['public']['Tables']['user_settings']['Update'];

/** Daily targets as stored: `null` until the user sets them (never invented). */
export interface Targets {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  waterMl: number | null;
  steps: number | null;
}

export type AppleHealthChoice = 'connect' | 'not_now';
export type ScreenTimeChoice = 'show' | 'not_now';

export type NudgeKey = Exclude<keyof NudgeSettings, 'quietHours'>;
export const NUDGE_KEYS: readonly NudgeKey[] = [
  'morningBriefing',
  'eveningCheckIn',
  'eventReminders',
  'urgentBillAlerts',
  'monthlyStatementImport',
];

export interface UserSettings {
  targets: Targets;
  nudges: NudgeSettings;
  appLockEnabled: boolean;
  appleHealthChoice: AppleHealthChoice | null;
  screenTimeChoice: ScreenTimeChoice | null;
  notificationsPromptedAt: string | null;
  onboardingCompletedAt: string | null;
}

export interface SettingsPatch {
  targets?: Partial<Targets>;
  nudges?: Partial<Record<NudgeKey, boolean>>;
  appLockEnabled?: boolean;
  appleHealthChoice?: AppleHealthChoice | null;
  screenTimeChoice?: ScreenTimeChoice | null;
  notificationsPromptedAt?: string | null;
  onboardingCompletedAt?: string | null;
}

const EMPTY_TARGETS: Targets = {
  kcal: null,
  protein: null,
  carbs: null,
  fat: null,
  waterMl: null,
  steps: null,
};

export function defaultUserSettings(): UserSettings {
  return {
    targets: { ...EMPTY_TARGETS },
    nudges: JSON.parse(JSON.stringify(DEFAULT_NUDGE_SETTINGS)) as NudgeSettings,
    appLockEnabled: false,
    appleHealthChoice: null,
    screenTimeChoice: null,
    notificationsPromptedAt: null,
    onboardingCompletedAt: null,
  };
}

/** Postgres `time` comes back as `HH:MM:SS`; the app uses `HH:MM`. */
const hhmm = (t: string): string => t.slice(0, 5);
const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

export function settingsFromRow(row: SettingsRow): UserSettings {
  return {
    targets: {
      kcal: num(row.target_kcal),
      protein: num(row.target_protein_g),
      carbs: num(row.target_carbs_g),
      fat: num(row.target_fat_g),
      waterMl: num(row.target_water_ml),
      steps: num(row.target_steps),
    },
    nudges: {
      morningBriefing: {
        enabled: row.morning_briefing_enabled,
        weekdayTime: hhmm(row.morning_briefing_weekday_time),
        weekendTime: hhmm(row.morning_briefing_weekend_time),
      },
      eveningCheckIn: {
        enabled: row.evening_checkin_enabled,
        time: hhmm(row.evening_checkin_time),
      },
      eventReminders: { enabled: row.event_reminders_enabled },
      urgentBillAlerts: { enabled: row.urgent_bill_alerts_enabled },
      monthlyStatementImport: {
        enabled: row.statement_import_reminder_enabled,
        dayOfMonth: row.statement_import_day,
        time: hhmm(row.statement_import_time),
      },
      quietHours: { start: hhmm(row.quiet_hours_start), end: hhmm(row.quiet_hours_end) },
    },
    appLockEnabled: row.app_lock_enabled,
    appleHealthChoice: (row.apple_health_choice as AppleHealthChoice | null) ?? null,
    screenTimeChoice: (row.screen_time_choice as ScreenTimeChoice | null) ?? null,
    notificationsPromptedAt: row.notifications_prompted_at,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

const NUDGE_COLUMN: Record<NudgeKey, keyof SettingsUpdate> = {
  morningBriefing: 'morning_briefing_enabled',
  eveningCheckIn: 'evening_checkin_enabled',
  eventReminders: 'event_reminders_enabled',
  urgentBillAlerts: 'urgent_bill_alerts_enabled',
  monthlyStatementImport: 'statement_import_reminder_enabled',
};

const TARGET_COLUMN: Record<keyof Targets, keyof SettingsUpdate> = {
  kcal: 'target_kcal',
  protein: 'target_protein_g',
  carbs: 'target_carbs_g',
  fat: 'target_fat_g',
  waterMl: 'target_water_ml',
  steps: 'target_steps',
};

/** Turn an app-level patch into a `user_settings` update (only the fields given). */
export function rowFromPatch(patch: SettingsPatch): SettingsUpdate {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch.targets ?? {})) {
    row[TARGET_COLUMN[k as keyof Targets]] = v;
  }
  for (const [k, v] of Object.entries(patch.nudges ?? {})) {
    row[NUDGE_COLUMN[k as NudgeKey]] = v;
  }
  if (patch.appLockEnabled !== undefined) row.app_lock_enabled = patch.appLockEnabled;
  if (patch.appleHealthChoice !== undefined) row.apple_health_choice = patch.appleHealthChoice;
  if (patch.screenTimeChoice !== undefined) row.screen_time_choice = patch.screenTimeChoice;
  if (patch.notificationsPromptedAt !== undefined)
    row.notifications_prompted_at = patch.notificationsPromptedAt;
  if (patch.onboardingCompletedAt !== undefined)
    row.onboarding_completed_at = patch.onboardingCompletedAt;
  return row as SettingsUpdate;
}

/** Apply a patch to in-memory settings (optimistic UI and the test backend). */
export function applyPatch(s: UserSettings, patch: SettingsPatch): UserSettings {
  const nudges = { ...s.nudges };
  for (const [k, v] of Object.entries(patch.nudges ?? {})) {
    const key = k as NudgeKey;
    nudges[key] = { ...nudges[key], enabled: Boolean(v) } as never;
  }
  return {
    ...s,
    targets: { ...s.targets, ...patch.targets },
    nudges,
    appLockEnabled: patch.appLockEnabled ?? s.appLockEnabled,
    appleHealthChoice:
      patch.appleHealthChoice !== undefined ? patch.appleHealthChoice : s.appleHealthChoice,
    screenTimeChoice:
      patch.screenTimeChoice !== undefined ? patch.screenTimeChoice : s.screenTimeChoice,
    notificationsPromptedAt:
      patch.notificationsPromptedAt !== undefined
        ? patch.notificationsPromptedAt
        : s.notificationsPromptedAt,
    onboardingCompletedAt:
      patch.onboardingCompletedAt !== undefined
        ? patch.onboardingCompletedAt
        : s.onboardingCompletedAt,
  };
}

/** Targets with unset values as 0, for core maths (rings show "—" for a 0 target). */
export function targetsForProgress(t: Targets): DailyTargets {
  return {
    kcal: t.kcal ?? 0,
    protein: t.protein ?? 0,
    carbs: t.carbs ?? 0,
    fat: t.fat ?? 0,
    waterMl: t.waterMl ?? 0,
    steps: t.steps ?? 0,
  };
}

export const countNudgesOn = (n: NudgeSettings): number =>
  NUDGE_KEYS.filter((k) => n[k].enabled).length;
