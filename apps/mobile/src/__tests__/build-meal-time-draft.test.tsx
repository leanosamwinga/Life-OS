/**
 * Build meal: set the time at any point, keep the draft (wireframes "Life OS — 7b time at any
 * point and keep the draft"): 7b-T2 (chip from Now, a slot and a custom time; none in edit-roster
 * or save-only), 7b-W (opened from the chip, a slot picked, greyed slots, Other time… → 7i,
 * Cancel), 7b-T2 time changed (Yesterday 21:15, bar on Sun 8 Nov), the corrected copy's chip and
 * bar, and 7a-C (the kept draft, Continue, asking before a new start, and when it's cleared).
 */
import path from 'node:path';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { Alert } from 'react-native';
import { snapshotComponents, type MealLog } from '@life-os/core';
import type { StoredFood } from '@/lib/backend/foods';
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

// The wireframes' moment: Mon 9 Nov 2026, 13:40 in London (GMT).
beforeAll(() => {
  jest.useFakeTimers({ advanceTimers: true });
  jest.setSystemTime(new Date('2026-11-09T13:40:00Z'));
});
afterAll(() => jest.useRealTimers());

const DRINK: StoredFood = {
  ...FOODS.yoghurt,
  id: 'food-07',
  barcode: '0000000000907',
  name: 'Sample oat drink',
  kcalPer100g: 46,
  proteinPer100g: 1,
  carbsPer100g: 6.5,
  fatPer100g: 1.5,
  nutritionUnit: 'ml',
};

const mealLog = (id: string, name: string, at: string, grams: number): MealLog => ({
  id,
  userId: TEST_USER.id,
  savedMealId: null,
  name,
  loggedAt: at,
  items: snapshotComponents([{ food: food(FOODS.oats), grams }]),
});
// Today 07:00 (225 kcal) and yesterday 19:00 (300 kcal).
const TODAY_OATS = mealLog('log-today', 'Sample oats', '2026-11-09T07:00:00.000Z', 60);
const YESTERDAY_OATS = mealLog(
  'log-yday',
  'Sample oats, yesterday',
  '2026-11-08T19:00:00.000Z',
  80,
);

