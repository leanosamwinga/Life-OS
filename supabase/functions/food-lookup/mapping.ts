import type { FoodRecord } from '@life-os/core';

/** Shape of the parts of an Open Food Facts v2 product response that we use. */
export interface OffProductResponse {
  code?: string;
  status?: number;
  status_verbose?: string;
  product?: {
    code?: string;
    product_name?: string;
    product_name_en?: string;
    product_name_en_gb?: string;
    generic_name?: string;
    brands?: string;
    /** Pack size, e.g. "500 g". */
    quantity?: string;
    product_quantity?: number | string;
    product_quantity_unit?: string;
    serving_size?: string;
    serving_quantity?: number | string;
    serving_quantity_unit?: string;
    nutriments?: Record<string, unknown>;
  };
}

/** A row of `public.foods` as stored in Postgres (snake_case). */
export interface FoodRow {
  id?: string;
  user_id: string | null;
  source: 'open_food_facts' | 'user';
  barcode: string | null;
  name: string | null;
  brand: string | null;
  kcal_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  fibre_per_100g: number | null;
  sugar_per_100g: number | null;
  salt_per_100g: number | null;
  pack_g?: number | null;
  serving_g?: number | null;
  off_fetched_at?: string | null;
}

const BARCODE_RE = /^[0-9]{6,14}$/;
const KJ_PER_KCAL = 4.184;
/** EU labelling rule: salt = sodium × 2.5. */
const SALT_PER_SODIUM = 2.5;

export function isValidBarcode(barcode: unknown): barcode is string {
  return typeof barcode === 'string' && BARCODE_RE.test(barcode);
}

/** Parse a nutriment that may be a number or numeric string. Anything else is unknown (null). */
function num(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/** A plausible per-100 g value: non-negative and at most `max`, rounded to 2 dp. Otherwise null. */
function plausible(value: number | null, max: number): number | null {
  if (value == null || value < 0 || value > max) return null;
  return Math.round(value * 100) / 100;
}

function text(value: unknown, maxLength = 200): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t.slice(0, maxLength);
}

/**
 * Grams from an OFF quantity, only when the unit is grams (default unit is g). Millilitres
 * are not grams, so liquids get `null` rather than a guess.
 */
function grams(value: unknown, unit: unknown, max: number): number | null {
  const u = typeof unit === 'string' && unit.trim() !== '' ? unit.trim().toLowerCase() : 'g';
  if (u !== 'g') return null;
  const n = num(value);
  if (n == null || n <= 0 || n > max) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Map an Open Food Facts product to a global cache `FoodRecord`.
 *
 * Only values Open Food Facts provides are used. Two unit conversions are applied when the
 * preferred field is missing: kJ → kcal (÷ 4.184) and sodium → salt (× 2.5). Missing or
 * implausible values become `null` — we never invent numbers.
 *
 * Returns `null` when the response is "not found".
 */
export function mapOffProduct(barcode: string, response: OffProductResponse): FoodRecord | null {
  if (response.status !== 1 || !response.product) return null;
  const p = response.product;
  const n = p.nutriments ?? {};

  const kcalDirect = num(n['energy-kcal_100g']);
  const kj = num(n['energy-kj_100g']) ?? num(n['energy_100g']);
  const kcal = kcalDirect ?? (kj != null ? kj / KJ_PER_KCAL : null);

  const sodium = num(n['sodium_100g']);
  const salt = num(n['salt_100g']) ?? (sodium != null ? sodium * SALT_PER_SODIUM : null);

  const firstBrand = text(p.brands)?.split(',')[0];

  return {
    userId: null,
    source: 'open_food_facts',
    barcode,
    name:
      text(p.product_name_en_gb) ??
      text(p.product_name_en) ??
      text(p.product_name) ??
      text(p.generic_name),
    brand: text(firstBrand),
    kcalPer100g: plausible(kcal, 1000),
    proteinPer100g: plausible(num(n['proteins_100g']), 100),
    carbsPer100g: plausible(num(n['carbohydrates_100g']), 100),
    fatPer100g: plausible(num(n['fat_100g']), 100),
    fibrePer100g: plausible(num(n['fiber_100g']), 100),
    sugarPer100g: plausible(num(n['sugars_100g']), 100),
    saltPer100g: plausible(salt, 100),
    packGrams: grams(p.product_quantity, p.product_quantity_unit, 100000),
    servingGrams: grams(p.serving_quantity, p.serving_quantity_unit, 10000),
  };
}

export function toFoodRow(record: FoodRecord, fetchedAt: Date): FoodRow {
  return {
    ...(record.id ? { id: record.id } : {}),
    user_id: record.userId,
    source: record.source,
    barcode: record.barcode,
    name: record.name,
    brand: record.brand,
    kcal_per_100g: record.kcalPer100g,
    protein_per_100g: record.proteinPer100g,
    carbs_per_100g: record.carbsPer100g,
    fat_per_100g: record.fatPer100g,
    fibre_per_100g: record.fibrePer100g,
    sugar_per_100g: record.sugarPer100g,
    salt_per_100g: record.saltPer100g,
    pack_g: record.packGrams ?? null,
    serving_g: record.servingGrams ?? null,
    off_fetched_at: fetchedAt.toISOString(),
  };
}

/** Postgres `numeric` arrives as a string from PostgREST; normalise to number | null. */
function dbNum(value: unknown): number | null {
  return value == null ? null : num(value);
}

export function fromFoodRow(row: FoodRow): FoodRecord & { fetchedAt: string | null } {
  return {
    ...(row.id ? { id: row.id } : {}),
    userId: row.user_id,
    source: row.source,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    kcalPer100g: dbNum(row.kcal_per_100g),
    proteinPer100g: dbNum(row.protein_per_100g),
    carbsPer100g: dbNum(row.carbs_per_100g),
    fatPer100g: dbNum(row.fat_per_100g),
    fibrePer100g: dbNum(row.fibre_per_100g),
    sugarPer100g: dbNum(row.sugar_per_100g),
    saltPer100g: dbNum(row.salt_per_100g),
    packGrams: dbNum(row.pack_g),
    servingGrams: dbNum(row.serving_g),
    fetchedAt: row.off_fetched_at ?? null,
  };
}
