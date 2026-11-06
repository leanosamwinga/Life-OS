import { amountChips } from './amounts';

describe('how-much amount chips', () => {
  it('offers last time, half and whole pack for a 120 g pouch', () => {
    expect(amountChips({ packGrams: 120 }, 60).map((c) => c.label)).toEqual([
      'Last time · 60 g',
      'Whole pack · 120 g',
    ]);
    expect(amountChips({ packGrams: 120, servingGrams: 30 }, null).map((c) => c.label)).toEqual([
      'Serving · 30 g',
      'Half pack · 60 g',
      'Whole pack · 120 g',
    ]);
  });

  it('falls back to round amounts when sizes are unknown', () => {
    expect(amountChips({}, null).map((c) => c.grams)).toEqual([50, 100, 150]);
    expect(amountChips({}, 100).map((c) => c.label)).toEqual([
      'Last time · 100 g',
      '50 g',
      '150 g',
    ]);
  });
});
