import type { Instant, LocalDate, LocalTime } from './types.ts';

export const LONDON_TZ = 'Europe/London';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function toInstantDate(value: Date | Instant): Date {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  return d;
}

function londonParts(value: Date | Instant): LondonParts {
  const parts = partsFormatter.formatToParts(toInstantDate(value));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The Europe/London calendar date (`YYYY-MM-DD`) of an instant. */
export function toLondonDate(value: Date | Instant): LocalDate {
  const p = londonParts(value);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The Europe/London wall-clock time (`HH:MM`) of an instant. */
export function toLondonTime(value: Date | Instant): LocalTime {
  const p = londonParts(value);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } | null {
  const m = LOCAL_DATE_RE.exec(date);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * UK short date, e.g. "Fri 6 Nov".
 * Accepts a `YYYY-MM-DD` local date (used as-is) or an instant (converted to Europe/London).
 */
export function formatDateUK(value: Date | Instant | LocalDate): string {
  const local =
    typeof value === 'string' ? (parseLocalDate(value) ?? londonParts(value)) : londonParts(value);
  // Day of week from the calendar date itself (UTC noon avoids any offset edge cases).
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day, 12)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${local.day} ${MONTHS[local.month - 1]}`;
}

/** 24-hour UK time of an instant in Europe/London, e.g. "13:40". */
export function formatTimeUK(value: Date | Instant): string {
  return toLondonTime(value);
}

function minutesOf(time: LocalTime): number {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) throw new RangeError(`Invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Whether a `HH:MM` time falls within a window that may wrap midnight (start inclusive, end exclusive). */
export function isWithinWindow(time: LocalTime, start: LocalTime, end: LocalTime): boolean {
  const t = minutesOf(time);
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/**
 * The instant at which a Europe/London wall-clock time occurs on a local date,
 * e.g. ('2026-07-01', '08:00') → '2026-07-01T07:00:00.000Z' (BST).
 * For the skipped hour when clocks go forward, the result lands an hour later.
 */
export function londonDateTimeToInstant(date: LocalDate, time: LocalTime): Instant {
  const d = parseLocalDate(date);
  if (!d) throw new RangeError(`Invalid date: ${date}`);
  const minutes = minutesOf(time);
  const wallAsUtc = Date.UTC(d.year, d.month - 1, d.day, Math.floor(minutes / 60), minutes % 60);
  // London is UTC+0 or UTC+1; find the offset at the guessed instant, then correct once more.
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    const p = londonParts(new Date(guess));
    const shownAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess = wallAsUtc - (shownAsUtc - guess);
  }
  return new Date(guess).toISOString();
}

/** Add whole days to a local date, e.g. ('2026-11-06', 1) → '2026-11-07'. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = parseLocalDate(date);
  if (!d) throw new RangeError(`Invalid date: ${date}`);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days, 12));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// When a meal can be logged for (wireframe 7i): from yesterday 00:00 up to an hour from now.
// log_meal and update_logged_meal enforce the same window in Postgres.
// ---------------------------------------------------------------------------

/** How far ahead of now a meal may be logged. */
export const LOG_AHEAD_MINUTES = 60;

export interface LogWindow {
  /** Today and yesterday as Europe/London dates. */
  today: LocalDate;
  yesterday: LocalDate;
  /** Yesterday 00:00 in Europe/London. */
  earliest: Instant;
  /** An hour from now, to the minute. */
  latest: Instant;
}

/** The window a meal's time must fall in, as of `now`. */
export function logWindow(now: Date | Instant): LogWindow {
  const d = toInstantDate(now);
  const today = toLondonDate(d);
  const yesterday = addDays(today, -1);
  const minute = Math.floor(d.getTime() / 60000) * 60000;
  return {
    today,
    yesterday,
    earliest: londonDateTimeToInstant(yesterday, '00:00'),
    latest: new Date(minute + LOG_AHEAD_MINUTES * 60000).toISOString(),
  };
}

/** Whether an instant is inside the log window (both ends included). */
export function isInLogWindow(at: Date | Instant, now: Date | Instant): boolean {
  const w = logWindow(now);
  const t = toInstantDate(at).getTime();
  return t >= Date.parse(w.earliest) && t <= Date.parse(w.latest);
}

/**
 * The latest `HH:MM` that may be picked on a day in the window: an hour from now on the day
 * that hour falls on, 23:59 on a day before it. `null` for a day after it.
 */
export function latestTimeOn(date: LocalDate, now: Date | Instant): LocalTime | null {
  const w = logWindow(now);
  const latestDate = toLondonDate(w.latest);
  if (date < latestDate) return '23:59';
  if (date === latestDate) return toLondonTime(w.latest);
  return null;
}
