// Log meal follow-up (wireframes 7i, 7k, 7l and the "-U" frames): the time picker's limits, the
// words around moving or deleting a logged meal, and g or ml. Pure: no I/O, no clock reads.

import { formatAmount, formatKcal } from './format.ts';
import {
  addDays,
  formatDateUK,
  latestTimeOn,
  londonDateTimeToInstant,
  logWindow,
  toLondonDate,
  toLondonTime,
} from './time.ts';
import type { AmountUnit, Instant, LocalDate, LocalTime } from './types.ts';

// ---------------------------------------------------------------------------
// 7i Pick a time
// ---------------------------------------------------------------------------

/**
 * The two days 7i offers in time order: Yesterday on the left, Today on the right (a deliberate
 * change from the 7i wireframe, which had Today first).
 */
export function pickerDays(
  now: Date | Instant,
): { label: 'Today' | 'Yesterday'; date: LocalDate }[] {
  const w = logWindow(now);
  return [
    { label: 'Yesterday', date: w.yesterday },
    { label: 'Today', date: w.today },
  ];
}

const minutes = (t: LocalTime) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number): LocalTime =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** The latest `HH:MM` the wheels allow on a picker day (23:59 on yesterday). */
export function pickerLatest(date: LocalDate, now: Date | Instant): LocalTime {
  return latestTimeOn(date, now) ?? '00:00';
}

/** Whether hour `h` (and, if given, minute `m`) can be chosen on `date`. Later ones are greyed out. */
export function isPickable(
  date: LocalDate,
  h: number,
  m: number | null,
  now: Date | Instant,
): boolean {
  const latest = minutes(pickerLatest(date, now));
  if (m == null) return h * 60 <= latest;
  return h * 60 + m <= latest;
}

/**
 * A wheel choice held to the limit: a time past the latest becomes the latest (7i "more than an
 * hour ahead"). `clamped` says whether it had to move.
 */
export function clampPick(
  date: LocalDate,
  time: LocalTime,
  now: Date | Instant,
): { time: LocalTime; clamped: boolean } {
  const latest = pickerLatest(date, now);
  return minutes(time) > minutes(latest)
    ? { time: latest, clamped: true }
    : { time, clamped: false };
}

/** "Today" / "Yesterday" for the two picker days, else "Sun 8 Nov". */
export function dayLabel(date: LocalDate, now: Date | Instant): string {
  const w = logWindow(now);
  if (date === w.today) return 'Today';
  if (date === w.yesterday) return 'Yesterday';
  return formatDateUK(date);
}

/** 7i's bold line and 7k's time row: "Today · Mon 9 Nov · 13:40". */
export const pickedLine = (date: LocalDate, time: LocalTime, now: Date | Instant): string =>
  `${dayLabel(date, now)} · ${formatDateUK(date)} · ${time}`;

/** 7i's quiet line under the choice. */
export function pickerHint(date: LocalDate, now: Date | Instant): string {
  const w = logWindow(now);
  if (date === w.today) return `Any time from yesterday 00:00 up to ${pickerLatest(date, now)}.`;
  return `Counts towards ${formatDateUK(date)}’s totals, not today’s.`;
}

/** 7i "more than an hour ahead": the callout, bold part first. */
export const pickerLimitNote = (latest: LocalTime) => ({
  bold: `Latest is ${latest}.`,
  rest: 'That’s an hour from now, so later times are greyed out and can’t be chosen.',
});

/** Where the picker opens for an instant: its London day and time, held inside the window. */
export function pickerStart(
  at: Date | Instant,
  now: Date | Instant,
): { date: LocalDate; time: LocalTime } {
  const w = logWindow(now);
  let date = toLondonDate(at);
  let time = toLondonTime(at);
  if (date < w.yesterday) return { date: w.yesterday, time: '00:00' };
  if (date > w.today) {
    date = w.today;
    time = pickerLatest(date, now);
  }
  return { date, time: clampPick(date, time, now).time };
}

/**
 * The instant for a picked day and time. On the October clock change 01:00–01:59 happens twice;
 * the second (GMT) one is used. A time that doesn't exist (01:00–01:59 on the March change) moves on
 * an hour, as the clock does.
 */
export const pickedInstant = (date: LocalDate, time: LocalTime): Instant =>
  londonDateTimeToInstant(date, time);

// ---------------------------------------------------------------------------
// 7k moved to another day, 7l delete
// ---------------------------------------------------------------------------

/** "Today" for today, else "Sun 8 Nov". */
const dayName = (date: LocalDate, today: LocalDate) =>
  date === today ? 'Today' : formatDateUK(date);

/**
 * 7k "moved to yesterday": `null` when the day doesn't change. `fromTotal` is the old day's kcal
 * including this meal.
 */
export function moveNote(args: {
  from: LocalDate;
  to: LocalDate;
  kcal: number;
  fromTotal: number;
  today: LocalDate;
}): { bold: string; rest: string } | null {
  if (args.from === args.to) return null;
  const k = formatKcal(args.kcal);
  return {
    bold: `Moves to ${formatDateUK(args.to)}.`,
    rest:
      `${dayName(args.from, args.today)} goes down by ${k} kcal ` +
      `(${formatKcal(args.fromTotal)} → ${formatKcal(args.fromTotal - args.kcal)}). ` +
      `${dayName(args.to, args.today)} goes up by ${k} kcal.`,
  };
}

