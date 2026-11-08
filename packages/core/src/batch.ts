/**
 * Batches (wireframes 7f–7h): one pot cooked once, then logged by the gram.
 *
 * A batch is the user's own food. Its per-100 g values are the ingredients' totals ÷ the cooked
 * weight × 100, rounded like every other macro (whole kcal, 1 dp). The cooked weight is the
 * user's own weighing ("I weighed it") or, failing that, an estimate from a small, conservative
 * table of dry→cooked ratios. Anything not clearly in the table counts as its own weight.
 *
 * The same maths runs in the `save_batch` Postgres function, which recomputes everything from the
 * ingredients' foods and refuses a batch whose numbers don't match (see the batches migration).
 */
import type { Macros, MealComponent } from './types.ts';
import { roundMacros, roundTo, sumMacros } from './nutrition.ts';

export type CookedCategory =
  'rice' | 'pasta' | 'oats' | 'lentils' | 'couscous' | 'quinoa' | 'meat' | 'poultry' | 'fish';

/** How an ingredient changes weight in the pot: one of the table's categories, or "as added". */
export type CooksAs = CookedCategory | 'as_added';

export interface CookedRatio {
  key: CookedCategory;
  /** Shown in "How we worked it out", e.g. "dry rice × 2.5 (it soaks up water)". */
  label: string;
  /** cooked grams ÷ grams as they went in the pot. */
  ratio: number;
  why: 'it soaks up water' | 'it loses water';
}

/**
 * The whole table. Deliberately small: dry staples that soak up cooking water, and raw meat,
 * poultry and fish that lose it. Rough, rounded figures — the user can correct an ingredient or
 * weigh the pot, which always wins.
 */
export const COOKED_RATIOS: Readonly<Record<CookedCategory, CookedRatio>> = Object.freeze({
  rice: { key: 'rice', label: 'dry rice', ratio: 2.5, why: 'it soaks up water' },
  pasta: { key: 'pasta', label: 'dry pasta', ratio: 2.25, why: 'it soaks up water' },
  oats: { key: 'oats', label: 'oats', ratio: 2.5, why: 'it soaks up water' },
  lentils: { key: 'lentils', label: 'dry lentils', ratio: 2.5, why: 'it soaks up water' },
  couscous: { key: 'couscous', label: 'couscous', ratio: 2.25, why: 'it soaks up water' },
  quinoa: { key: 'quinoa', label: 'quinoa', ratio: 2.75, why: 'it soaks up water' },
  meat: { key: 'meat', label: 'raw meat', ratio: 0.75, why: 'it loses water' },
  poultry: { key: 'poultry', label: 'raw poultry', ratio: 0.75, why: 'it loses water' },
  fish: { key: 'fish', label: 'raw fish', ratio: 0.8, why: 'it loses water' },
});

/** Order of the choices offered when the user corrects an ingredient. */
export const COOKS_AS_OPTIONS: readonly CooksAs[] = [
  'as_added',
  'rice',
  'pasta',
  'oats',
  'lentils',
  'couscous',
  'quinoa',
  'meat',
  'poultry',
  'fish',
];

export function isCooksAs(value: unknown): value is CooksAs {
  return typeof value === 'string' && (COOKS_AS_OPTIONS as readonly string[]).includes(value);
}

/** The ratio used for an ingredient: 1 for "as added". */
export function cookedRatio(cooksAs: CooksAs): number {
  return cooksAs === 'as_added' ? 1 : COOKED_RATIOS[cooksAs].ratio;
}

/** "As added" or e.g. "Dry rice × 2.5". */
export function cooksAsLabel(cooksAs: CooksAs): string {
  if (cooksAs === 'as_added') return 'As added';
  const r = COOKED_RATIOS[cooksAs];
  return `${r.label.charAt(0).toUpperCase()}${r.label.slice(1)} × ${formatRatio(r.ratio)}`;
}

export function formatRatio(ratio: number): string {
  return String(roundTo(ratio, 2));
}

// Names that mean "not dry" or "not a plain staple" — then the ingredient counts as added.
const NOT_DRY =
  /\b(cooked|boiled|steamed|microwave|microwaveable|pouch|ready|instant|tinned|canned|tin|in water|in brine|fresh|cakes?|crackers?|milk|drink|flour|pudding|soup|sauce|salad|fried|noodles?|bran|syrup|vinegar|wine|paper|bars?|cereal|crisps|crispies|puffed|pots?)\b/;
// Meat, poultry and fish only count when the name says "raw": shops sell both raw and cooked.
const NOT_RAW =
  /\b(cooked|roast|roasted|smoked|cured|grilled|fried|breaded|tinned|canned|in water|in brine|in oil|ham|slices|sliced|pâté|pate)\b/;

const DRY: [CookedCategory, RegExp][] = [
  ['rice', /\brice\b/],
  [
    'pasta',
    /\b(pasta|spaghetti|penne|fusilli|macaroni|linguine|tagliatelle|farfalle|rigatoni|orzo)\b/,
  ],
  ['oats', /\boats\b/],
  ['lentils', /\blentils?\b/],
  ['couscous', /\bcous ?cous\b/],
  ['quinoa', /\bquinoa\b/],
];
const RAW: [CookedCategory, RegExp][] = [
  ['poultry', /\b(chicken|turkey|duck)\b/],
  ['fish', /\b(salmon|cod|haddock|tuna|fish|prawns?|trout|mackerel|sea bass|basa|pollock|hake)\b/],
  ['meat', /\b(beef|pork|lamb|mince|steak|veal|venison|goat)\b/],
];

