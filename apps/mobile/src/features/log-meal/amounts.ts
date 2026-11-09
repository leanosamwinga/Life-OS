import { formatAmount, packWord, roundGrams, type AmountUnit } from '@life-os/core';

export interface AmountChip {
  label: string;
  grams: number;
  unit: AmountUnit;
}

/**
 * Quick amounts: last time (in the unit it was logged in), then serving / half / whole pack in
 * the food's unit when known ("Half bottle · 165 ml" for a drink), else round numbers.
 */
export function amountChips(
  food: { packGrams?: number | null; servingGrams?: number | null; unit?: AmountUnit },
  last: { grams: number; unit: AmountUnit } | number | null,
): AmountChip[] {
  const unit = food.unit ?? 'g';
  const word = packWord(unit);
  const chips: AmountChip[] = [];
  const lastP = typeof last === 'number' ? { grams: last, unit } : last;
  if (lastP)
    chips.push({
      label: `Last time · ${formatAmount(lastP.grams, lastP.unit)}`,
      grams: lastP.grams,
      unit: lastP.unit,
    });
  if (food.servingGrams)
    chips.push({
      label: `Serving · ${formatAmount(food.servingGrams, unit)}`,
      grams: food.servingGrams,
      unit,
    });
  if (food.packGrams) {
    const half = roundGrams(food.packGrams / 2);
    if (half !== food.servingGrams)
      chips.push({ label: `Half ${word} · ${formatAmount(half, unit)}`, grams: half, unit });
    chips.push({
      label: `Whole ${word} · ${formatAmount(food.packGrams, unit)}`,
      grams: food.packGrams,
      unit,
    });
  }
  if (!food.servingGrams && !food.packGrams) {
    for (const g of [50, 100, 150]) chips.push({ label: formatAmount(g, unit), grams: g, unit });
  }
  // Drop duplicates by amount (e.g. last time = serving), keeping the first label.
  return chips.filter((c, i) => chips.findIndex((d) => d.grams === c.grams) === i);
}
