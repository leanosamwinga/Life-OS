/**
 * Domain types for Life OS.
 *
 * Conventions (see CLAUDE.md):
 * - Food nutrition is stored per 100 g, or per 100 ml for a food whose `unit` is ml.
 * - Amounts in ml count 1 ml as 1 g, so the maths never changes with the unit; the unit is a label.
 * - Money is integer pence, never floats.
 * - Instants are ISO-8601 strings in UTC; "local" days are Europe/London calendar dates.
 */

/** A calendar date in Europe/London, formatted `YYYY-MM-DD`. */
export type LocalDate = string;

/** A wall-clock time in Europe/London, formatted `HH:MM` (24-hour). */
export type LocalTime = string;

/** An instant in time as an ISO-8601 string, e.g. `2026-11-06T12:30:00Z`. */
export type Instant = string;

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

/** Energy and the three headline macros. kcal is whole; macros are grams to 1 decimal. */
export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Nutrition per 100 g of a food. Optional extras may be unknown (`null`). */
export interface NutrientsPer100g extends Macros {
  fibre?: number | null;
  sugar?: number | null;
  salt?: number | null;
}

export type FoodSource = 'open_food_facts' | 'user';

/**
 * What an amount is measured in. A food's unit says whether its nutrition is per 100 g or per
 * 100 ml (a barcode sets it from Open Food Facts; manual entry offers both; older foods are g).
 * An amount's unit is only its label: 1 ml counts as 1 g, so the numbers never change with it.
 */
export type AmountUnit = 'g' | 'ml';

/**
 * A food that is one of the user's own cooked batches (wireframes 7f–7h): its per-100 g values
 * are the ingredients' totals ÷ the cooked weight. Batches have no portions, no "what's left"
 * and no expiry; they stay until deleted.
 */
export interface BatchInfo {
  /** Cooked weight in grams: the user's own weighing, or the estimate from dry→cooked ratios. */
  cookedWeightG: number;
  /** True when the user weighed it ("I weighed it"); false for "≈ estimated". */
  weighed: boolean;
  /** When this pot was saved (the last "Cook again"). */
  cookedAt: Instant;
  /** Starred batches sort first on the Saved tab. */
  starred: boolean;
}

/**
 * A food that is complete enough to log: kcal and macros per 100 g are known.
 * Partial records (e.g. an Open Food Facts product with missing fields) are a
 * `FoodRecord`; see `toFood` for the conversion.
 */
export interface Food {
  id: string;
  name: string;
  brand?: string | null;
  barcode?: string | null;
  source: FoodSource;
  /** Per 100 g, or per 100 ml when `unit` is ml (the field keeps its name; 1 ml counts as 1 g). */
  per100g: NutrientsPer100g;
  /** What the nutrition is per 100 of. Absent means g. */
  unit?: AmountUnit;
  /** Whole pack and one serving in the food's unit, when known (e.g. from Open Food Facts). */
  packGrams?: number | null;
  servingGrams?: number | null;
  /** Set when this food is one of the user's own batches. */
  batch?: BatchInfo | null;
}

/** A food as stored, where any nutrient may be unknown. Never invent missing numbers. */
export interface FoodRecord {
  id?: string;
  /** `null` for the global Open Food Facts cache; the owner's id for user-created foods. */
  userId: string | null;
  source: FoodSource;
  barcode: string | null;
  name: string | null;
  brand: string | null;
  kcalPer100g: number | null;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  fibrePer100g: number | null;
  sugarPer100g: number | null;
  saltPer100g: number | null;
  /** Per 100 g or per 100 ml. Absent means g. */
  nutritionUnit?: AmountUnit;
  /** Whole pack and one serving in the food's unit. Unknown is `null`; absent on older records. */
  packGrams?: number | null;
  servingGrams?: number | null;
  /** Set when this food is one of the user's own batches. */
  batch?: BatchInfo | null;
}

/** One part of a meal: a food and how much of it. */
export interface MealComponent {
  food: Food;
  /** The amount. Named grams for history; in ml when `unit` is ml (1 ml counts as 1 g). */
  grams: number;
  /** The amount's label. Absent means the food's own unit. */
  unit?: AmountUnit;
}

/** A saved meal in the user's roster. Plan meals are saved meals flagged as part of the daily plan. */
export interface SavedMeal {
  id: string;
  userId: string;
  name: string;
  components: MealComponent[];
  /** True when this meal is part of the user's daily plan (e.g. "Plan A breakfast"). */
  inDailyPlan: boolean;
  /** The usual time for a plan meal, e.g. `08:00`. `null` for non-plan meals. */
  usualTime: LocalTime | null;
  /** Starred meals sort first on the Saved tab. */
  starred?: boolean;
}

/**
 * A logged component with its macros snapshotted at log time, so later edits to the
 * food do not rewrite history.
 */
export interface MealLogItem {
  foodId: string | null;
  foodName: string;
  /** The amount, in `unit` (1 ml counts as 1 g). */
  grams: number;
  /** Absent on older logs, which are g. */
  unit?: AmountUnit;
  macros: Macros;
}

export interface MealLog {
  id: string;
  userId: string;
  /** The roster meal this came from, if any. */
  savedMealId: string | null;
  name: string;
  loggedAt: Instant;
  items: MealLogItem[];
}

/** The amount the user had last time for a food, used to pre-fill suggestions. */
export interface LastPortion {
  foodId: string;
  grams: number;
  unit?: AmountUnit;
  loggedAt: Instant;
}

export interface WaterLog {
  id: string;
  userId: string;
  ml: number;
  loggedAt: Instant;
}

export interface DailyTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  waterMl: number;
  steps: number;
}

// ---------------------------------------------------------------------------
// Nudges
// ---------------------------------------------------------------------------

export interface NudgeSettings {
  morningBriefing: { enabled: boolean; weekdayTime: LocalTime; weekendTime: LocalTime };
  eveningCheckIn: { enabled: boolean; time: LocalTime };
  eventReminders: { enabled: boolean };
  urgentBillAlerts: { enabled: boolean };
  monthlyStatementImport: { enabled: boolean; dayOfMonth: number; time: LocalTime };
  quietHours: { start: LocalTime; end: LocalTime };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

declare const penceBrand: unique symbol;

/** An amount of money in integer pence (GBP). Negative for debts such as credit cards. */
export type MoneyAmount = number & { readonly [penceBrand]: 'pence' };

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export interface SplitDay {
  /** 1-based position in the rotation, e.g. 4 for "Day 4". */
  day: number;
  name: string;
}

/**
 * The user's training split as a rotation. Each synced workout advances it by one;
 * the user can correct the count. Sets and reps live in Liftoff and are never modelled here.
 */
export interface SplitRotation {
  days: SplitDay[];
  targetPerWeek: number;
}
