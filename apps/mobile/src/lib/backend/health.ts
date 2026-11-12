import type { Instant, LocalDate, LocalTime, TrainedDay } from '@life-os/core';
import type { Database } from '../database.types';

type Tables = Database['public']['Tables'];
export type SupplementRow = Tables['supplements']['Row'];
export type HealthDailyRow = Tables['health_daily']['Row'];
export type TrainingDayRow = Tables['training_days']['Row'];

export type SupplementTime = 'morning' | 'evening' | 'any';

/** A supplement on the user's list (Me → Health targets → Supplements, wireframe 7). */
export interface Supplement {
  id: string;
  name: string;
  dose: string | null;
  timeOfDay: SupplementTime;
  /** 24-hour `HH:MM` for a local notification, or null for no reminder. */
  reminderTime: LocalTime | null;
  sortOrder: number;
}

export interface SupplementInput {
  /** null to add a new supplement. */
  id: string | null;
  name: string;
  dose: string | null;
  timeOfDay: SupplementTime;
  reminderTime: LocalTime | null;
  sortOrder: number;
}

/** One "taken" tick: at most one per supplement per London day. */
export interface SupplementLog {
  supplementId: string;
  takenOn: LocalDate;
}

/** The only three things ever read from Apple Health. */
export type HealthKind = 'weight_kg' | 'sleep_min' | 'steps';

/** One synced daily value (health_daily). */
export interface HealthDailyValue {
  day: LocalDate;
  kind: HealthKind;
  value: number;
  /** Sleep only: when the night started and ended. */
  sleepStart?: Instant | null;
  sleepEnd?: Instant | null;
}

export interface DayRange {
  /** First and last London day, both included. */
  start: LocalDate;
  end: LocalDate;
}

const hhmm = (t: string | null): LocalTime | null => (t ? t.slice(0, 5) : null);
const iso = (t: string | null): Instant | null => (t ? new Date(t).toISOString() : null);

export function supplementFromRow(r: SupplementRow): Supplement {
  return {
    id: r.id,
    name: r.name,
    dose: r.dose,
    timeOfDay: (['morning', 'evening'].includes(r.time_of_day)
      ? r.time_of_day
      : 'any') as SupplementTime,
    reminderTime: hhmm(r.reminder_time),
    sortOrder: r.sort_order,
  };
}

export function healthDailyFromRow(r: HealthDailyRow): HealthDailyValue {
  return {
    day: r.day,
    kind: r.kind as HealthKind,
    value: Number(r.value),
    sleepStart: iso(r.sleep_start),
    sleepEnd: iso(r.sleep_end),
  };
}

export function trainingDayFromRow(r: TrainingDayRow): TrainedDay {
  return { trainedOn: r.trained_on, splitDay: r.split_day, splitName: r.split_name };
}

/** Supplements in display order: by sort order, then name. */
export const sortSupplements = (list: readonly Supplement[]): Supplement[] =>
  [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

/** "Creatine 5 g". */
export const supplementLabel = (s: Pick<Supplement, 'name' | 'dose'>): string =>
  s.dose ? `${s.name} ${s.dose}` : s.name;
