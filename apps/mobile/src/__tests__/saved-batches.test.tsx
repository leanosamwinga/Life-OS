/**
 * Log meal follow-up (wireframes "Log meal Saved & batches"): one test per wireframe state —
 * 7a-S (Plan & recent, Saved empty, Saved filled), 7b-R (default, save-only chosen), 7b-B,
 * 7f (building, estimated, weighed), 7g (unchanged, one ingredient changed), 7h (solid, liquid).
 */
import path from 'node:path';
import { Alert } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { snapshotComponents, type MealLog } from '@life-os/core';
import type { StoredFood } from '@/lib/backend/foods';
import { sortSaved } from '@/features/log-meal/saved';
import {
  createMemoryBackend,
  TEST_USER,
  type MemoryBackend,
  type MemoryState,
} from '@/test/memoryBackend';
import { FOODS, food, liveState } from '@/test/fixtures';

const APP_DIR = path.resolve(__dirname, '../app');

let mockBackend: MemoryBackend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));

beforeAll(() => {
  jest.useFakeTimers({ advanceTimers: true });
  jest.setSystemTime(new Date('2026-11-08T13:00:00Z')); // Sun 8 Nov, 13:00
});
afterAll(() => jest.useRealTimers());

const own = (
  id: string,
  name: string,
  per: [number, number, number, number],
  over: Partial<StoredFood> = {},
): StoredFood => ({
  id,
  userId: TEST_USER.id,
  source: 'user',
  barcode: null,
  name,
  brand: null,
  kcalPer100g: per[0],
  proteinPer100g: per[1],
  carbsPer100g: per[2],
  fatPer100g: per[3],
  fibrePer100g: null,
  sugarPer100g: null,
  saltPer100g: null,
  remembered: true,
  ...over,
});

// The egg fried rice of wireframes 7f–7h.
const ING = {
  rice: own('ing-rice', 'Sample rice, dry', [350, 7.0, 78.0, 0.6]),
  eggs: own('ing-eggs', 'Test eggs, large', [143, 12.6, 0.7, 9.5]),
  peas: own('ing-peas', 'Demo frozen peas', [77, 5.0, 10.0, 0.4]),
  oil: own('ing-oil', 'Sample vegetable oil', [900, 0, 0, 100]),
  soy: own('ing-soy', 'Example soy sauce', [60, 8.0, 6.0, 0]),
  lentils: own('ing-lentils', 'Red lentils', [330, 24, 50, 1.5]),
};
const EGG_FRIED_RICE = own('batch-efr', 'Egg fried rice', [136, 4.0, 23.2, 2.6], {
  batch: {
    cookedWeightG: 1310,
    weighed: true,
    cookedAt: '2026-11-08T12:00:00.000Z',
    starred: true,
  },
});
const LENTIL_SOUP = own('batch-soup', 'Lentil soup', [59, 3.7, 7.8, 1.1], {
  batch: {
    cookedWeightG: 1760,
    weighed: false,
    cookedAt: '2026-11-05T18:00:00.000Z',
    starred: false,
  },
});

function batchState(over: Partial<MemoryState> = {}): Partial<MemoryState> {
  const base = liveState();
  return {
    ...base,
    foods: [...base.foods!, ...Object.values(ING), EGG_FRIED_RICE, LENTIL_SOUP],
    savedMeals: base.savedMeals!.map((m) => (m.id === 'meal-snack' ? { ...m, starred: true } : m)),
    batchIngredients: {
      [EGG_FRIED_RICE.id]: [
        { foodId: ING.rice.id, grams: 360, cooksAs: 'rice' },
        { foodId: ING.eggs.id, grams: 120, cooksAs: 'as_added' },
        { foodId: ING.peas.id, grams: 200, cooksAs: 'as_added' },
        { foodId: ING.oil.id, grams: 20, cooksAs: 'as_added' },
        { foodId: ING.soy.id, grams: 30, cooksAs: 'as_added' },
      ],
      [LENTIL_SOUP.id]: [{ foodId: ING.lentils.id, grams: 400, cooksAs: 'lentils' }],
    },
    lastPortions: {
      ...base.lastPortions,
      [EGG_FRIED_RICE.id]: { grams: 350, loggedAt: '2026-11-08T12:30:00.000Z' },
      [LENTIL_SOUP.id]: { grams: 300, loggedAt: '2026-11-06T12:30:00.000Z' },
    },
    ...over,
  };
}

