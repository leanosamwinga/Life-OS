import type { MoneyAmount } from './types.ts';
import { roundTo } from './nutrition.ts';

/** U+2212 MINUS SIGN, used for negative money as in the wireframes ("−£628.40"). */
export const MINUS = '−';

/** Group an integer string with commas: 1234567 → "1,234,567". */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Brand an integer number of pence as a `MoneyAmount`. Throws on non-integers. */
export function pence(value: number): MoneyAmount {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be a safe integer number of pence (got ${value})`);
  }
  return value as MoneyAmount;
}

/** Parse a pounds string like "1,234.56" or "-628.40" into integer pence without float maths. */
export function parsePounds(input: string): MoneyAmount {
  const m = /^\s*([-−])?\s*£?\s*([\d,]+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) throw new RangeError(`Not a pounds amount: ${input}`);
  const sign = m[1] ? -1 : 1;
  const pounds = Number((m[2] ?? '0').replace(/,/g, ''));
  const pennies = Number((m[3] ?? '0').padEnd(2, '0'));
  return pence(sign * (pounds * 100 + pennies));
}

/** "£1,234.56" / "−£628.40". Input is integer pence. */
export function formatPence(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`formatPence expects integer pence (got ${amount})`);
  }
  const abs = Math.abs(amount);
  const pounds = Math.floor(abs / 100);
  const pennies = abs % 100;
  const body = `£${groupThousands(String(pounds))}.${String(pennies).padStart(2, '0')}`;
  return amount < 0 ? `${MINUS}${body}` : body;
}

function trimNumber(value: number, dp: number): string {
  const rounded = roundTo(value, dp);
  const [whole = '0', frac] = Math.abs(rounded).toFixed(dp).split('.');
  const trimmedFrac = frac?.replace(/0+$/, '');
  const text = trimmedFrac ? `${groupThousands(whole)}.${trimmedFrac}` : groupThousands(whole);
  return rounded < 0 ? `${MINUS}${text}` : text;
}

/** "200 g", "12.5 g", "1,200 g". Up to 1 decimal place, trailing zeros trimmed. */
export function formatGrams(grams: number): string {
  return `${trimNumber(grams, 1)} g`;
}

/** Body weight, e.g. "82.4 kg". */
export function formatKg(kg: number): string {
  return `${trimNumber(kg, 1)} kg`;
}

/** Water: under a litre in ml ("250 ml"), otherwise litres to 2 dp ("1.25 L"). */
export function formatMl(ml: number): string {
  if (Math.abs(ml) < 1000) return `${trimNumber(ml, 0)} ml`;
  return `${trimNumber(ml / 1000, 2)} L`;
}

/** Whole kcal with thousands separator, e.g. "1,320". */
export function formatKcal(kcal: number): string {
  return trimNumber(kcal, 0);
}

/** Integer count with thousands separator, e.g. 6240 → "6,240". */
export function formatCount(n: number): string {
  return trimNumber(n, 0);
}
