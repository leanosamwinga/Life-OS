import { formatGrams, roundGrams } from '@life-os/core';

/** Quick amounts: last time, then serving / half pack / whole pack when known, else round numbers. */
export function amountChips(
  food: { packGrams?: number | null; servingGrams?: number | null },
  last: number | null,
): { label: string; grams: number }[] {
  const chips: { label: string; grams: number }[] = [];
  if (last != null) chips.push({ label: `Last time · ${formatGrams(last)}`, grams: last });
  if (food.servingGrams)
    chips.push({ label: `Serving · ${formatGrams(food.servingGrams)}`, grams: food.servingGrams });
  if (food.packGrams) {
    const half = roundGrams(food.packGrams / 2);
    if (half !== food.servingGrams)
      chips.push({ label: `Half pack · ${formatGrams(half)}`, grams: half });
    chips.push({ label: `Whole pack · ${formatGrams(food.packGrams)}`, grams: food.packGrams });
  }
  if (!food.servingGrams && !food.packGrams) {
    for (const g of [50, 100, 150]) chips.push({ label: formatGrams(g), grams: g });
  }
  // Drop duplicates by grams (e.g. last time = serving), keeping the first label.
  return chips.filter((c, i) => chips.findIndex((d) => d.grams === c.grams) === i);
}
