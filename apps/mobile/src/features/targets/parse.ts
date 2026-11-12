import type { Targets } from '@/lib/backend/settings';

export type TargetKey = keyof Targets;

/** Field definitions matching the CHECK constraints on user_settings. */
export const TARGET_FIELDS: {
  key: TargetKey;
  label: string;
  unit: string;
  max: number;
  decimals: 0 | 1;
}[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', max: 20000, decimals: 0 },
  { key: 'protein', label: 'Protein', unit: 'g', max: 2000, decimals: 1 },
  { key: 'carbs', label: 'Carbs', unit: 'g', max: 2000, decimals: 1 },
  { key: 'fat', label: 'Fat', unit: 'g', max: 2000, decimals: 1 },
  { key: 'waterMl', label: 'Water', unit: 'ml', max: 20000, decimals: 0 },
  { key: 'steps', label: 'Steps', unit: 'steps', max: 200000, decimals: 0 },
];

export type ParseResult = { ok: true; value: number | null } | { ok: false; error: string };

/** Parse a number typed by the user. Empty means "not set" (null). Accepts "2,450" and "2450". */
export function parseAmount(input: string, opts: { max: number; decimals: 0 | 1 }): ParseResult {
  const t = input.trim().replace(/,/g, '');
  if (t === '') return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: 'Enter a number' };
  const n = Number(t);
  if (n > opts.max)
    return { ok: false, error: `Must be ${opts.max.toLocaleString('en-GB')} or less` };
  const factor = 10 ** opts.decimals;
  return { ok: true, value: Math.round(n * factor) / factor };
}

export function parseTargets(
  inputs: Record<TargetKey, string>,
): { ok: true; targets: Targets } | { ok: false; errors: Partial<Record<TargetKey, string>> } {
  const targets = {} as Targets;
  const errors: Partial<Record<TargetKey, string>> = {};
  for (const f of TARGET_FIELDS) {
    const r = parseAmount(inputs[f.key], f);
    if (r.ok) targets[f.key] = r.value;
    else errors[f.key] = r.error;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, targets };
}

export const targetInputs = (t: Targets): Record<TargetKey, string> =>
  Object.fromEntries(
    TARGET_FIELDS.map((f) => [f.key, t[f.key] == null ? '' : String(t[f.key])]),
  ) as Record<TargetKey, string>;

// ---------------------------------------------------------------------------
// Me → Health targets (6B): weight, sleep, training and supplements
// ---------------------------------------------------------------------------

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Target weight in kg, 20–400, 1 dp. Empty = not set. */
export function parseTargetWeight(input: string): FieldResult<number | null> {
  const r = parseAmount(input, { max: 400, decimals: 1 });
  if (!r.ok) return r;
  if (r.value != null && r.value < 20) return { ok: false, error: 'Must be 20 kg or more' };
  return r;
}

/** Sleep a night from hours and minutes: 1h–24h. Both empty = not set. */
export function parseSleepTarget(hours: string, minutes: string): FieldResult<number | null> {
  const h = hours.trim();
  const m = minutes.trim();
  if (h === '' && m === '') return { ok: true, value: null };
  if (!/^\d{1,2}$/.test(h || '0') || !/^\d{1,2}$/.test(m || '0'))
    return { ok: false, error: 'Use whole hours and minutes, like 7 h 30 m' };
  const hh = Number(h || '0');
  const mm = Number(m || '0');
  if (mm > 59) return { ok: false, error: 'Minutes go up to 59' };
  const total = hh * 60 + mm;
  if (total < 60 || total > 1440) return { ok: false, error: 'Between 1 and 24 hours' };
  return { ok: true, value: total };
}

/** Training sessions a week: a whole number 0–14. */
export function parsePerWeek(input: string): FieldResult<number> {
  const t = input.trim();
  if (!/^\d{1,2}$/.test(t)) return { ok: false, error: 'Enter a whole number' };
  const n = Number(t);
  if (n > 14) return { ok: false, error: 'At most 14 a week' };
  return { ok: true, value: n };
}

/** Split day names in order: blanks dropped, each 1–40 characters, at most 14. */
export function parseSplit(names: readonly string[]): FieldResult<string[]> {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length > 14) return { ok: false, error: 'At most 14 days in a split' };
  if (list.some((n) => n.length > 40))
    return { ok: false, error: 'Keep each day to 40 characters' };
  return { ok: true, value: list };
}

/** A 24-hour time: "08:00", "8:00", "0800", "21.30" → "HH:MM". */
export function parseTime24(input: string): FieldResult<string> {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(input.trim());
  if (!m) return { ok: false, error: 'Use a 24-hour time, like 08:00' };
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return { ok: false, error: 'Use a 24-hour time, like 08:00' };
  return { ok: true, value: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
}

/** Plan name: up to 40 characters; empty = none. */
export function parsePlanName(input: string): FieldResult<string | null> {
  const t = input.trim();
  if (t.length > 40) return { ok: false, error: 'Keep it to 40 characters' };
  return { ok: true, value: t || null };
}

/** "Macros add up to 2,395 kcal." (4 kcal/g protein and carbs, 9 kcal/g fat). */
export function macroKcal(protein: number | null, carbs: number | null, fat: number | null) {
  return Math.round((protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9);
}
