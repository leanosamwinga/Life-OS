import type {
  DailyTargets,
  Food,
  FoodRecord,
  LocalDate,
  Macros,
  MealComponent,
  MealLog,
  MealLogItem,
  WaterLog,
} from './types.ts';
import { toLondonDate } from './time.ts';

export const ZERO_MACROS: Readonly<Macros> = Object.freeze({
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
});

/** Round half away from zero to `dp` decimal places, avoiding binary float artefacts. */
export function roundTo(value: number, dp: number): number {
  const factor = 10 ** dp;
  const shifted = Math.abs(value) * factor;
  // toPrecision trims representation noise such as 0.35 * 10 = 3.4999999999999996.
  const rounded = Math.round(Number(shifted.toPrecision(15)));
  const result = (Math.sign(value) * rounded) / factor;
  return Object.is(result, -0) ? 0 : result;
}

/** Round a macros object: whole kcal, macros to 1 decimal place. */
export function roundMacros(m: Macros): Macros {
  return {
    kcal: roundTo(m.kcal, 0),
    protein: roundTo(m.protein, 1),
    carbs: roundTo(m.carbs, 1),
    fat: roundTo(m.fat, 1),
  };
}

function assertGrams(grams: number): void {
  if (!Number.isFinite(grams) || grams < 0) {
    throw new RangeError(`grams must be a finite, non-negative number (got ${grams})`);
  }
}

/** Macros for a portion: grams × per-100 g ÷ 100, whole kcal and 1-decimal macros. */
export function portionMacros(food: Pick<Food, 'per100g'>, grams: number): Macros {
  assertGrams(grams);
  const p = food.per100g;
  return roundMacros({
    kcal: (p.kcal * grams) / 100,
    protein: (p.protein * grams) / 100,
    carbs: (p.carbs * grams) / 100,
    fat: (p.fat * grams) / 100,
  });
}

function isComponent(item: MealComponent | Macros | MealLogItem): item is MealComponent {
  return 'food' in item;
}

function isLogItem(item: MealComponent | Macros | MealLogItem): item is MealLogItem {
  return 'macros' in item;
}

/**
 * Sum macros across meal components (computed per portion, then summed), logged items
 * (using their snapshots) or plain macros.
 */
export function sumMacros(items: ReadonlyArray<MealComponent | MealLogItem | Macros>): Macros {
  const total = items.reduce<Macros>(
    (acc, item) => {
      const m = isComponent(item)
        ? portionMacros(item.food, item.grams)
        : isLogItem(item)
          ? item.macros
          : item;
      return {
        kcal: acc.kcal + m.kcal,
        protein: acc.protein + m.protein,
        carbs: acc.carbs + m.carbs,
        fat: acc.fat + m.fat,
      };
    },
    { ...ZERO_MACROS },
  );
  return roundMacros(total);
}

/** Snapshot a meal's components at log time, so later food edits don't rewrite history. */
export function snapshotComponents(components: readonly MealComponent[]): MealLogItem[] {
  return components.map((c) => ({
    foodId: c.food.id,
    foodName: c.food.name,
    grams: c.grams,
    macros: portionMacros(c.food, c.grams),
  }));
}

/**
 * Turn a stored food record into a loggable `Food`, or `null` if kcal or any headline
 * macro is unknown (the user must complete it — we never invent numbers).
 */
export function toFood(record: FoodRecord & { id: string }): Food | null {
  const { kcalPer100g, proteinPer100g, carbsPer100g, fatPer100g } = record;
  if (kcalPer100g == null || proteinPer100g == null || carbsPer100g == null || fatPer100g == null) {
    return null;
  }
  return {
    id: record.id,
    name: record.name ?? 'Unnamed food',
    brand: record.brand,
    barcode: record.barcode,
    source: record.source,
    per100g: {
      kcal: kcalPer100g,
      protein: proteinPer100g,
      carbs: carbsPer100g,
      fat: fatPer100g,
      fibre: record.fibrePer100g,
      sugar: record.sugarPer100g,
      salt: record.saltPer100g,
    },
  };
}

// ---------------------------------------------------------------------------
// Daily progress
// ---------------------------------------------------------------------------

export interface MetricProgress {
  consumed: number;
  target: number;
  /** consumed ÷ target clamped to 0–1, for rings and bars. 0 when target is 0. */
  fraction: number;
  /** target − consumed, never below 0. */
  remaining: number;
}

export interface DayProgress {
  date: LocalDate;
  eaten: Macros;
  kcal: MetricProgress;
  protein: MetricProgress;
  carbs: MetricProgress;
  fat: MetricProgress;
  water: MetricProgress;
  steps: MetricProgress;
  /** Meal logs that fall on this local day, in time order. */
  meals: MealLog[];
}

export interface DayLogs {
  meals: readonly MealLog[];
  water?: readonly WaterLog[];
  /** Step count for the day, from Apple Health when connected. */
  steps?: number;
}

function metric(consumed: number, target: number, dp: number): MetricProgress {
  const c = roundTo(consumed, dp);
  return {
    consumed: c,
    target,
    fraction: target > 0 ? Math.min(1, Math.max(0, c / target)) : 0,
    remaining: Math.max(0, roundTo(target - c, dp)),
  };
}

/** Today's progress = sum of logs whose instant falls on `date` in Europe/London. */
export function dayProgress(logs: DayLogs, targets: DailyTargets, date: LocalDate): DayProgress {
  const meals = logs.meals
    .filter((m) => toLondonDate(m.loggedAt) === date)
    .slice()
    .sort((a, b) => Date.parse(a.loggedAt) - Date.parse(b.loggedAt));
  const eaten = sumMacros(meals.flatMap((m) => m.items));
  const waterMl = (logs.water ?? [])
    .filter((w) => toLondonDate(w.loggedAt) === date)
    .reduce((sum, w) => sum + w.ml, 0);

  return {
    date,
    eaten,
    kcal: metric(eaten.kcal, targets.kcal, 0),
    protein: metric(eaten.protein, targets.protein, 1),
    carbs: metric(eaten.carbs, targets.carbs, 1),
    fat: metric(eaten.fat, targets.fat, 1),
    water: metric(waterMl, targets.waterMl, 0),
    steps: metric(logs.steps ?? 0, targets.steps, 0),
    meals,
  };
}