async function start(init: Partial<MemoryState>, url = '/log-meal') {
  mockBackend = createMemoryBackend(init);
  await renderRouter(APP_DIR, { initialUrl: url });
  await screen.findByTestId(/^screen-/);
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const pressTab = (name: string) => fireEvent.press(screen.getByRole('tab', { name }));
const starLabels = () =>
  screen
    .getAllByRole('button', { name: /: (not )?starred$/ })
    .map((b) => b.props.accessibilityLabel as string);

async function openSaved() {
  await screen.findByText('Protein shake');
  await pressTab('Saved');
  await screen.findByText('Search saved meals and batches', { exact: false }).catch(() => null);
}

/** Add an ingredient in the batch builder through Search → "how much". */
async function addIngredient(query: string, name: string, grams: string, button: RegExp) {
  await press('Search to add an ingredient');
  await screen.findByTestId('screen-add-component');
  expect(screen.getByText('Add ingredient')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Search foods'), query);
  await screen.findByRole('button', { name: `Add ${name}` });
  await press(`Add ${name}`);
  await screen.findByTestId('screen-how-much');
  await fireEvent.changeText(screen.getByLabelText('Grams'), grams);
  await press(button);
  await screen.findByTestId('screen-batch-builder');
}

describe('sortSaved', () => {
  it('starred first, then A–Z ignoring case', () => {
    expect(
      sortSaved([
        { name: 'salmon', starred: false },
        { name: 'Zesty', starred: true },
        { name: 'apple', starred: false },
        { name: 'Bowl', starred: true },
      ]).map((i) => i.name),
    ).toEqual(['Bowl', 'Zesty', 'apple', 'salmon']);
  });
});

describe('7a-S Log meal tabs', () => {
  it('Plan & recent: the existing list, with "+ Cooked a batch" beside "+ Build a meal"', async () => {
    await start(batchState());
    await screen.findByText('Protein shake');
    expect(screen.getByRole('tab', { name: 'Plan & recent' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByLabelText('Search your meals and foods')).toBeTruthy();
    expect(screen.getByText('YOUR ROSTER', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log again: Chicken stir-fry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Build a meal from scratch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Cooked a batch' })).toBeTruthy();
    expect(
      screen.getByText('A batch is one pot you cook once, then log by the gram.'),
    ).toBeTruthy();
  });

  it('Saved — empty: "Nothing saved yet" and both ways to start', async () => {
    await start(liveState({ savedMeals: [] }));
    await screen.findByText('Log again: Chicken stir-fry'.slice(11)).catch(() => null);
    await pressTab('Saved');
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy();
    expect(
      screen.getByText(
        'Meals you save to your roster and batches you cook show up here. Star one to keep it at the top.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Search saved meals and batches')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Cooked a batch' })).toBeTruthy();
  });

  it('Saved — filled: meals and batches together, starred first then A–Z, star toggles', async () => {
    await start(batchState());
    await openSaved();
    expect(screen.getByLabelText('Search saved meals and batches')).toBeTruthy();
    expect(starLabels()).toEqual([
      'Egg fried rice: starred',
      'Snack · yoghurt bowl: starred',
      'Breakfast · oats: not starred',
      'Dinner · chicken & rice: not starred',
      'Lentil soup: not starred',
      'Protein shake: not starred',
    ]);
    expect(screen.getByText('STARRED')).toBeTruthy();
    expect(screen.getByText('A–Z')).toBeTruthy();
    expect(screen.getByText('136 kcal per 100 g · cooked Sun 8 Nov')).toBeTruthy();
    expect(screen.getByText('59 kcal per 100 g · cooked Thu 5 Nov')).toBeTruthy();
    expect(screen.getByText('In plan · 18:15 · 472 kcal · P 53')).toBeTruthy();
    expect(screen.getByText('1 component · 171 kcal · P 30')).toBeTruthy();
    expect(screen.getAllByLabelText('batch')).toHaveLength(2);
    expect(screen.getByText('Tap a meal to edit it. Tap a batch to cook it again.')).toBeTruthy();

    // Star the soup, unstar the bowl: the order follows, and it's saved.
    await press('Lentil soup: not starred');
    await press('Snack · yoghurt bowl: starred');
    await waitFor(() =>
      expect(starLabels().slice(0, 3)).toEqual([
        'Egg fried rice: starred',
        'Lentil soup: starred',
        'Breakfast · oats: not starred',
      ]),
    );
    expect(mockBackend.state.foods.find((f) => f.id === LENTIL_SOUP.id)!.batch!.starred).toBe(true);
    expect(mockBackend.state.savedMeals.find((m) => m.id === 'meal-snack')!.starred).toBe(false);

    // Search filters both kinds.
    await fireEvent.changeText(screen.getByLabelText('Search saved meals and batches'), 'rice');
    await waitFor(() => expect(screen.queryByText('Lentil soup')).toBeNull());
    expect(screen.getByText('Egg fried rice')).toBeTruthy();
    expect(screen.getByText('Dinner · chicken & rice')).toBeTruthy();
  });

  it('Saved: "Log" on a meal logs it; tapping a meal opens it for editing', async () => {
    await start(batchState());
    await openSaved();
    await press('Edit Protein shake');
    expect(await screen.findByTestId('screen-build-meal')).toBeTruthy();
    expect(screen.getByText('Edit meal')).toBeTruthy();
  });

  it('a failed star goes back and says why', async () => {
    await start(batchState());
    await openSaved();
    mockBackend.failNext('setStarred', new Error('Health data is off.'));
    await press('Protein shake: not starred');
    expect(await screen.findByText('Health data is off.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Protein shake: not starred' })).toBeTruthy();
  });
});

describe('7b-R Build meal — save without logging', () => {
  it('default: "Save to roster only" sits under "Done · log meal"', async () => {
    await start(liveState());
    await screen.findByText('Protein shake');
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    await press('Add Chicken breast, raw, 150 g');
    expect(screen.getByText('Breakfast · 08:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done · log meal (159 kcal)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save to roster only' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Save to my roster' })).toBeTruthy();
  });

  it('save-only chosen: plan switch and usual time; saves through save_meal and logs nothing', async () => {
    await start(liveState());
    await screen.findByText('Protein shake');
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Chicken stir-fry');
    await press('Add Chicken breast, raw, 150 g');
    await press('Add Basmati rice, cooked, 100 g');
    const logsBefore = mockBackend.state.mealLogs.length;

    await press('Save to roster only');
    expect(screen.getByText('Not logging')).toBeTruthy();
    expect(screen.getByText('Not added to today. Log it from Saved when you eat it.')).toBeTruthy();
    expect(screen.queryByLabelText(/^Today after this meal/)).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Save to my roster' })).toBeNull();
    // "Log it instead" goes back to 7b-R default.
    await press('Log it instead');
    expect(screen.getByRole('button', { name: 'Done · log meal (289 kcal)' })).toBeTruthy();
    await press('Save to roster only');

    await fireEvent(screen.getByRole('switch', { name: 'In my daily plan' }), 'valueChange', true);
    expect(screen.getByText('Shows on Today at its usual time, with “Ate it”')).toBeTruthy();
    expect(screen.getByLabelText('Usual time (24-hour)').props.value).toBe('08:00');
    await fireEvent.changeText(screen.getByLabelText('Usual time (24-hour)'), '19:00');
    await press('Save meal');

    // Back on 7a, Saved tab, with the new meal; nothing logged.
    expect(await screen.findByText('Chicken stir-fry')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Saved' }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(mockBackend.state.calls).not.toContain('logMeal');
    expect(mockBackend.state.mealLogs).toHaveLength(logsBefore);
    expect(mockBackend.state.savedMeals.find((m) => m.name === 'Chicken stir-fry')).toMatchObject({
      inDailyPlan: true,
      usualTime: '19:00',
      components: [
        { foodId: FOODS.chicken.id, grams: 150 },
        { foodId: FOODS.rice.id, grams: 100 },
      ],
    });
  });
});

describe('7b-B Build meal — a batch as a component', () => {
  it('batches are suggested and searchable like any food, with the BATCH tag, and log by the gram', async () => {
    await start(batchState());
    await screen.findByText('Protein shake');
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Rice & chicken');
    expect(
      screen.getByText('Your batches show up in suggestions and search, like any food.'),
    ).toBeTruthy();
    await press('Add Egg fried rice, 350 g');
    await press('Add Porridge oats, 80 g');
    expect(screen.getByText('COMPONENTS · 2 ADDED')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Egg fried rice, 350 g. Change amount' }),
    ).toBeTruthy();
    expect(screen.getAllByLabelText('batch').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('476 kcal · P 14.0 · C 81.2 · F 9.1')).toBeTruthy();
    await press('Done · log meal (776 kcal)');
    await screen.findByTestId('screen-today');
    const log = mockBackend.state.mealLogs.at(-1)!;
    expect(log.items[0]).toMatchObject({ foodId: EGG_FRIED_RICE.id, grams: 350 });
    expect(log.items[0]!.macros).toEqual({ kcal: 476, protein: 14, carbs: 81.2, fat: 9.1 });
  });
});

describe('7f Batch builder', () => {
  it('building → estimated → weighed, then "Save batch only" puts it in Saved', async () => {
    await start(batchState());
    await screen.findByText('Protein shake');
    await press('+ Cooked a batch');
    await screen.findByTestId('screen-batch-builder');
    expect(screen.getByText('New batch')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Batch name'), 'Egg fried rice 2');

    // building
    expect(screen.getByText('Add amounts as they go in the pot: dry rice, raw meat.')).toBeTruthy();
    await addIngredient('Sample rice', 'Sample rice, dry', '360', /^Add ingredient · 1,260 kcal$/);
    await addIngredient('eggs', 'Test eggs, large', '120', /^Add ingredient · 172 kcal$/);
    expect(screen.getByText('INGREDIENTS · 2 ADDED')).toBeTruthy();
    expect(screen.getByText('BATCH SO FAR')).toBeTruthy();
    expect(screen.getByLabelText('About 1,020 g so far')).toBeTruthy();
    expect(screen.getByText('Updates as you add ingredients.')).toBeTruthy();
    expect(screen.queryByLabelText('I weighed it, whole pot in grams, optional')).toBeNull();

    // estimated
    await addIngredient('peas', 'Demo frozen peas', '200', /^Add ingredient · 154 kcal$/);
    await addIngredient('oil', 'Sample vegetable oil', '20', /^Add ingredient · 180 kcal$/);
    await addIngredient('soy', 'Example soy sauce', '30', /^Add ingredient · 18 kcal$/);
    expect(screen.getByText('INGREDIENTS · 5 ADDED')).toBeTruthy();
    expect(
      screen.getByLabelText(/^Whole batch: 1,784 kcal · P 52.7 · C 303.4 · F 34.4/),
    ).toBeTruthy();
    expect(screen.getByLabelText('About 1,270 g, estimated')).toBeTruthy();
    expect(screen.getByTestId('how-we-worked-it-out').props.children.join('')).toContain(
      'dry rice × 2.5 (it soaks up water), the rest as added.',
    );
    expect(screen.getByTestId('per-100g').props.children).toBe(
      'Per 100 g cooked: 140 kcal · P 4.1 · C 23.9 · F 2.7',
    );

    // weighed
    await fireEvent.changeText(
      screen.getByLabelText('I weighed it, whole pot in grams, optional'),
      '1310',
    );
    expect(screen.getByLabelText('1,310 g, weighed')).toBeTruthy();
    expect(screen.getByText('Clear it to go back to the estimate.')).toBeTruthy();
    expect(screen.getByTestId('per-100g').props.children).toBe(
      'Per 100 g cooked: 136 kcal · P 4.0 · C 23.2 · F 2.6',
    );
    // cleared → back to the estimate
    await fireEvent.changeText(
      screen.getByLabelText('I weighed it, whole pot in grams, optional'),
      '',
    );
    expect(screen.getByLabelText('About 1,270 g, estimated')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('I weighed it, whole pot in grams, optional'),
      '1310',
    );

    await press('Save batch only');
    expect(await screen.findByText('Egg fried rice 2')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Saved' }).props.accessibilityState).toEqual({
      selected: true,
    });
    const saved = mockBackend.state.foods.find((f) => f.name === 'Egg fried rice 2')!;
    expect(saved).toMatchObject({
      kcalPer100g: 136,
      proteinPer100g: 4,
      carbsPer100g: 23.2,
      fatPer100g: 2.6,
      batch: { cookedWeightG: 1310, weighed: true, starred: false },
    });
    expect(mockBackend.state.batchIngredients[saved.id]!.map((i) => i.cooksAs)).toEqual([
      'rice',
      'as_added',
      'as_added',
      'as_added',
      'as_added',
    ]);
    expect(mockBackend.state.calls).not.toContain('logMeal');
  });

  it('the ratio is visible and correctable per ingredient; a batch can’t go in a batch', async () => {
    await start(batchState());
    await screen.findByText('Protein shake');
    await press('+ Cooked a batch');
    await fireEvent.changeText(screen.getByLabelText('Batch name'), 'Plain rice');
    await press('Search to add an ingredient');
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'rice');
    await screen.findByRole('button', { name: 'Add Sample rice, dry' });
    expect(screen.queryByRole('button', { name: 'Add Egg fried rice' })).toBeNull();
    await press('Add Sample rice, dry');
    await screen.findByTestId('screen-how-much');
    expect(screen.getByText('IN THE POT')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dry rice × 2.5' }).props.accessibilityState).toEqual(
      { selected: true },
    );
    await fireEvent.changeText(screen.getByLabelText('Grams'), '200');
    await press('Add ingredient · 700 kcal');
    await screen.findByTestId('screen-batch-builder');
    expect(screen.getByLabelText('About 500 g so far')).toBeTruthy();

    // It was already cooked: mark it "as added".
    await press('Sample rice, dry, 200 g. Change amount');
    await screen.findByTestId('screen-how-much');
    await press('As added');
    await press('Update ingredient · 700 kcal');
    await screen.findByTestId('screen-batch-builder');
    expect(screen.getByLabelText('About 200 g so far')).toBeTruthy();
  });

  it('"Save and log some" saves, then 7h logs some of it', async () => {
    await start(batchState());
    await screen.findByText('Protein shake');
    await press('+ Cooked a batch');
    await fireEvent.changeText(screen.getByLabelText('Batch name'), 'Lentil dal');
    await addIngredient('lentils', 'Red lentils', '400', /^Add ingredient · 1,320 kcal$/);
    await press('Save and log some');
    expect(await screen.findByTestId('screen-how-much-batch')).toBeTruthy();
    expect(screen.getByText('Your batch · cooked Sun 8 Nov · ≈ 1,000 g estimated')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Grams or millilitres'), '250');
    await press('Log it · 330 kcal');
    await screen.findByTestId('screen-today');
    const batch = mockBackend.state.foods.find((f) => f.name === 'Lentil dal')!;
    expect(mockBackend.state.mealLogs.at(-1)!.items[0]).toMatchObject({
      foodId: batch.id,
      grams: 250,
      macros: { kcal: 330, protein: 24, carbs: 50, fat: 1.5 },
    });
  });

  it('refuses an impossible weighed value with the reason', async () => {
    await start(batchState());
    await screen.findByText('Protein shake');
    await press('+ Cooked a batch');
    await fireEvent.changeText(screen.getByLabelText('Batch name'), 'Too light');
    await addIngredient('Sample rice', 'Sample rice, dry', '360', /^Add ingredient/);
    await addIngredient('eggs', 'Test eggs, large', '120', /^Add ingredient/);
    await addIngredient('peas', 'Demo frozen peas', '200', /^Add ingredient/);
    await fireEvent.changeText(
      screen.getByLabelText('I weighed it, whole pot in grams, optional'),
      '100',
    );
    expect(screen.getByTestId('per-100g').props.children).toBe(
      'That’s lighter than what went in the pot. Check the scales.',
    );
    expect(
      screen.getByRole('button', { name: 'Save and log some' }).props.accessibilityState.disabled,
    ).toBe(true);
  });
});

describe('7g Cook again', () => {
  const pastLog: MealLog = {
    id: 'log-efr',
    userId: TEST_USER.id,
    savedMealId: null,
    name: 'Egg fried rice',
    loggedAt: '2026-11-08T12:30:00.000Z',
    items: snapshotComponents([{ food: food(EGG_FRIED_RICE), grams: 350 }]),
  };

  it('unchanged: last time’s ingredients pre-filled, the weighed field starts empty', async () => {
    await start(batchState());
    await openSaved();
    await press('Cook Egg fried rice again');
    await screen.findByTestId('screen-cook-again');
    expect(screen.getByText('‹ Saved')).toBeTruthy();
    expect(screen.getByText('Cook again')).toBeTruthy();
    expect(screen.getByText('Last cooked Sun 8 Nov · weighed 1,310 g')).toBeTruthy();
    expect(screen.getByText('INGREDIENTS · SAME AS LAST TIME')).toBeTruthy();
    expect(screen.getByText('Sample rice, dry · 360 g')).toBeTruthy();
    expect(screen.getByText('Tap one to change the amount. Add or remove below.')).toBeTruthy();
    expect(screen.getByLabelText(/^Whole batch: 1,784 kcal/)).toBeTruthy();
    expect(screen.getByLabelText('About 1,270 g, estimated')).toBeTruthy();
    expect(screen.getByText('Last time you weighed 1,310 g.')).toBeTruthy();
    expect(screen.getByLabelText('I weighed it, whole pot in grams, optional').props.value).toBe(
      '',
    );
    expect(screen.getByRole('button', { name: 'Save batch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save and log some' })).toBeTruthy();
  });

  it('one ingredient changed: totals and per-100 g recalculate; logged meals keep their numbers', async () => {
    await start(batchState({ mealLogs: [...liveState().mealLogs!, pastLog] }));
    await openSaved();
    await press('Cook Egg fried rice again');
    await screen.findByTestId('screen-cook-again');
    await press(/^Test eggs, large · 120 g\. Change amount$/);
    await screen.findByTestId('screen-how-much');
    await fireEvent.changeText(screen.getByLabelText('Grams'), '60');
    await press('Update ingredient · 86 kcal');
    await screen.findByTestId('screen-cook-again');

    expect(screen.getByText('INGREDIENTS · 1 CHANGED')).toBeTruthy();
    expect(screen.getByText('Test eggs, large · 120 g → 60 g')).toBeTruthy();
    expect(screen.getByText('60 g (was 120 g) · 86 kcal · P 7.6 · C 0.4 · F 5.7')).toBeTruthy();
    expect(screen.getByText('Meals you’ve already logged keep last time’s numbers.')).toBeTruthy();
    expect(
      screen.getByLabelText(/^Whole batch: 1,698 kcal · P 45.2 · C 303.0 · F 28.7/),
    ).toBeTruthy();
    expect(screen.getByText('Was 1,784 kcal · P 52.7 · C 303.4 · F 34.4')).toBeTruthy();
    expect(screen.getByLabelText('About 1,210 g, estimated')).toBeTruthy();
    expect(screen.getByText('Was ≈ 1,270 g. Test eggs, large 120 g → 60 g.')).toBeTruthy();
    expect(screen.getByTestId('per-100g').props.children).toBe(
      'Per 100 g cooked: 140 kcal · P 3.7 · C 25.0 · F 2.4',
    );

    await press('Save batch');
    await screen.findByText('Lentil soup');
    const rec = mockBackend.state.foods.find((f) => f.id === EGG_FRIED_RICE.id)!;
    expect(rec).toMatchObject({
      kcalPer100g: 140,
      proteinPer100g: 3.7,
      batch: { cookedWeightG: 1210, weighed: false, starred: true },
    });
    // History is untouched.
    expect(mockBackend.state.mealLogs.find((l) => l.id === 'log-efr')!.items[0]!.macros).toEqual({
      kcal: 476,
      protein: 14,
      carbs: 81.2,
      fat: 9.1,
    });
  });

  it('an ingredient can be taken out from its "how much" screen; the batch can be deleted', async () => {
    await start(batchState());
    await openSaved();
    await press('Cook Lentil soup again');
    await screen.findByTestId('screen-cook-again');
    await press('Search to add an ingredient');
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'peas');
    await screen.findByRole('button', { name: 'Add Demo frozen peas' });
    await press('Add Demo frozen peas');
    await fireEvent.changeText(screen.getByLabelText('Grams'), '100');
    await press('Add ingredient · 77 kcal');
    await screen.findByTestId('screen-cook-again');
    expect(screen.getByText('INGREDIENTS · 1 CHANGED')).toBeTruthy();
    await press(/^Red lentils · 400 g\. Change amount$/);
    await fireEvent.press(screen.getByRole('link', { name: 'Remove from batch' }));
    await screen.findByTestId('screen-cook-again');
    expect(screen.getByText('INGREDIENTS · 2 CHANGED')).toBeTruthy();
    expect(screen.queryByText('Red lentils · 400 g')).toBeNull();

    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      (args[2] as { text: string; onPress?: () => void }[])
        .find((b) => b.text === 'Delete')
        ?.onPress?.();
    });
    await fireEvent.press(screen.getByRole('link', { name: 'Delete batch' }));
    await waitFor(() => expect(screen.queryByText('Lentil soup')).toBeNull());
    expect(mockBackend.state.foods.find((f) => f.id === LENTIL_SOUP.id)).toBeUndefined();
  });
});

describe('7h How much — a batch on its own', () => {
  it('solid: grams with last time, per-100 g maths, "Log it"', async () => {
    await start(batchState());
    await openSaved();
    await press('Log Egg fried rice');
    await screen.findByTestId('screen-how-much-batch');
    expect(screen.getByText('‹ Egg fried rice')).toBeTruthy();
    expect(screen.getByText('Breakfast · 08:00')).toBeTruthy();
    expect(screen.getByText('Your batch · cooked Sun 8 Nov · weighed 1,310 g')).toBeTruthy();
    expect(screen.getByText('Per 100 g: 136 kcal · P 4.0 · C 23.2 · F 2.6')).toBeTruthy();
    expect(screen.getByLabelText('Grams or millilitres').props.value).toBe('350');
    expect(screen.getByRole('button', { name: 'Last time · 350 g' })).toBeTruthy();
    expect(screen.getByText('g (or ml)')).toBeTruthy();
    expect(
      screen.getByText(/350 g × per-100 g values ÷ 100 · weigh what’s on your plate/),
    ).toBeTruthy();
    expect(screen.getByLabelText('Today after this: 476 / 2,450 kcal')).toBeTruthy();
    await press('Log it · 476 kcal');
    await screen.findByTestId('screen-today');
    expect(mockBackend.state.mealLogs.at(-1)).toMatchObject({
      name: 'Egg fried rice',
      savedMealId: null,
      loggedAt: '2026-11-08T08:00:00.000Z',
    });
  });

  it('liquid: "1 ml counts as 1 g"; "Add to a meal instead" opens 7b with it', async () => {
    await start(batchState());
    await openSaved();
    await press('Log Lentil soup');
    await screen.findByTestId('screen-how-much-batch');
    expect(screen.getByText('Your batch · cooked Thu 5 Nov · ≈ 1,760 g estimated')).toBeTruthy();
    expect(screen.getByText(/300 g × per-100 g values ÷ 100 · 1 ml counts as 1 g/)).toBeTruthy();
    expect(
      screen.getByLabelText(/^177 kcal, protein 11.1 g, carbs 23.4 g, fat 3.3 g$/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log it · 177 kcal' })).toBeTruthy();
    await press('Add to a meal instead');
    await screen.findByTestId('screen-build-meal');
    expect(screen.getByText('Lentil soup')).toBeTruthy();
    expect(screen.getByText(' · 300 g', { exact: false })).toBeTruthy();
  });
});

describe('consent', () => {
  it('consent off: no Saved tab, no batches loaded', async () => {
    await start(batchState({ healthConsent: false }));
    expect(await screen.findByTestId('screen-log-meal-consent-off')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Saved' })).toBeNull();
    expect(mockBackend.state.calls).not.toContain('listBatches');
  });
});
