import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { OPEN_FOOD_FACTS_CREDIT, formatKcal, toFood, type Food } from '@life-os/core';
import { FormMessage, FormScreen, SecondaryButton, TextField } from '@/components/forms';
import { BarcodeScanner } from '@/features/log-meal/BarcodeScanner';
import { FoodSearch } from '@/features/log-meal/FoodSearch';
import { useLogMeal } from '@/features/log-meal/LogMealContext';
import { Segmented, SheetHeader } from '@/features/log-meal/parts';
import { defaultMealName } from '@/features/log-meal/slots';
import type { StoredFood } from '@/lib/backend/foods';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, space, type } from '@/theme';

const TABS = ['Scan', 'Search', 'Manual'] as const;
type Tab = (typeof TABS)[number];

const BARCODE_RE = /^\d{6,14}$/;

/** 7c Add component — Scan · Search · Manual. */
export default function AddComponentScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const session = useSession();
  const lm = useLogMeal();
  const [tab, setTab] = useState<Tab>(params.tab === 'Search' ? 'Search' : 'Scan');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (food: Food, from: 'search' | 'scan' = 'search') => {
    lm.setPending({ food, grams: lm.lastGrams(food.id), from });
    router.push('/log-meal/how-much');
  };

  const openManual = (prefill: Parameters<typeof lm.setManual>[0]) => {
    lm.setManual(prefill);
    router.push('/log-meal/manual');
  };

  const complete = (record: StoredFood) =>
    openManual({ barcode: record.barcode, record, reason: 'incomplete' });

  async function lookup(raw: string) {
    const code = raw.replace(/\D/g, '');
    if (!BARCODE_RE.test(code)) {
      setError('Barcodes are 6–14 digits.');
      return;
    }
    if (!session.backend || busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await session.backend.lookupBarcode(code);
      if (r.status === 'not_found') {
        openManual({ barcode: code, record: null, reason: 'not_found' });
        return;
      }
      const food = toFood(r.food);
      if (food) pick(food, 'scan');
      else complete(r.food); // Open Food Facts is missing values: the user fills them in.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t look that barcode up.');
    } finally {
      setBusy(false);
    }
  }

  const changeTab = (t: Tab) => {
    if (t === 'Manual') {
      openManual({ barcode: null, record: null, reason: 'new' });
      return;
    }
    setError(null);
    setTab(t);
  };

  const mealName = lm.draft.name.trim() || defaultMealName(lm.slot);

  return (
    <FormScreen
      testID="screen-add-component"
      header={<SheetHeader left="Cancel" onLeft={() => router.back()} title="Add component" />}
    >
      <Segmented options={TABS} value={tab} onChange={changeTab} />
      {tab === 'Scan' ? (
        <>
          <BarcodeScanner onBarcode={(c) => void lookup(c)} paused={busy} />
          <View style={styles.typed}>
            <View style={styles.typedField}>
              <TextField
                label="Or type the barcode"
                value={typed}
                onChangeText={setTyped}
                keyboardType="number-pad"
                placeholder="e.g. 5012345678917"
                returnKeyType="search"
                onSubmitEditing={() => void lookup(typed)}
              />
            </View>
            <SecondaryButton
              label="Look up"
              accessibilityLabel="Look up barcode"
              disabled={busy || !typed.trim()}
              onPress={() => void lookup(typed)}
              style={styles.lookup}
            />
          </View>
        </>
      ) : null}
      {error ? <FormMessage>{error}</FormMessage> : null}

      <View style={styles.adding}>
        <Text style={styles.addingLabel}>Adding to</Text>
        <Text style={styles.addingValue} numberOfLines={1}>
          {mealName} · {formatKcal(lm.draftTotals.kcal)} kcal so far
        </Text>
      </View>

      <FoodSearch
        onPick={(f) => pick(f)}
        onIncomplete={complete}
        showSearch={tab === 'Search'}
        showCredit={false}
      />

      <Pressable
        onPress={() => openManual({ barcode: null, record: null, reason: 'new' })}
        accessibilityRole="button"
        accessibilityLabel="Not found? Add it from the label"
        style={styles.notFound}
      >
        <Text style={styles.notFoundText}>Not found? Add it from the label</Text>
      </Pressable>
      <Text style={styles.credit}>
        {OPEN_FOOD_FACTS_CREDIT}. Foods you add from the label are yours.
      </Text>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  typed: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.lg },
  typedField: { flex: 1 },
  lookup: { marginBottom: space.lg, minHeight: 52 },
  adding: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  addingLabel: { ...type.callout, color: colors.textSecondary },
  addingValue: { ...type.headline, color: colors.text, flexShrink: 1 },
  notFound: { minHeight: MIN_TOUCH, justifyContent: 'center', marginTop: space.lg },
  notFoundText: { ...type.headline, color: colors.text },
  credit: { ...type.footnote, color: colors.textSecondary, marginTop: space.sm },
});