/**
 * Pick the table entry for an ingredient from its name — only clear cases. A dry staple counts
 * unless the name says it's cooked, tinned, fresh or a different product (rice cakes, oat milk);
 * meat, poultry and fish need the word "raw". Everything else is "as added".
 */
export function guessCooksAs(name: string): CooksAs {
  const n = name.toLowerCase().replace(/[,()/·–-]/g, ' ');
  if (/\braw\b/.test(n) && !NOT_RAW.test(n)) {
    for (const [key, re] of RAW) if (re.test(n)) return key;
  }
  if (!NOT_DRY.test(n) && !/\braw\b/.test(n)) {
    for (const [key, re] of DRY) if (re.test(n)) return key;
  }
  return 'as_added';
}

/** An ingredient as it went in the pot (liquids: 1 ml = 1 g). */
export interface BatchIngredient extends MealComponent {
  cooksAs: CooksAs;
}

/** The whole batch's macros: each ingredient's portion (rounded), summed — like a meal. */
export function batchTotals(ingredients: readonly MealComponent[]): Macros {
  return sumMacros(ingredients);
}

/** Estimates are rounded to the nearest 10 g ("≈ 1,240 g"); under 100 g to the gram, at least 1. */
export function roundCookedWeight(grams: number): number {
  if (!Number.isFinite(grams) || grams <= 0) return 0;
  if (grams < 100) return Math.max(1, roundTo(grams, 0));
  return roundTo(grams / 10, 0) * 10;
}

/** Σ grams × ratio, rounded as above. 0 for an empty batch. */
export function estimateCookedWeight(ingredients: readonly BatchIngredient[]): number {
  const raw = ingredients.reduce((sum, i) => sum + i.grams * cookedRatio(i.cooksAs), 0);
  return roundCookedWeight(roundTo(raw, 2));
}

/** The biggest cooked weight we accept, in grams (a 50 kg pot is already generous). */
export const BATCH_MAX_COOKED_G = 50000;

export type CookedWeightIssue = 'missing' | 'too_light' | 'too_heavy';

/**
 * A cooked weight has to be positive, at most 50 kg, and at least the protein + carbs + fat that
 * went in (food can lose water, not solids) — else the per-100 g values would be impossible.
 */
export function checkCookedWeight(totals: Macros, grams: number | null): CookedWeightIssue | null {
  if (grams == null || !Number.isFinite(grams) || grams <= 0) return 'missing';
  if (grams > BATCH_MAX_COOKED_G) return 'too_heavy';
  if (grams < totals.protein + totals.carbs + totals.fat) return 'too_light';
  return null;
}

/** Per 100 g cooked = totals ÷ cooked weight × 100; whole kcal, 1 dp macros. */
export function batchPer100g(totals: Macros, cookedWeightG: number): Macros {
  if (!Number.isFinite(cookedWeightG) || cookedWeightG <= 0) {
    throw new RangeError(`cookedWeightG must be positive (got ${cookedWeightG})`);
  }
  // × 100 first, then ÷, as the save_batch SQL does.
  return roundMacros({
    kcal: (totals.kcal * 100) / cookedWeightG,
    protein: (totals.protein * 100) / cookedWeightG,
    carbs: (totals.carbs * 100) / cookedWeightG,
    fat: (totals.fat * 100) / cookedWeightG,
  });
}

export interface BatchSummary {
  totals: Macros;
  /** From the ratios; 0 when the batch is empty. */
  estimatedG: number;
  /** What the per-100 g values use: the weighed value when given, else the estimate. */
  cookedWeightG: number;
  weighed: boolean;
  issue: CookedWeightIssue | null;
  /** `null` while the batch is empty or the cooked weight is impossible. */
  per100g: Macros | null;
}

/** Everything 7f/7g show, from the ingredients and the optional "I weighed it" value. */
export function summariseBatch(
  ingredients: readonly BatchIngredient[],
  weighedG: number | null,
): BatchSummary {
  const totals = batchTotals(ingredients);
  const estimatedG = estimateCookedWeight(ingredients);
  const weighed = weighedG != null;
  const cookedWeightG = weighed ? roundTo(weighedG, 1) : estimatedG;
  const issue = ingredients.length === 0 ? 'missing' : checkCookedWeight(totals, cookedWeightG);
  return {
    totals,
    estimatedG,
    cookedWeightG,
    weighed,
    issue,
    per100g: issue ? null : batchPer100g(totals, cookedWeightG),
  };
}

/**
 * "dry rice × 2.5 (it soaks up water), raw poultry × 0.75 (it loses water), the rest as added."
 * Categories in the order they first appear.
 */
export function explainEstimate(ingredients: readonly BatchIngredient[]): string {
  const used: CookedCategory[] = [];
  let rest = false;
  for (const i of ingredients) {
    if (i.cooksAs === 'as_added') rest = true;
    else if (!used.includes(i.cooksAs)) used.push(i.cooksAs);
  }
  if (used.length === 0) return 'Everything counts as added.';
  const parts = used.map((k) => {
    const r = COOKED_RATIOS[k];
    return `${r.label} × ${formatRatio(r.ratio)} (${r.why})`;
  });
  return `${parts.join(', ')}${rest ? ', the rest as added' : ''}.`;
}

const LIQUID = /\b(soup|broth|stock|smoothie|shake|juice|drink|gravy|sauce)s?\b/;

/** Liquid batches (soup, broth, …) are logged in grams too: 1 ml counts as 1 g. */
export function isLiquidBatch(name: string): boolean {
  return LIQUID.test(name.toLowerCase());
}