function state(over: Partial<MemoryState> = {}): Partial<MemoryState> {
  const base = liveState();
  return {
    ...base,
    foods: [...base.foods!, DRINK],
    mealLogs: [...base.mealLogs!, TODAY_OATS, YESTERDAY_OATS],
    // The wireframe's amounts: chicken 200 g (212 kcal), rice 200 g (260 kcal), a drink in ml.
    lastPortions: {
      [FOODS.chicken.id]: { grams: 200, loggedAt: '2026-11-04T18:30:00.000Z' },
      [FOODS.rice.id]: { grams: 200, loggedAt: '2026-11-04T18:30:00.000Z' },
      [DRINK.id]: { grams: 250, unit: 'ml', loggedAt: '2026-11-04T18:30:00.000Z' },
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
const chip = () => screen.getByTestId('header-time');
const chipText = () => within(chip()).getByText(/▾$/).props.children as string;
const component = (label: string) =>
  screen.getByRole('button', { name: `${label}. Change amount` });

/** Answer the next "Discard …?" with Discard or Keep it, and remember what was asked. */
function answerDiscard(choice: 'Discard' | 'Keep it') {
  const asked: { title: string; message: string }[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    asked.push({ title: args[0] as string, message: args[1] as string });
    (args[2] as { text: string; onPress?: () => void }[])
      .find((b) => b.text === choice)
      ?.onPress?.();
  });
  return asked;
}

/** 7a → Now → Build meal with chicken and rice (472 kcal). */
async function buildStirFry(name = 'Chicken stir-fry') {
  await start(state());
  await screen.findByTestId('when-chips');
  await press('Now · 13:40');
  await press('+ Build a meal from scratch');
  await screen.findByTestId('screen-build-meal');
  if (name) await fireEvent.changeText(screen.getByLabelText('Meal name'), name);
  await press('Add Chicken breast, raw, 200 g');
  await press('Add Basmati rice, cooked, 200 g');
}

async function openWhen() {
  await fireEvent.press(chip());
  await screen.findByTestId('sheet-7b-w');
}

/** 7b-W → Other time… → 7i → Yesterday 21:15 → Done. */
async function pickYesterday2115() {
  await openWhen();
  await press('Other time');
  await screen.findByTestId('sheet-7i');
  await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
  await fireEvent.press(screen.getByTestId('wheel-hour-21'));
  await fireEvent.press(screen.getByTestId('wheel-minute-15'));
  await fireEvent.press(screen.getByTestId('time-done'));
  await waitFor(() => expect(screen.queryByTestId('sheet-7i')).toBeNull());
}

async function backTo7a() {
  await press('Back to Log meal');
  await screen.findByTestId('screen-log-meal');
}

describe('7b-T2: the time is always a chip in log mode', () => {
  it('from Now', async () => {
    await buildStirFry();
    expect(chipText()).toBe('Now · 13:40 ▾');
    expect(chip().props.accessibilityLabel).toBe('Time eaten: Now · 13:40. Change');
    expect(chip().props.accessibilityRole).toBe('button');
  });

  it('from a slot (the default on 7a, Breakfast · 08:00)', async () => {
    await start(state());
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    expect(chipText()).toBe('Breakfast · 08:00 ▾');
  });

  it('from a custom time picked on 7a', async () => {
    await start(state());
    await press('Other time');
    await screen.findByTestId('sheet-7i');
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-hour-21'));
    await fireEvent.press(screen.getByTestId('wheel-minute-15'));
    await fireEvent.press(screen.getByTestId('time-done'));
    // 7a's chip and 7b's chip read the same.
    expect(await screen.findByText('Yesterday · 21:15 ▾')).toBeTruthy();
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    expect(chipText()).toBe('Yesterday · 21:15 ▾');
  });

  it('no chip when editing a roster meal or saving to the roster only', async () => {
    await start(state());
    await press('Edit Protein shake');
    await screen.findByTestId('screen-build-meal');
    expect(screen.queryByTestId('header-time')).toBeNull();
    expect(screen.getByText('Edit meal')).toBeTruthy();

    await buildStirFry();
    await press('Save to roster only');
    expect(screen.queryByTestId('header-time')).toBeNull();
    expect(screen.getByText('Not logging')).toBeTruthy();
    // "Log it instead" brings the chip back.
    await press('Log it instead');
    expect(chipText()).toBe('Now · 13:40 ▾');
  });
});

describe('7b-W: Time eaten from Build meal', () => {
  it('opens from the chip with Now, the four slots and Other time…; nothing in the meal changes', async () => {
    await buildStirFry();
    await openWhen();
    const sheet = within(screen.getByTestId('sheet-7b-w'));
    expect(sheet.getByText('Time eaten')).toBeTruthy();
    expect(sheet.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(sheet.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
      'Cancel',
      'Now · 13:40',
      'Breakfast 08:00',
      'Lunch 12:30',
      'Snack 16:00, more than an hour from now',
      'Dinner 18:15, more than an hour from now',
      'Other time',
    ]);
    // The current choice has a ✓.
    expect(screen.getByTestId('when-now').props.accessibilityState.selected).toBe(true);
    expect(
      within(screen.getByTestId('when-now')).getByText('✓', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId('when-lunch')).queryByText('✓', { includeHiddenElements: true }),
    ).toBeNull();
    expect(screen.getByTestId('when-note').props.children).toBe(
      'Your meal stays as it is. Later slots are more than an hour away.',
    );
    expect(screen.getByLabelText('Meal name').props.value).toBe('Chicken stir-fry');
  });

  it('greyed slots can’t be chosen', async () => {
    await buildStirFry();
    await openWhen();
    expect(screen.getByTestId('when-snack').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('when-snack'));
    expect(screen.getByTestId('sheet-7b-w')).toBeTruthy();
    await press('Cancel');
    await waitFor(() => expect(screen.queryByTestId('sheet-7b-w')).toBeNull());
    expect(chipText()).toBe('Now · 13:40 ▾');
  });

  it('a slot picked closes the sheet; components, amounts, units and the name are kept', async () => {
    await start(state());
    await press('Now · 13:40');
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    await press('Add Chicken breast, raw, 200 g');
    await press('Add Sample oat drink, 250 ml');
    // No name typed: the placeholder follows the time.
    expect(screen.getByLabelText('Meal name').props.placeholder).toBe('Lunch');
    await openWhen();
    await press('Breakfast 08:00');
    await waitFor(() => expect(screen.queryByTestId('sheet-7b-w')).toBeNull());
    expect(chipText()).toBe('Breakfast · 08:00 ▾');
    expect(screen.getByLabelText('Meal name').props.placeholder).toBe('Breakfast');
    expect(component('Chicken breast, raw, 200 g')).toBeTruthy();
    expect(component('Sample oat drink, 250 ml')).toBeTruthy();
    expect(screen.getByText('Today after this meal')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Chicken & oat drink');
    await openWhen();
    expect(screen.getByTestId('when-breakfast').props.accessibilityState.selected).toBe(true);
    await press('Lunch 12:30');
    await waitFor(() => expect(screen.queryByTestId('sheet-7b-w')).toBeNull());
    expect(chipText()).toBe('Lunch · 12:30 ▾');
    expect(screen.getByLabelText('Meal name').props.value).toBe('Chicken & oat drink');
    expect(component('Sample oat drink, 250 ml')).toBeTruthy();
  });

  it('Other time… → 7i → Yesterday 21:15 → Done; logging lands on yesterday with the same components', async () => {
    await buildStirFry();
    expect(screen.getByLabelText('Today after this meal: 697 / 2,450 kcal')).toBeTruthy();
    await pickYesterday2115();
    expect(chipText()).toBe('Yesterday · 21:15 ▾');
    expect(chip().props.accessibilityLabel).toBe('Time eaten: Yesterday · 21:15. Change');
    // 300 kcal already on Sun 8 Nov + this meal.
    expect(screen.getByText('Sun 8 Nov after this meal')).toBeTruthy();
    expect(screen.getByLabelText('Sun 8 Nov after this meal: 772 / 2,450 kcal')).toBeTruthy();
    expect(screen.getByLabelText('Meal name').props.value).toBe('Chicken stir-fry');
    expect(component('Chicken breast, raw, 200 g')).toBeTruthy();
    expect(component('Basmati rice, cooked, 200 g')).toBeTruthy();

    // Reopening 7b-W shows Other time… as the current choice, and 7i opens on Sun 8 Nov.
    await openWhen();
    expect(screen.getByTestId('when-other').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('when-now').props.accessibilityState.selected).toBe(false);
    await press('Other time: Yesterday · 21:15');
    await screen.findByTestId('sheet-7i');
    expect(screen.getByTestId('time-chosen').props.children).toBe('Yesterday · Sun 8 Nov · 21:15');
    await press('Cancel');
    await waitFor(() => expect(screen.queryByTestId('sheet-7i')).toBeNull());

    await press('Done · log meal (472 kcal)');
    await screen.findByTestId('screen-today');
    const logged = mockBackend.state.mealLogs.at(-1)!;
    expect(logged).toMatchObject({
      name: 'Chicken stir-fry',
      loggedAt: '2026-11-08T21:15:00.000Z',
    });
    expect(logged.items.map((i) => [i.foodName, i.grams])).toEqual([
      ['Chicken breast, raw', 200],
      ['Basmati rice, cooked', 200],
    ]);
  });

  it('Cancel in 7b-W and Cancel in 7i change nothing', async () => {
    await buildStirFry();
    await openWhen();
    await press('Cancel');
    await waitFor(() => expect(screen.queryByTestId('sheet-7b-w')).toBeNull());
    expect(chipText()).toBe('Now · 13:40 ▾');

    await openWhen();
    await press('Other time');
    await screen.findByTestId('sheet-7i');
    expect(screen.queryByTestId('sheet-7b-w')).toBeNull();
    // From Now, 7i opens on Today at now.
    expect(screen.getByTestId('time-chosen').props.children).toBe('Today · Mon 9 Nov · 13:40');
    await fireEvent.press(screen.getByTestId('wheel-hour-09'));
    await press('Cancel');
    await waitFor(() => expect(screen.queryByTestId('sheet-7i')).toBeNull());
    expect(chipText()).toBe('Now · 13:40 ▾');
    expect(screen.getByText('Today after this meal')).toBeTruthy();
    expect(component('Basmati rice, cooked, 200 g')).toBeTruthy();
  });
});

describe('7b-T2 for a corrected copy', () => {
  it('keeps its chip; a new time moves the bar, which still leaves the original out', async () => {
    await start(state(), '/');
    await screen.findByTestId('open-log-today');
    await fireEvent.press(screen.getByTestId('open-log-today'));
    await screen.findByTestId('screen-7j');
    await fireEvent.press(screen.getByRole('link', { name: 'Log a corrected copy' }));
    await screen.findByTestId('screen-build-meal');
    expect(chipText()).toBe('Today · 07:00 ▾');
    // Today's 225 kcal is this meal: it isn't counted twice.
    expect(screen.getByLabelText('Today after this meal: 225 / 2,450 kcal')).toBeTruthy();

    await openWhen();
    expect(screen.getByTestId('when-other').props.accessibilityState.selected).toBe(true);
    await press('Now · 13:40');
    await waitFor(() => expect(screen.queryByTestId('sheet-7b-w')).toBeNull());
    expect(chipText()).toBe('Now · 13:40 ▾');
    expect(screen.getByLabelText('Today after this meal: 225 / 2,450 kcal')).toBeTruthy();

    await pickYesterday2115();
    expect(screen.getByLabelText('Sun 8 Nov after this meal: 525 / 2,450 kcal')).toBeTruthy();
    expect(screen.getByLabelText('Meal name').props.value).toBe('Sample oats');
    await press(/^Done · log corrected copy/);
    await screen.findByTestId('screen-today');
    expect(mockBackend.state.mealLogs.find((l) => l.id === 'log-today')).toBeUndefined();
    expect(mockBackend.state.mealLogs.find((l) => l.name === 'Sample oats')!.loggedAt).toBe(
      '2026-11-08T21:15:00.000Z',
    );
  });
});

describe('7a-C: keep the draft when going back', () => {
  it('going back with components shows the card; Continue returns to the same meal and time', async () => {
    await buildStirFry();
    await openWhen();
    await press('Lunch 12:30');
    await waitFor(() => expect(screen.queryByTestId('sheet-7b-w')).toBeNull());
    await backTo7a();

    const card = within(screen.getByTestId('kept-draft'));
    expect(card.getByText('NOT LOGGED YET')).toBeTruthy();
    expect(card.getByText('Chicken stir-fry')).toBeTruthy();
    expect(card.getByText('2 components · 472 kcal')).toBeTruthy();
    expect(screen.getByTestId('build-kept-note').props.children).toBe(
      'Starts a new meal. You’ll be asked before Chicken stir-fry is discarded.',
    );
    // 7a's WHEN row shows the meal's time.
    expect(
      screen.getByRole('button', { name: 'Lunch 12:30' }).props.accessibilityState.selected,
    ).toBe(true);

    await press('Continue your meal, Chicken stir-fry');
    await screen.findByTestId('screen-build-meal');
    expect(chipText()).toBe('Lunch · 12:30 ▾');
    expect(screen.getByLabelText('Meal name').props.value).toBe('Chicken stir-fry');
    expect(component('Chicken breast, raw, 200 g')).toBeTruthy();
    expect(component('Basmati rice, cooked, 200 g')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done · log meal (472 kcal)' })).toBeTruthy();
  });

  it('no name typed: the card uses the default name', async () => {
    await buildStirFry('');
    await backTo7a();
    expect(within(screen.getByTestId('kept-draft')).getByText('Lunch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue your meal, Lunch' })).toBeTruthy();
  });

  it('a typed name alone is kept; an empty draft is not', async () => {
    await start(state());
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    await backTo7a();
    expect(screen.queryByTestId('kept-draft')).toBeNull();
    expect(screen.queryByTestId('build-kept-note')).toBeNull();

    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Sample soup');
    await backTo7a();
    expect(
      within(screen.getByTestId('kept-draft')).getByText('0 components · 0 kcal'),
    ).toBeTruthy();
  });

  it('changing the WHEN chip on 7a changes the kept meal’s time', async () => {
    await buildStirFry();
    await backTo7a();
    await press('Breakfast 08:00');
    await press('Continue your meal, Chicken stir-fry');
    await screen.findByTestId('screen-build-meal');
    expect(chipText()).toBe('Breakfast · 08:00 ▾');
  });

  it('roster edits are never offered as Continue', async () => {
    await start(state());
    await press('Edit Protein shake');
    await screen.findByTestId('screen-build-meal');
    await backTo7a();
    expect(screen.queryByTestId('kept-draft')).toBeNull();
  });
});

describe('7a-C: a new start asks first', () => {
  it('“+ Build a meal from scratch”: Keep it changes nothing; Discard starts an empty meal', async () => {
    await buildStirFry();
    await backTo7a();
    const asked = answerDiscard('Keep it');
    await press('+ Build a meal from scratch');
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toEqual({
      title: 'Discard Chicken stir-fry?',
      message: 'Its 2 components won’t be logged.',
    });
    expect(screen.getByTestId('screen-log-meal')).toBeTruthy();
    expect(screen.getByTestId('kept-draft')).toBeTruthy();

    answerDiscard('Discard');
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    expect(screen.getByText('COMPONENTS · 0 ADDED')).toBeTruthy();
    expect(screen.getByLabelText('Meal name').props.value).toBe('');
    await backTo7a();
    expect(screen.queryByTestId('kept-draft')).toBeNull();
  });

  it('a roster “Log” asks; Keep it logs nothing, Discard logs the roster meal', async () => {
    await buildStirFry();
    await backTo7a();
    const asked = answerDiscard('Keep it');
    await press('Log Breakfast · oats');
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(mockBackend.state.calls).not.toContain('logMeal');
    expect(screen.getByTestId('kept-draft')).toBeTruthy();

    answerDiscard('Discard');
    await press('Log Breakfast · oats');
    await screen.findByTestId('screen-today');
    expect(mockBackend.state.mealLogs.at(-1)!.name).toBe('Breakfast · oats');
  });

  it('“Log again” from eaten recently asks first', async () => {
    await buildStirFry('My stir-fry');
    await backTo7a();
    const asked = answerDiscard('Keep it');
    await press('Log again: Chicken stir-fry');
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]!.title).toBe('Discard My stir-fry?');
    expect(mockBackend.state.calls).not.toContain('logMeal');

    answerDiscard('Discard');
    await press('Log again: Chicken stir-fry');
    await screen.findByTestId('screen-today');
    expect(mockBackend.state.calls).toContain('logMeal');
  });

  it('the batch builder asks first', async () => {
    await buildStirFry();
    await backTo7a();
    const asked = answerDiscard('Keep it');
    await press('+ Cooked a batch');
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(screen.getByTestId('screen-log-meal')).toBeTruthy();

    answerDiscard('Discard');
    await press('+ Cooked a batch');
    await screen.findByTestId('screen-batch-builder');
  });

  it('editing a roster meal asks first', async () => {
    await buildStirFry();
    await backTo7a();
    const asked = answerDiscard('Keep it');
    await press('Edit Protein shake');
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(screen.getByTestId('screen-log-meal')).toBeTruthy();
  });

  it('nothing is asked without a kept meal', async () => {
    await start(state());
    const asked = answerDiscard('Keep it');
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    expect(asked).toHaveLength(0);
  });
});

describe('7a-C: when the kept draft is cleared', () => {
  async function reopenLogMeal() {
    await fireEvent.press(screen.getAllByRole('button', { name: 'Log meal' })[0]!);
    await screen.findByTestId('screen-log-meal');
  }

  it('after logging it', async () => {
    await buildStirFry();
    await press('Done · log meal (472 kcal)');
    await screen.findByTestId('screen-today');
    await reopenLogMeal();
    expect(screen.queryByTestId('kept-draft')).toBeNull();
  });

  it('after “Save to roster only”', async () => {
    await buildStirFry();
    await press('Save to roster only');
    await press('Save meal');
    await screen.findByTestId('screen-log-meal');
    await waitFor(() => expect(mockBackend.state.calls).toContain('saveMeal'));
    expect(screen.queryByTestId('kept-draft')).toBeNull();
    expect(mockBackend.state.calls).not.toContain('logMeal');
  });

  it('after closing Log meal (Cancel on 7a)', async () => {
    await start(state(), '/');
    await reopenLogMeal();
    await press('Now · 13:40');
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    await press('Add Chicken breast, raw, 200 g');
    await backTo7a();
    expect(screen.getByTestId('kept-draft')).toBeTruthy();
    await press('Cancel');
    await screen.findByTestId('screen-today');
    await reopenLogMeal();
    expect(screen.queryByTestId('kept-draft')).toBeNull();
  });
});

describe('consent off', () => {
  it('Log meal says health data is off: no WHEN row, no card', async () => {
    await start(state({ healthConsent: false }));
    expect(screen.getByTestId('screen-log-meal-consent-off')).toBeTruthy();
    expect(screen.queryByTestId('kept-draft')).toBeNull();
    expect(screen.queryByTestId('when-chips')).toBeNull();
  });
});
