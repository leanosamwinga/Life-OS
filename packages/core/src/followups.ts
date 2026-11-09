// Log meal and water follow-ups: "Ate it" at the plan's time, water amounts, and the yesterday
// view on Today. Pure: no I/O, no clock reads (callers pass `now`).

import { formatCount } from './format.ts';
import { isInLogWindow, londonDateTimeToInstant, logWindow, toLondonDate } from './time.ts';
import type { AmountUnit, Food, Instant, LocalDate, LocalTime, MealLogItem } from './types.ts';

// ---------------------------------------------------------------------------
// "Ate it" (1B): log a plan meal at its usual time if that has passed, else now
// ---------------------------------------------------------------------------

/**
 * When "Ate it" logs a plan meal: today at its usual time when that time has already passed (and is
 * inside the log window), otherwise now. A plan meal with no usual time is logged now.
 */
export function ateItAt(usualTime: LocalTime | null | undefined, now: Date | Instant): Instant {
  const nowIso = typeof now === 'string' ? now : now.toISOString();
  if (!usualTime) return nowIso;
  const at = londonDateTimeToInstant(toLondonDate(now), usualTime);
  if (Date.parse(at) <= Date.parse(nowIso) && isInLogWindow(at, now)) return at;
  return nowIso;
}

// ---------------------------------------------------------------------------
// Water (2 Health): water_logs.ml is a whole number from 1 to 5,000
// ---------------------------------------------------------------------------

export const WATER_MIN_ML = 1;
export const WATER_MAX_ML = 5000;
/** The quick add beside the Water card's main button. */
export const WATER_QUICK_ADD_ML = 250;
/** The "Other amount…" sheet's quick amounts. */
export const WATER_QUICK_AMOUNTS_ML = [150, 330, 500] as const;

export type WaterAmount = { ok: true; ml: number } | { ok: false; message: string };

/**
 * What the user typed in "Other amount…": a whole number of ml from 1 to 5,000. Spaces, a thousands
 * comma ("1,500") and a trailing "ml" are allowed; decimals, text, 0 and anything over 5,000 aren't.
 */
export function parseWaterMl(text: string): WaterAmount {
  const raw = text
    .trim()
    .replace(/\s*ml$/i, '')
    .trim();
  if (raw === '') return { ok: false, message: 'Enter an amount in ml.' };
  const plain = /^\d{1,3}(,\d{3})+$/.test(raw) ? raw.replace(/,/g, '') : raw;
  if (/^\d*[.,]\d+$/.test(plain) || /^\d+[.,]$/.test(plain)) {
    return { ok: false, message: 'Use a whole number of ml, with no decimals.' };
  }
  if (!/^\d+$/.test(plain)) {
    return { ok: false, message: 'Enter a whole number of ml, like 330.' };
  }
  const ml = Number(plain);
  if (ml < WATER_MIN_ML) return { ok: false, message: 'Enter at least 1 ml.' };
  if (ml > WATER_MAX_ML) {
    return {
      ok: false,
      message: `That’s more than ${formatCount(WATER_MAX_ML)} ml. Log up to ${formatCount(WATER_MAX_ML)} ml at a time.`,
    };
  }
  return { ok: true, ml };
}

/** Today's water list: newest first. */
export function waterNewestFirst<T extends { loggedAt: Instant }>(logs: readonly T[]): T[] {
  return [...logs].sort((a, b) => Date.parse(b.loggedAt) - Date.parse(a.loggedAt));
}

// ---------------------------------------------------------------------------
// Yesterday on Today (1B): only yesterday, the edit window; nothing older
// ---------------------------------------------------------------------------

export type TodayView = 'today' | 'yesterday';

/** The London day a Today view shows. */
export function viewDate(view: TodayView, now: Date | Instant): LocalDate {
  const w = logWindow(now);
  return view === 'today' ? w.today : w.yesterday;
}

// ---------------------------------------------------------------------------
// "Log again" and "Log a corrected copy" (7j): a logged meal's components, by today's foods
// ---------------------------------------------------------------------------

export interface FromLog {
  /** Items whose food still exists and has nutrition: same amounts and units, current values. */
  components: { food: Food; grams: number; unit: AmountUnit }[];
  /** Items whose food has been deleted (or can't be logged): they can't be re-added. */
  unavailable: { name: string; grams: number; unit: AmountUnit }[];
}

/**
 * A logged meal's items as components to log again, using each food's current per-100 values
 * (`foods` holds the loggable foods by id). Items whose food is gone are listed separately.
 */
export function componentsFromLog(
  items: readonly MealLogItem[],
  foods: ReadonlyMap<string, Food>,
): FromLog {
  const out: FromLog = { components: [], unavailable: [] };
  for (const i of items) {
    const unit = i.unit ?? 'g';
    const food = i.foodId ? foods.get(i.foodId) : undefined;
    if (food) out.components.push({ food, grams: i.grams, unit });
    else out.unavailable.push({ name: i.foodName, grams: i.grams, unit });
  }
  return out;
}

/** The quiet line for a food that can't be re-added. */
export const unavailableNote = (name: string) =>
  `${name} is no longer available, so it can’t be added again. Remove it to carry on.`;
