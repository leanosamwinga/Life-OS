import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatGrams,
  formatKcal,
  formatKg,
  formatMl,
  formatPence,
  parsePounds,
  pence,
} from './format.ts';
import { formatDateUK, formatTimeUK, isWithinWindow, toLondonDate } from './time.ts';

describe('formatPence', () => {
  it('formats negative balances with a true minus sign', () => {
    expect(formatPence(-62840)).toBe('−£628.40');
  });

  it('formats thousands with commas', () => {
    expect(formatPence(3278007)).toBe('£32,780.07');
    expect(formatPence(123456)).toBe('£1,234.56');
  });

  it('handles small and zero amounts', () => {
    expect(formatPence(0)).toBe('£0.00');
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(-1)).toBe('−£0.01');
  });

  it('rejects non-integer pence', () => {
    expect(() => formatPence(12.5)).toThrow(RangeError);
  });
});

describe('pence / parsePounds', () => {
  it('parses pounds strings to integer pence without floats', () => {
    expect(parsePounds('1,234.56')).toBe(123456);
    expect(parsePounds('-628.40')).toBe(-62840);
    expect(parsePounds('£0.1')).toBe(10);
    expect(parsePounds('19.99')).toBe(1999);
  });

  it('pence() rejects non-integers', () => {
    expect(() => pence(0.1 + 0.2)).toThrow(RangeError);
    expect(pence(100)).toBe(100);
  });
});

describe('quantity formatting', () => {
  it('formats grams', () => {
    expect(formatGrams(200)).toBe('200 g');
    expect(formatGrams(12.5)).toBe('12.5 g');
    expect(formatGrams(1200)).toBe('1,200 g');
    expect(formatGrams(0.04)).toBe('0 g');
  });

  it('formats kg, ml, kcal and counts', () => {
    expect(formatKg(82.4)).toBe('82.4 kg');
    expect(formatMl(250)).toBe('250 ml');
    expect(formatMl(1250)).toBe('1.25 L');
    expect(formatMl(3000)).toBe('3 L');
    expect(formatKcal(1320)).toBe('1,320');
    expect(formatCount(6240)).toBe('6,240');
  });
});

describe('dates and times (Europe/London)', () => {
  it('formats local dates like "Fri 6 Nov"', () => {
    expect(formatDateUK('2026-11-06')).toBe('Fri 6 Nov');
    expect(formatDateUK('2026-09-14')).toBe('Mon 14 Sep');
  });

  it('formats instants in London time', () => {
    expect(formatDateUK('2026-11-06T13:40:00Z')).toBe('Fri 6 Nov');
    // 23:30 UTC on 30 Jun is already Wed 1 Jul in London (BST).
    expect(formatDateUK(new Date('2026-06-30T23:30:00Z'))).toBe('Wed 1 Jul');
    expect(toLondonDate('2026-06-30T23:30:00Z')).toBe('2026-07-01');
    expect(formatTimeUK('2026-06-30T23:30:00Z')).toBe('00:30');
    expect(formatTimeUK('2026-11-06T13:40:00Z')).toBe('13:40');
  });

  it('checks windows that wrap midnight (quiet hours 22:30–07:00)', () => {
    expect(isWithinWindow('23:00', '22:30', '07:00')).toBe(true);
    expect(isWithinWindow('06:59', '22:30', '07:00')).toBe(true);
    expect(isWithinWindow('07:00', '22:30', '07:00')).toBe(false);
    expect(isWithinWindow('12:00', '22:30', '07:00')).toBe(false);
    expect(isWithinWindow('12:00', '09:00', '17:00')).toBe(true);
  });
});
