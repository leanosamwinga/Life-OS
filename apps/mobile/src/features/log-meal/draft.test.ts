import { toFood } from '@life-os/core';
import { componentCount, discardQuestion, keptDraft, type KeepableDraft } from './draft';

const chicken = toFood({
  id: 'f1',
  userId: null,
  source: 'open_food_facts',
  barcode: null,
  name: 'Chicken breast, raw',
  brand: null,
  kcalPer100g: 106,
  proteinPer100g: 24,
  carbsPer100g: 0,
  fatPer100g: 1.2,
  fibrePer100g: null,
  sugarPer100g: null,
  saltPer100g: null,
})!;

const draft = (over: Partial<KeepableDraft> = {}): KeepableDraft => ({
  kind: 'meal',
  mode: 'log',
  name: '',
  components: [{ food: chicken, grams: 200 }],
  replaces: null,
  ...over,
});
const lunch = { name: 'Lunch', time: '12:30' } as const;

describe('7a-C kept draft', () => {
  it('keeps a meal being built with a component or a typed name', () => {
    expect(keptDraft(draft({ name: 'Chicken stir-fry' }), lunch)).toEqual({
      name: 'Chicken stir-fry',
      count: 1,
      kcal: 212,
    });
    // No name typed: the default for its time.
    expect(keptDraft(draft(), lunch)!.name).toBe('Lunch');
    expect(keptDraft(draft({ components: [], name: 'Soup' }), lunch)).toEqual({
      name: 'Soup',
      count: 0,
      kcal: 0,
    });
  });

  it('never keeps an empty draft, a batch, a roster edit or a corrected copy', () => {
    expect(keptDraft(draft({ components: [], name: '  ' }), lunch)).toBeNull();
    expect(keptDraft(draft({ kind: 'batch' }), lunch)).toBeNull();
    expect(keptDraft(draft({ mode: 'edit' }), lunch)).toBeNull();
    expect(keptDraft(draft({ replaces: 'log-1' }), lunch)).toBeNull();
  });

  it('asks “Discard …?” with how many components won’t be logged', () => {
    expect(discardQuestion({ name: 'Chicken stir-fry', count: 2, kcal: 472 })).toEqual({
      title: 'Discard Chicken stir-fry?',
      message: 'Its 2 components won’t be logged.',
    });
    expect(discardQuestion({ name: 'Soup', count: 1, kcal: 1 }).message).toBe(
      'Its 1 component won’t be logged.',
    );
    expect(discardQuestion({ name: 'Soup', count: 0, kcal: 0 }).message).toBe(
      'It has no components yet.',
    );
    expect(componentCount(3)).toBe('3 components');
  });
});
