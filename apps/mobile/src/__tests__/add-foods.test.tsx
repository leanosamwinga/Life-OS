import path from 'node:path';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import {
  createMemoryBackend,
  TEST_USER,
  type MemoryBackend,
  type MemoryState,
} from '@/test/memoryBackend';
import { FOODS, liveState } from '@/test/fixtures';
import type { StoredFood } from '@/lib/backend/foods';

const APP_DIR = path.resolve(__dirname, '../app');

let mockBackend: MemoryBackend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));

// The camera can't run in jest: a button stands in for "the camera saw this barcode".
let mockScanned = '';
jest.mock('@/features/log-meal/BarcodeScanner', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    BarcodeScanner: ({ onBarcode }: { onBarcode: (c: string) => void }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Simulate scan"
        onPress={() => onBarcode(mockScanned)}
      >
        <Text>camera</Text>
      </Pressable>
    ),
  };
});

beforeAll(() => {
  jest.useFakeTimers({ advanceTimers: true });
  jest.setSystemTime(new Date('2026-11-06T13:40:00Z'));
});
afterAll(() => jest.useRealTimers());

const POUCH: StoredFood = {
  ...FOODS.chicken,
  id: 'food-pouch',
  barcode: '0000000000017',
  name: 'Sweet chilli stir-fry sauce',
  kcalPer100g: 120,
  proteinPer100g: 0.8,
  carbsPer100g: 28,
  fatPer100g: 0.5,
  packGrams: 120,
  servingGrams: null,
};

