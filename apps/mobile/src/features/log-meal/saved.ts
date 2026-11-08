/** Saved tab order (7a-S): starred first, then A–Z (case and accents ignored). */
export function sortSaved<T extends { name: string; starred: boolean }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(b.starred) - Number(a.starred) ||
      a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' }),
  );
}