/** 7l: the sheet's lines for a meal on `day`, whose total (with the meal) is `dayTotal`. */
export function deleteSummary(args: {
  name: string;
  day: LocalDate;
  today: LocalDate;
  kcal: number;
  protein: number;
  dayTotal: number;
}) {
  const d = dayName(args.day, args.today);
  return {
    title: `Delete ${args.name}?`,
    body: `It comes off ${formatDateUK(args.day)}. You can undo it straight after on Today.`,
    nowLabel: `${d} now`,
    now: `${formatKcal(args.dayTotal)} kcal`,
    down: `${formatKcal(args.kcal)} kcal · P ${args.protein.toFixed(1)} g`,
    afterLabel: `${d} after`,
    after: `${formatKcal(args.dayTotal - args.kcal)} kcal`,
  };
}

/** 7l "from the plan": the plan meal comes back as not eaten. */
export const planBackNote = (slot: string, usualTime: LocalTime | null) => ({
  bold: `${slot} goes back on your plan as not eaten.`,
  rest: `${usualTime ? `“Ate it” comes back at ${usualTime}. ` : ''}The plan meal itself isn’t changed.`,
});

/** Yesterday and today, for loading the logs 7j–7l need. */
export const editableDays = (now: Date | Instant): LocalDate[] => {
  const w = logWindow(now);
  return [w.yesterday, w.today];
};

/** The day after `date`, 00:00 London: the end of a day range. */
export const dayEnd = (date: LocalDate): Instant =>
  londonDateTimeToInstant(addDays(date, 1), '00:00');

// ---------------------------------------------------------------------------
// g or ml
// ---------------------------------------------------------------------------

/** The quiet line shown when the chosen unit isn't the food's (1 ml counts as 1 g). */
export const UNIT_HINT = '≈ 1 ml counts as 1 g';

export const unitHint = (chosen: AmountUnit, foodUnit: AmountUnit): string | null =>
  chosen === foodUnit ? null : UNIT_HINT;

/** "330 g × per-100 ml values ÷ 100". */
export const portionFormula = (amount: number | null, unit: AmountUnit, foodUnit: AmountUnit) =>
  `${amount ? formatAmount(amount, unit) : `— ${unit}`} × per-100 ${foodUnit} values ÷ 100`;

/** What a whole pack is called: a bottle for drinks sold in ml, else a pack. */
export const packWord = (foodUnit: AmountUnit) => (foodUnit === 'ml' ? 'bottle' : 'pack');

/** "Per 100 ml" / "Per 100 g". */
export const per100Label = (foodUnit: AmountUnit) => `Per 100 ${foodUnit}`;

/** A wheel's numbers: 00–23 or 00–59. */
export const wheelValues = (max: number): number[] => Array.from({ length: max + 1 }, (_, i) => i);

/** "06:40" from wheel numbers. */
export const wheelTime = (h: number, m: number): LocalTime => hhmm(h * 60 + m);

// ---------------------------------------------------------------------------
// Looping wheels (7i): like the iOS alarm picker, 59 → 00 → 01 and 23 → 00 → 01
// ---------------------------------------------------------------------------
//
// A looping wheel draws its numbers several times over (`LOOP_COPIES`) and, once it settles, jumps
// without animation to the same number in the middle copy, so there is always room to keep going
// either way. Looping only wraps the number on that wheel: it never carries into the other wheel or
// changes the day. Whether a number can be chosen is decided by its value alone (`isPickable`), so a
// number past the latest stays struck through however it was reached.

/** How many times a looping wheel draws its numbers. Odd, so there is a middle copy. */
export const LOOP_COPIES = 7;

/** How many rows a looping wheel has for `count` numbers. */
export const loopRows = (count: number, copies = LOOP_COPIES): number => count * copies;

/** The number shown on row `row` of a wheel of `count` numbers (0 … count − 1). */
export const loopValue = (row: number, count: number): number => ((row % count) + count) % count;

/** The middle copy's row for `value`: where a looping wheel rests. */
export const loopHome = (value: number, count: number, copies = LOOP_COPIES): number =>
  Math.floor(copies / 2) * count + value;

/**
 * The row showing `value` nearest to `fromRow` (ties go down the wheel), kept inside the wheel. Used
 * to move to a number by the short way round, e.g. 59 → 00 goes one row on, not 59 rows back.
 */
export function loopNearest(
  value: number,
  fromRow: number,
  count: number,
  copies = LOOP_COPIES,
): number {
  const base = fromRow - loopValue(fromRow, count) + value;
  const options = [base - count, base, base + count].filter(
    (r) => r >= 0 && r < loopRows(count, copies),
  );
  return options.reduce((best, r) => (Math.abs(r - fromRow) < Math.abs(best - fromRow) ? r : best));
}

/** Whether a resting row is far enough from the middle copy to be moved back to it. */
export const loopNeedsRecentre = (row: number, count: number, copies = LOOP_COPIES): boolean =>
  Math.floor(row / count) !== Math.floor(copies / 2);

/**
 * VoiceOver's swipe up / down on a wheel: one step, stopping at the ends (00 and 23 / 59) rather
 * than wrapping, so a swipe never jumps a whole day's worth of numbers. `null` when it can't move.
 */
export function wheelStep(value: number, step: 1 | -1, max: number): number | null {
  const next = value + step;
  return next < 0 || next > max ? null : next;
}