async function startBuild(over: Partial<MemoryState> = {}) {
  const base = liveState();
  mockBackend = createMemoryBackend({ ...base, foods: [...base.foods!, POUCH], ...over });
  await renderRouter(APP_DIR, { initialUrl: '/log-meal' });
  await screen.findByText('Protein shake');
  await press('+ Build a meal from scratch');
  await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Chicken stir-fry');
  await press('Scan to add a component');
  await screen.findByTestId('screen-add-component');
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

async function scan(code: string) {
  mockScanned = code;
  await press('Simulate scan');
}

describe('7c scan → 7d how much', () => {
  it('a found product opens "how much" pre-filled from last time, with pack chips and the ODbL credit', async () => {
    await startBuild({
      lastPortions: { [POUCH.id]: { grams: 60, loggedAt: '2026-11-01T18:00:00Z' } },
    });
    await scan('0000000000017');
    await screen.findByTestId('screen-how-much');
    expect(screen.getByText('‹ Scan again')).toBeTruthy();
    expect(screen.getByLabelText('Grams').props.value).toBe('60');
    expect(screen.getByRole('button', { name: 'Last time · 60 g' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Whole pack · 120 g' })).toBeTruthy();
    expect(screen.getByText('Food data from Open Food Facts (ODbL)')).toBeTruthy();
    expect(screen.getByLabelText(/^72 kcal, protein 0.5 g, carbs 16.8 g, fat 0.3 g/)).toBeTruthy();
    await press('Add component · 72 kcal');
    expect(await screen.findByText('Sweet chilli stir-fry sauce · 60 g')).toBeTruthy();
  });

  it('"Add and scan another" goes back to the scanner', async () => {
    await startBuild();
    await scan('0000000000017');
    await screen.findByTestId('screen-how-much');
    expect(screen.getByLabelText('Grams').props.value).toBe(''); // never logged: no guess
    await press('Whole pack · 120 g');
    await fireEvent.press(screen.getByRole('link', { name: 'Add and scan another' }));
    expect(await screen.findByTestId('screen-add-component')).toBeTruthy();
    expect(screen.getByText('Chicken stir-fry · 144 kcal so far')).toBeTruthy();
  });

  it('rejects a typed barcode that is not 6–14 digits', async () => {
    await startBuild();
    await fireEvent.changeText(screen.getByLabelText('Or type the barcode'), '12-34');
    await press('Look up barcode');
    expect(screen.getByText('Barcodes are 6–14 digits.')).toBeTruthy();
    expect(mockBackend.state.calls).not.toContain('lookupBarcode');
  });
});

describe('7e manual entry', () => {
  it('not found: add it from the label; every value is required; saves your food with the barcode', async () => {
    await startBuild();
    await fireEvent.changeText(screen.getByLabelText('Or type the barcode'), '0000000000999');
    await press('Look up barcode');
    await screen.findByTestId('screen-manual-entry');
    expect(screen.getByText(/0000000000999 isn’t on Open Food Facts/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Food name'), 'Rice noodles, dried');
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '360');
    await fireEvent.changeText(screen.getByLabelText('Grams'), '70');
    await press('Add component');
    // Protein, carbs and fat are missing: nothing invented, nothing saved.
    expect(screen.getAllByText('Needed — copy it from the label')).toHaveLength(3);
    expect(mockBackend.state.calls).not.toContain('saveUserFood');

    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '6.0');
    await fireEvent.changeText(screen.getByLabelText('Carbs (g)'), '80.0');
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), '1.0');
    expect(screen.getByLabelText('252 kcal, protein 4.2 g, carbs 56.0 g, fat 0.7 g')).toBeTruthy();
    await press('Add component · 252 kcal');
    expect(await screen.findByText('Rice noodles, dried · 70 g')).toBeTruthy();
    const saved = mockBackend.state.foods.find((f) => f.name === 'Rice noodles, dried')!;
    expect(saved).toMatchObject({
      userId: TEST_USER.id,
      source: 'user',
      barcode: '0000000000999',
      kcalPer100g: 360,
      remembered: true,
    });

    // Logging it works end to end and the next scan finds your food.
    await press('Done · log meal (252 kcal)');
    await screen.findByTestId('screen-today');
    expect(await mockBackend.lookupBarcode('0000000000999')).toMatchObject({
      status: 'found',
      source: 'yours',
    });
  });

  it('a partial Open Food Facts product is completed from the label, keeping known values', async () => {
    await startBuild();
    await scan(FOODS.sauce.barcode!);
    await screen.findByTestId('screen-manual-entry');
    expect(screen.getByText(/missing some values/)).toBeTruthy();
    expect(screen.getByLabelText('Calories (kcal)').props.value).toBe('120');
    expect(screen.getByLabelText('Protein (g)').props.value).toBe('');
    expect(screen.getByText('Food data from Open Food Facts (ODbL)')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '0.8');
    await fireEvent.changeText(screen.getByLabelText('Grams'), '60');
    await press('Add component · 72 kcal');
    await screen.findByTestId('screen-build-meal');
    const own = mockBackend.state.foods.filter((f) => f.barcode === FOODS.sauce.barcode);
    expect(own.map((f) => f.source).sort()).toEqual(['open_food_facts', 'user']);
  });

  it('per-serving labels are converted to per 100 g; "Remember" off keeps it out of search', async () => {
    await startBuild();
    await press('Not found? Add it from the label');
    await screen.findByTestId('screen-manual-entry');
    await fireEvent.changeText(screen.getByLabelText('Food name'), 'Sample granola bar');
    await press('Label is per serving instead?');
    await fireEvent.changeText(screen.getByLabelText('Serving size (g)'), '30');
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '108');
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '1.8');
    await fireEvent.changeText(screen.getByLabelText('Carbs (g)'), '24');
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), '0.3');
    await fireEvent.changeText(screen.getByLabelText('Grams'), '30');
    await fireEvent(
      screen.getByRole('switch', { name: 'Remember this food' }),
      'valueChange',
      false,
    );
    await press('Add component · 108 kcal');
    await screen.findByTestId('screen-build-meal');
    const bar = mockBackend.state.foods.find((f) => f.name === 'Sample granola bar')!;
    expect(bar).toMatchObject({
      kcalPer100g: 360,
      proteinPer100g: 6,
      carbsPer100g: 80,
      fatPer100g: 1,
      servingGrams: 30,
      remembered: false,
    });
    expect(await mockBackend.searchFoods('granola')).toEqual([]);
  });

  it('"Edit values" on a scanned product saves your own corrected version', async () => {
    await startBuild();
    await scan('0000000000017');
    await screen.findByTestId('screen-how-much');
    await fireEvent.press(screen.getByRole('link', { name: 'Edit values' }));
    await screen.findByTestId('screen-manual-entry');
    expect(screen.getByLabelText('Food name').props.value).toBe('Sweet chilli stir-fry sauce');
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '130');
    await fireEvent.changeText(screen.getByLabelText('Grams'), '60');
    await press('Add component · 78 kcal');
    await screen.findByTestId('screen-build-meal');
    await waitFor(() =>
      expect(
        mockBackend.state.foods.find((f) => f.userId && f.barcode === '0000000000017'),
      ).toMatchObject({
        kcalPer100g: 130,
        packGrams: 120,
      }),
    );
  });
});
