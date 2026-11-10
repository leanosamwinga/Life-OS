import { sumMacros, type MealComponent } from '@life-os/core';
import { defaultMealName, type MealSlot } from './slots';

/** The parts of a draft that decide whether 7a offers it as "Continue" (7a-C). */
export interface KeepableDraft {
  kind: 'meal' | 'batch';
  mode: 'log' | 'edit';
  name: string;
  components: readonly MealComponent[];
  replaces: string | null;
}

/** What 7a-C's card shows for the meal being built, and what the discard question names. */
export interface KeptDraft {
  /** The typed name, else the default for its time ("Lunch"). */
  name: string;
  count: number;
  kcal: number;
}

/**
 * A meal being built to log (not a batch, not a roster edit, not a corrected copy) with at least
 * one component or a typed name is kept when going back to 7a. Anything else isn't offered.
 */
export function keptDraft(d: KeepableDraft, slot: MealSlot): KeptDraft | null {
  if (d.kind !== 'meal' || d.mode !== 'log' || d.replaces !== null) return null;
  if (d.components.length === 0 && !d.name.trim()) return null;
  return {
    name: d.name.trim() || defaultMealName(slot),
    count: d.components.length,
    kcal: sumMacros(d.components).kcal,
  };
}

/** "2 components", "1 component". */
export const componentCount = (n: number): string => `${n} component${n === 1 ? '' : 's'}`;

/** The question asked before a new start replaces the kept meal. */
export function discardQuestion(k: KeptDraft): { title: string; message: string } {
  return {
    title: `Discard ${k.name}?`,
    message:
      k.count === 0
        ? 'It has no components yet.'
        : `Its ${componentCount(k.count)} won’t be logged.`,
  };
}
