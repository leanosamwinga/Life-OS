import {
  batchTotals,
  COOKED_RATIOS,
  estimateCookedWeight,
  formatGrams,
  type BatchIngredient,
  type Macros,
} from '@life-os/core';
import type { DraftComponent } from './LogMealContext';

export type IngredientStatus = 'same' | 'changed' | 'new';

export interface CookAgainDiff {
  /** Changed, added and removed ingredients. */
  changed: number;
  status: Map<string, IngredientStatus>;
  removed: BatchIngredient[];
  /** One change in words ("Test eggs, large 120 g → 60 g."), or a count. `null` when none. */
  summary: string | null;
  /** Last time's whole batch and estimate, for "Was …". */
  was: { totals: Macros; estimatedG: number };
}

/** 7g: how this pot differs from last time's, ingredient by ingredient. */
export function diffCookAgain(
  original: readonly BatchIngredient[],
  components: readonly DraftComponent[],
): CookAgainDiff {
  const status = new Map<string, IngredientStatus>();
  const lines: string[] = [];
  for (const c of components) {
    if (!c.origin) {
      status.set(c.key, 'new');
      lines.push(`Added ${c.food.name}.`);
    } else if (c.origin.grams !== c.grams) {
      status.set(c.key, 'changed');
      lines.push(`${c.food.name} ${formatGrams(c.origin.grams)} → ${formatGrams(c.grams)}.`);
    } else if (c.cooksAs && c.origin.cooksAs !== c.cooksAs) {
      status.set(c.key, 'changed');
      lines.push(
        c.cooksAs === 'as_added'
          ? `${c.food.name} now counts as added.`
          : `${c.food.name} now counts as ${COOKED_RATIOS[c.cooksAs].label}.`,
      );
    } else status.set(c.key, 'same');
  }
  // Components with an origin came from `original` in order; anything not kept was removed.
  const keptFoods = components.filter((c) => c.origin).map((c) => c.food.id);
  const removed: BatchIngredient[] = [];
  const pool = [...keptFoods];
  for (const o of original) {
    const i = pool.indexOf(o.food.id);
    if (i >= 0) pool.splice(i, 1);
    else removed.push(o);
  }
  for (const r of removed) lines.push(`Took out ${r.food.name}.`);
  const changed = lines.length;
  return {
    changed,
    status,
    removed,
    summary: changed === 0 ? null : changed === 1 ? lines[0]! : `${changed} ingredients changed.`,
    was: { totals: batchTotals(original), estimatedG: estimateCookedWeight(original) },
  };
}
