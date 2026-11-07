import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  OPEN_FOOD_FACTS_CREDIT,
  formatGrams,
  formatKcal,
  portionMacros,
  roundGrams,
  sumMacros,
} from '@life-os/core';
import { FormScreen, IconTile, PrimaryButton, TextField, formStyles } from '@/components/forms';
import { useLogMeal } from '@/features/log-meal/LogMealContext';
import { Chip, MacroTiles, SheetHeader, TodayBar } from '@/features/log-meal/parts';
import { defaultMealName } from '@/features/log-meal/slots';
import { parseAmount } from '@/features/targets/parse';
import { colors, radius, space, type } from '@/theme';

const fmt1 = (n: number) => n.toFixed(1);

/** 7d Add component — how much. Pre-filled with the amount last time. */
export default function HowMuchScreen() {
  const lm = useLogMeal();
  const pending = lm.pending;
  const [input, setInput] = useState(() => (pending?.grams != null ? String(pending.grams) : ''));

  if (!pending) {
    return (
      <FormScreen
        testID="screen-how-much"
        header={<SheetHeader left="‹ Back" onLeft={() => router.back()} />}
      >
        <Text style={formStyles.body}>Pick a food first.</Text>
      </FormScreen>
    );
  }

  const { food } = pending;
  const parsed = parseAmount(input, { max: 5000, decimals: 1 });
  const grams = parsed.ok && parsed.value && parsed.value > 0 ? roundGrams(parsed.value) : null;
  const macros = portionMacros(food, grams ?? 0);
  const editingKey = pending.componentKey;
  const others = lm.draft.components.filter((c) => c.key !== editingKey);
  const mealAfter = sumMacros([...others, ...(grams ? [{ food, grams }] : [])]);
  const last = lm.lastGrams(food.id);
  const p = food.per100g;

  const add = () => {
    if (!grams) return;
    if (editingKey) lm.updateComponent(editingKey, grams);
    else lm.addComponent(food, grams);
    lm.setPending(null);
    router.dismissTo('/log-meal/build');
  };

  const mealName = lm.draft.name.trim() || defaultMealName(lm.slot);

  return (
    <FormScreen
      testID="screen-how-much"
      header={
        <SheetHeader left="‹ Back" onLeft={() => router.back()} right={`Adding to ${mealName}`} />
      }
      footer={
        <PrimaryButton
          label={
            grams
              ? `${editingKey ? 'Update' : 'Add'} component · ${formatKcal(macros.kcal)} kcal`
              : 'Enter how much you had'
          }
          disabled={!grams}
          onPress={add}
        />
      }
    >
      <View style={styles.food}>
        <IconTile size={64} />
        <View style={styles.foodText}>
          <Text style={styles.foodName} accessibilityRole="header">
            {food.name}
          </Text>
          {food.brand || food.barcode ? (
            <Text style={styles.sub}>
              {[food.brand, food.barcode ? `barcode ${food.barcode}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          <Text style={styles.sub}>
            Per 100 g: {formatKcal(p.kcal)} kcal · P {fmt1(p.protein)} · C {fmt1(p.carbs)} · F{' '}
            {fmt1(p.fat)}
          </Text>
        </View>
      </View>

      <Text style={styles.question}>How much did you have?</Text>
      <TextField
        label="Grams"
        value={input}
        onChangeText={setInput}
        keyboardType="decimal-pad"
        big
        suffix="g"
        placeholder="0"
        error={parsed.ok ? null : parsed.error}
        autoFocus={pending.grams == null}
      />
      <View style={styles.chips}>
        {last != null ? (
          <Chip
            label={`Last time · ${formatGrams(last)}`}
            selected={grams === last}
            onPress={() => setInput(String(last))}
          />
        ) : null}
        {[50, 100, 150].map((g) => (
          <Chip
            key={g}
            label={formatGrams(g)}
            selected={grams === g}
            onPress={() => setInput(String(g))}
          />
        ))}
      </View>

      <MacroTiles macros={macros} />
      <Text style={styles.formula}>
        {grams ? formatGrams(grams) : '— g'} × per-100 g values ÷ 100
      </Text>

      <View style={styles.after}>
        <View style={styles.afterRow}>
          <Text style={styles.afterLabel}>Meal after this</Text>
          <Text style={styles.afterValue}>
            {formatKcal(mealAfter.kcal)} kcal · P {fmt1(mealAfter.protein)} · C{' '}
            {fmt1(mealAfter.carbs)} · F {fmt1(mealAfter.fat)}
          </Text>
        </View>
        <TodayBar
          label="Today"
          logged={lm.progress.kcal.consumed}
          meal={mealAfter.kcal}
          target={lm.progress.kcal.target}
        />
        <Text style={styles.sub}>Dark: already logged today · light: this meal so far</Text>
      </View>
      {food.source === 'open_food_facts' ? (
        <Text style={styles.credit}>{OPEN_FOOD_FACTS_CREDIT}</Text>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  food: { flexDirection: 'row', gap: space.lg, marginTop: space.md, marginBottom: space.xl },
  foodText: { flex: 1, gap: 2 },
  foodName: { ...type.title, color: colors.text },
  sub: { ...type.footnote, color: colors.textSecondary },
  question: { ...type.headline, color: colors.text, marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  formula: {
    ...type.footnote,
    color: colors.textSecondary,
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  after: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  credit: { ...type.footnote, color: colors.textSecondary, marginTop: space.lg },
  afterRow: { flexDirection: 'row', gap: space.lg },
  afterLabel: { ...type.headline, color: colors.text, width: 90 },
  afterValue: { ...type.callout, color: colors.text, flex: 1 },
});
