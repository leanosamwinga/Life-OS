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
