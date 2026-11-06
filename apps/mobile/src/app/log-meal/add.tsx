import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatKcal, type Food } from '@life-os/core';
import { FormScreen, formStyles } from '@/components/forms';
import { FoodSearch } from '@/features/log-meal/FoodSearch';
import { useLogMeal } from '@/features/log-meal/LogMealContext';
import { Segmented, SheetHeader } from '@/features/log-meal/parts';
import { defaultMealName } from '@/features/log-meal/slots';
import { colors, space, type } from '@/theme';

const TABS = ['Scan', 'Search', 'Manual'] as const;
type Tab = (typeof TABS)[number];

/** 7c Add component — Scan · Search · Manual. */
export default function AddComponentScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const lm = useLogMeal();
  const [tab, setTab] = useState<Tab>(
    (TABS as readonly string[]).includes(params.tab ?? '') ? (params.tab as Tab) : 'Search',
  );

  const pick = (food: Food) => {
    lm.setPending({ food, grams: lm.lastGrams(food.id) });
    router.push('/log-meal/how-much');
  };

  const mealName = lm.draft.name.trim() || defaultMealName(lm.slot);

  return (
    <FormScreen
      testID="screen-add-component"
      header={<SheetHeader left="Cancel" onLeft={() => router.back()} title="Add component" />}
    >
      <Segmented options={TABS} value={tab} onChange={setTab} />
      {tab === 'Search' ? (
        <FoodSearch onPick={pick} />
      ) : (
        <View style={styles.soon}>
          <Text style={styles.soonTitle}>
            {tab === 'Scan' ? 'Barcode scanning' : 'Add from the label'}
          </Text>
          <Text style={formStyles.body}>Coming in the next update. Search for now.</Text>
        </View>
      )}
      <View style={styles.adding}>
        <Text style={styles.addingLabel}>Adding to</Text>
        <Text style={styles.addingValue} numberOfLines={1}>
          {mealName} · {formatKcal(lm.draftTotals.kcal)} kcal so far
        </Text>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  soon: { paddingVertical: space.xl, gap: space.sm },
  soonTitle: { ...type.headline, color: colors.text },
  adding: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    marginTop: space.xl,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addingLabel: { ...type.callout, color: colors.textSecondary },
  addingValue: { ...type.headline, color: colors.text, flexShrink: 1 },
});
