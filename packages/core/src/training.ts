import type { SplitDay, SplitRotation } from './types.ts';

/**
 * The next split day given how many sessions have been completed in the rotation.
 * Each synced workout advances the rotation by one; the user corrects it by adjusting
 * `completedCount`. Counts larger than one cycle wrap around.
 */
export function nextSplitDay(rotation: SplitRotation, completedCount: number): SplitDay {
  const n = rotation.days.length;
  if (n === 0) throw new RangeError('A split rotation needs at least one day');
  if (!Number.isInteger(completedCount) || completedCount < 0) {
    throw new RangeError(`completedCount must be a non-negative integer (got ${completedCount})`);
  }
  const day = rotation.days[completedCount % n];
  if (!day) throw new RangeError('Rotation index out of range');
  return day;
}

/** Build a rotation from day names, numbering them Day 1…n. */
export function makeRotation(names: readonly string[], targetPerWeek: number): SplitRotation {
  return { days: names.map((name, i) => ({ day: i + 1, name })), targetPerWeek };
}
