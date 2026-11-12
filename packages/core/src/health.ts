// Phase 3 · Health maths: London-day periods, averages, adherence, weight trends, the split
// suggestion and sleep attribution. Pure functions, no I/O (shared by the app and tests).
import type { Instant, LocalDate, SplitDay, SplitRotation } from './types.ts';
import { MINUS, formatCount } from './format.ts';
import { roundTo } from './nutrition.ts';
import { addDays, londonDateTimeToInstant, toLondonDate, toLondonTime } from './time.ts';
import { nextSplitDay } from './training.ts';

// ---------------------------------------------------------------------------
// Periods (Europe/London calendar days)
// ---------------------------------------------------------------------------

export type PeriodKind = 'week' | 'month';

export interface Period {
  kind: PeriodKind;
  /** First and last London day, both included. */
  start: LocalDate;
  end: LocalDate;
  /** Every day from start to end, in order. */
  days: LocalDate[];
}

const parts = (d: LocalDate) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return { y, m, day };
};
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 0 = Monday … 6 = Sunday, from the calendar date itself. */
export function weekdayIndex(date: LocalDate): number {
  const { y, m, day } = parts(date);
  return (new Date(Date.UTC(y, m - 1, day, 12)).getUTCDay() + 6) % 7;
}

function daysBetween(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The Monday–Sunday week containing `date`. */
export function weekOf(date: LocalDate): Period {
  const start = addDays(date, -weekdayIndex(date));
  const end = addDays(start, 6);
  return { kind: 'week', start, end, days: daysBetween(start, end) };
}

/** The calendar month containing `date`. */
export function monthOf(date: LocalDate): Period {
  const { y, m } = parts(date);
  const start = `${y}-${pad2(m)}-01`;
  const last = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  const end = `${y}-${pad2(m)}-${pad2(last)}`;
  return { kind: 'month', start, end, days: daysBetween(start, end) };
}

export const periodOf = (kind: PeriodKind, date: LocalDate): Period =>
  kind === 'week' ? weekOf(date) : monthOf(date);

/** The period `steps` periods before (negative) or after (positive) the one containing `date`. */
export function shiftPeriod(kind: PeriodKind, date: LocalDate, steps: number): Period {
  if (kind === 'week') return weekOf(addDays(weekOf(date).start, steps * 7));
  const { y, m } = parts(date);
  const t = new Date(Date.UTC(y, m - 1 + steps, 1, 12));
  return monthOf(`${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-01`);
}

/**
 * The days of a period that count towards "n of N days": every day of a past period; up to and
 * including today for the current one; none for a future one.
 */
export function elapsedDays(period: Period, today: LocalDate): LocalDate[] {
  return period.days.filter((d) => d <= today);
}

/** London-midnight bounds of a run of days, as UTC instants (end exclusive). */
export function daysRange(start: LocalDate, end: LocalDate): { from: Instant; to: Instant } {
  return {
    from: londonDateTimeToInstant(start, '00:00'),
    to: londonDateTimeToInstant(addDays(end, 1), '00:00'),
  };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const SHORT_MONTHS = MONTH_NAMES.map((n) => n.slice(0, 3));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const weekdayShort = (date: LocalDate): string => WEEKDAYS[weekdayIndex(date)]!;

/** "Mon 2 – Sun 8 Nov", "Mon 27 Oct – Sun 2 Nov", "October 2026". */
export function formatPeriod(p: Period): string {
  const s = parts(p.start);
  const e = parts(p.end);
  if (p.kind === 'month') return `${MONTH_NAMES[s.m - 1]} ${s.y}`;
  const startMonth = s.m === e.m ? '' : ` ${SHORT_MONTHS[s.m - 1]}`;
  return `Mon ${s.day}${startMonth} – Sun ${e.day} ${SHORT_MONTHS[e.m - 1]}`;
}

export const monthName = (p: Period): string => MONTH_NAMES[parts(p.start).m - 1]!;

// ---------------------------------------------------------------------------
// Averages and adherence
// ---------------------------------------------------------------------------

/**
 * "Average" everywhere on Health means the mean over the days that **have data**: days with no
 * value (`null`/`undefined` — nothing logged, nothing synced) are skipped, not counted as 0, so
 * a missed sync or a day without the watch doesn't drag the average down. Returns `null` when no
 * day has data (the card shows "—").
 */
export function averageOfDays(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

export interface Adherence {
  /** Days that met the rule. */
  count: number;
  /** Days that could have (the elapsed days of the period). */
  of: number;
}

/** "n of N days": how many of `days` satisfy `met`. */
export function adherence(days: readonly LocalDate[], met: (day: LocalDate) => boolean): Adherence {
  return { count: days.filter(met).length, of: days.length };
}

/** "5 of 7 days", "4 of 7 nights", "15 of 18 sessions". */
export const formatAdherence = (a: Adherence, unit = 'days'): string =>
  `${a.count} of ${a.of} ${unit}`;

/** Calories count as "within target" on a day within ±10% of the target (and with food logged). */
export const KCAL_TOLERANCE = 0.1;

export function kcalWithinTarget(kcal: number | null | undefined, target: number | null): boolean {
  if (kcal == null || !target || kcal <= 0) return false;
  return Math.abs(kcal - target) <= target * KCAL_TOLERANCE;
}

/** Water, sleep and steps "hit" their target on a day at or above it. */
export function hitTarget(value: number | null | undefined, target: number | null): boolean {
  return value != null && target != null && target > 0 && value >= target;
}

/**
 * The training target for a period: sessions per week for a week; for a month, per week ×
 * days ÷ 7, rounded (4 a week in a 31-day month → 18).
 */
export function trainingTargetFor(period: Period, perWeek: number): number {
  return period.kind === 'week' ? perWeek : Math.round((perWeek * period.days.length) / 7);
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export interface DayValue {
  day: LocalDate;
  value: number;
}

const byDay = (a: DayValue, b: DayValue) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

/** Last weight in the period minus the first (days with a reading), 1 dp; null with < 2. */
export function weightChange(points: readonly DayValue[]): number | null {
  const sorted = [...points].sort(byDay);
  if (sorted.length < 2) return null;
  return roundTo(sorted[sorted.length - 1]!.value - sorted[0]!.value, 1);
}

/**
 * Day view "−0.6 kg this week": the latest reading on or before `date` minus the latest reading
 * on or before seven days earlier. Null when either is missing.
 */
export function weeklyWeightChange(points: readonly DayValue[], date: LocalDate): number | null {
  const sorted = [...points].sort(byDay);
  const latestOnOrBefore = (d: LocalDate) => [...sorted].reverse().find((p) => p.day <= d) ?? null;
  const now = latestOnOrBefore(date);
  const before = latestOnOrBefore(addDays(date, -7));
  if (!now || !before || now.day === before.day) return null;
  return roundTo(now.value - before.value, 1);
}

/** "−0.6 kg", "+0.3 kg", "0.0 kg" (U+2212 minus). */
export function formatKgChange(kg: number): string {
  const v = roundTo(kg, 1);
  const text = Math.abs(v).toFixed(1);
  return v < 0 ? `${MINUS}${text} kg` : v > 0 ? `+${text} kg` : `${text} kg`;
}

/** Body weight to one decimal place, always: "80.0 kg". */
export const formatKg1 = (kg: number): string => `${roundTo(kg, 1).toFixed(1)} kg`;

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

/** "7h 12m", "6h 05m", "45m". */
export function formatSleep(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** "23:48–07:00" in London time. */
export const formatSleepWindow = (start: Instant, end: Instant): string =>
  `${toLondonTime(start)}–${toLondonTime(end)}`;

export interface SleepInterval {
  start: Instant;
  end: Instant;
}

export interface SleepNight {
  /** The London date the night ends on (the wake date). */
  day: LocalDate;
  /** Time asleep in whole minutes: overlapping intervals (two sources) count once. */
  minutes: number;
  start: Instant;
  end: Instant;
}

/** Sleep ending at or after this London time counts towards the next day's night. */
export const SLEEP_DAY_CUTOFF = '18:00';

/**
 * The wake date a sleep interval belongs to: the London date of its end, or the next date when
 * it ends at or after 18:00 (an evening doze before bed belongs to that night, which ends the
 * next morning). Uses London wall-clock time, so it holds across the BST/GMT change.
 */
export function sleepWakeDate(end: Instant): LocalDate {
  const date = toLondonDate(end);
  return toLondonTime(end) >= SLEEP_DAY_CUTOFF ? addDays(date, 1) : date;
}

/**
 * Group asleep intervals (HealthKit's asleep stages; never "in bed" or "awake") into nights by
 * wake date. Minutes are the union of the intervals, so a watch and a phone recording the same
 * night count it once; start and end are the earliest start and latest end.
 */
export function sleepNights(intervals: readonly SleepInterval[]): SleepNight[] {
  const groups = new Map<LocalDate, { s: number; e: number }[]>();
  for (const i of intervals) {
    const s = Date.parse(i.start);
    const e = Date.parse(i.end);
    if (!(e > s)) continue;
    const day = sleepWakeDate(i.end);
    groups.set(day, [...(groups.get(day) ?? []), { s, e }]);
  }
  const nights: SleepNight[] = [];
  for (const [day, list] of groups) {
    list.sort((a, b) => a.s - b.s);
    let total = 0;
    let curS = list[0]!.s;
    let curE = list[0]!.e;
    for (const r of list.slice(1)) {
      if (r.s <= curE) curE = Math.max(curE, r.e);
      else {
        total += curE - curS;
        curS = r.s;
        curE = r.e;
      }
    }
    total += curE - curS;
    nights.push({
      day,
      minutes: Math.round(total / 60000),
      start: new Date(list[0]!.s).toISOString(),
      end: new Date(Math.max(...list.map((r) => r.e))).toISOString(),
    });
  }
  return nights.sort((a, b) => (a.day < b.day ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Weight samples → one per day
// ---------------------------------------------------------------------------

/** The latest weight sample on each London day, 1 dp. */
export function latestWeightPerDay(samples: readonly { at: Instant; kg: number }[]): DayValue[] {
  const latest = new Map<LocalDate, { t: number; kg: number }>();
  for (const s of samples) {
    const day = toLondonDate(s.at);
    const t = Date.parse(s.at);
    const cur = latest.get(day);
    if (!cur || t > cur.t) latest.set(day, { t, kg: s.kg });
  }
  return [...latest]
    .map(([day, v]) => ({ day, value: roundTo(v.kg, 1) }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Training: the split suggestion
// ---------------------------------------------------------------------------

export interface TrainedDay {
  trainedOn: LocalDate;
  /** 1-based split day, or null when the day was marked without a split. */
  splitDay: number | null;
  splitName: string | null;
}

export interface SplitSuggestion {
  day: SplitDay;
  /** The split day trained last time ("after Chest & triceps"), if any. */
  after: string | null;
}

/**
 * The suggested split day for `date`: `nextSplitDay(rotation, trained count since the cycle
 * start)`. Each trained day stores its position in the rotation, so the count since the cycle
 * started is the split day number of the latest trained day before `date` (Day 2 trained last →
 * two sessions into the cycle → Day 3 next). "Change" stores the day the user picked instead, so
 * the rotation simply continues from it. Days marked without a split are skipped. Null without a
 * rotation.
 */
export function suggestSplitDay(
  rotation: SplitRotation,
  history: readonly TrainedDay[],
  date: LocalDate,
): SplitSuggestion | null {
  if (rotation.days.length === 0) return null;
  const last = [...history]
    .filter((h) => h.trainedOn < date && h.splitDay != null)
    .sort((a, b) => (a.trainedOn < b.trainedOn ? 1 : -1))[0];
  const countSinceCycleStart = last?.splitDay ? last.splitDay % rotation.days.length : 0;
  return {
    day: nextSplitDay(rotation, countSinceCycleStart),
    after: last?.splitName ?? null,
  };
}

/** Sessions trained on the given days. */
export const sessionsOn = (history: readonly TrainedDay[], days: readonly LocalDate[]): number =>
  history.filter((h) => days.includes(h.trainedOn)).length;

/** The short label under a trained day in the week strip: the split name's first word. */
export const splitShortName = (name: string | null): string =>
  name ? (name.split(/[\s&,]+/).find(Boolean) ?? name) : '';

// ---------------------------------------------------------------------------
// Small formats
// ---------------------------------------------------------------------------

/** Litres to 1 dp for averages: 2600 → "2.6 L". */
export const formatLitres = (ml: number): string => `${roundTo(ml / 1000, 1).toFixed(1)} L`;

/** Steps "6,240". */
export const formatSteps = (n: number): string => formatCount(Math.round(n));
