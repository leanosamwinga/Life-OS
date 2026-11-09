import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  COOKS_AS_OPTIONS,
  OPEN_FOOD_FACTS_CREDIT,
  cooksAsLabel,
  foodUnit,
  formatAmount,
  guessCooksAs,
  packWord,
  per100Label,
  portionFormula,
  unitHint,
  type AmountUnit,
  formatKcal,
  portionMacros,
  roundGrams,
  sumMacros,
} from '@life-os/core';
import {
  FormScreen,
  IconTile,
  LinkButton,
  PrimaryButton,
  TextField,
  formStyles,
} from '@/components/forms';
import { builderPath, useLogMeal } from '@/features/log-meal/LogMealContext';
import { amountChips } from '@/features/log-meal/amounts';
import { Chip, FoodName, MacroTiles, SheetHeader, TodayBar } from '@/features/log-meal/parts';
import { Overline } from '@/components/ui';
import { UnitToggle } from '@/features/logged-meal/parts';
import { defaultMealName } from '@/features/log-meal/slots';
import { parseAmount } from '@/features/targets/parse';
import { colors, radius, space, type } from '@/theme';

const fmt1 = (n: number) => n.toFixed(1);

/** 7d Add component — how much. Pre-filled with the amount last time. */
export default function HowMuchScreen() {
  const lm = useLogMeal();
  const pending = lm.pending;
  const [input, setInput] = useState(() => (pending?.grams != null ? String(pending.grams) : ''));
  const forBatch = lm.draft.kind === 'batch';
  const [cooksAs, setCooksAs] = useState(
    () => pending?.cooksAs ?? guessCooksAs(pending?.food.name ?? ''),
  );
  // g or ml (-U frames): opens in the food's unit, or the component's own when changing it.
  // Batch ingredients are always grams.
  const [unit, setUnit] = useState<AmountUnit>(() =>
    forBatch ? 'g' : (pending?.unit ?? (pending ? foodUnit(pending.food) : 'g')),
  );

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
  const last = lm.lastPortion(food.id);
  const p = food.per100g;
  const basis = foodUnit(food);
  const hint = unitHint(unit, basis);

  const fromScan = pending.from === 'scan';
  const add = (scanAnother = false) => {
    if (!grams) return;
    const ratio = forBatch ? cooksAs : undefined;
    const u = forBatch ? undefined : unit;
    if (editingKey) lm.updateComponent(editingKey, grams, ratio, u);
    else lm.addComponent(food, grams, ratio, u);
    lm.setPending(null);
    if (scanAnother) router.back();
    else router.dismissTo(builderPath(lm.draft));
  };
  const remove = () => {
    if (editingKey) lm.removeComponent(editingKey);
    lm.setPending(null);
    router.dismissTo(builderPath(lm.draft));
  };
  const thing = forBatch ? 'ingredient' : 'component';

  const editValues = () => {
    lm.setManual({
      barcode: food.barcode ?? null,
      reason: 'edit',
      record: {
        id: food.id,
        userId: null,
        source: food.source,
        barcode: food.barcode ?? null,
        name: food.name,
        brand: food.brand ?? null,
        kcalPer100g: p.kcal,
        proteinPer100g: p.protein,
        carbsPer100g: p.carbs,
        fatPer100g: p.fat,
        fibrePer100g: p.fibre ?? null,
        sugarPer100g: p.sugar ?? null,
        saltPer100g: p.salt ?? null,
        nutritionUnit: basis,
        packGrams: food.packGrams ?? null,
        servingGrams: food.servingGrams ?? null,
      },
    });
    router.push('/log-meal/manual');
  };

  const mealName = lm.draft.name.trim() || (forBatch ? 'new batch' : defaultMealName(lm.slot));

  return (
    <FormScreen
      testID="screen-how-much"
      header={
        <SheetHeader
          left={fromScan ? '‹ Scan again' : '‹ Back'}
          onLeft={() => router.back()}
          right={`Adding to ${mealName}`}
        />
      }
      footer={
        <>
          <PrimaryButton
            label={
              grams
                ? `${editingKey ? 'Update' : 'Add'} ${thing} · ${formatKcal(macros.kcal)} kcal`
                : 'Enter how much you had'
            }
            disabled={!grams}
            onPress={() => add()}
          />
          {fromScan ? (
            <LinkButton label="Add and scan another" muted onPress={() => add(true)} />
          ) : null}
          {forBatch && editingKey ? (
            <LinkButton label="Remove from batch" muted onPress={remove} />
          ) : null}
        </>
      }
    >
      <View style={styles.food}>
        <IconTile size={64} />
        <View style={styles.foodText}>
          <View accessibilityRole="header">
            <FoodName name={food.name} batch={Boolean(food.batch)} style={styles.foodName} />
          </View>
          {food.brand || food.barcode ? (
            <Text style={styles.sub}>
              {[
                food.brand,
                food.packGrams ? `${formatAmount(food.packGrams, basis)} ${packWord(basis)}` : null,
                food.barcode ? `barcode ${food.barcode}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          <Text style={styles.sub}>
            {per100Label(basis)}: {formatKcal(p.kcal)} kcal · P {fmt1(p.protein)} · C{' '}
            {fmt1(p.carbs)} · F {fmt1(p.fat)}
          </Text>
        </View>
      </View>

      <Text style={styles.question}>
        {forBatch ? 'How much went in the pot?' : 'How much did you have?'}
      </Text>
      <View style={styles.amountRow}>
        <View style={styles.amountField}>
          <TextField
            label={unit === 'ml' ? 'Millilitres' : 'Grams'}
            hideLabel={!forBatch}
            value={input}
            onChangeText={setInput}
            keyboardType="decimal-pad"
            big
            suffix={unit}
            placeholder="0"
            error={parsed.ok ? null : parsed.error}
            autoFocus={pending.grams == null}
          />
        </View>
        {forBatch ? null : (
          <View style={styles.unitToggle}>
            <UnitToggle what={food.name} value={unit} onChange={setUnit} size="large" />
          </View>
        )}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.chips}>
        {amountChips(food, forBatch && last ? { grams: last.grams, unit: 'g' } : last).map((c) => (
          <Chip
            key={c.label}
            label={c.label}
            selected={grams === c.grams && (forBatch || unit === c.unit)}
            onPress={() => {
              setInput(String(c.grams));
              if (!forBatch) setUnit(c.unit);
            }}
          />
        ))}
      </View>

      <MacroTiles macros={macros} />
      <Text style={styles.formula}>{portionFormula(grams, unit, basis)}</Text>

      {forBatch ? (
        <View style={styles.pot}>
          <Overline>In the pot</Overline>
          <Text style={styles.sub}>
            For the cooked-weight estimate. Dry rice, pasta, oats, lentils, couscous and quinoa soak
            up water; raw meat, poultry and fish lose it. Anything else counts as added.
          </Text>
          <View style={styles.chips}>
            {COOKS_AS_OPTIONS.map((o) => (
              <Chip
                key={o}
                label={cooksAsLabel(o)}
                selected={cooksAs === o}
                onPress={() => setCooksAs(o)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.after}>
        <View style={styles.afterRow}>
          <Text style={styles.afterLabel}>{forBatch ? 'Batch after this' : 'Meal after this'}</Text>
          <Text style={styles.afterValue}>
            {formatKcal(mealAfter.kcal)} kcal · P {fmt1(mealAfter.protein)} · C{' '}
            {fmt1(mealAfter.carbs)} · F {fmt1(mealAfter.fat)}
          </Text>
        </View>
        {forBatch ? null : (
          <>
            <TodayBar
              label={lm.mealDay.word}
              logged={lm.mealDay.progress.kcal.consumed}
              meal={mealAfter.kcal}
              target={lm.mealDay.progress.kcal.target}
            />
            <Text style={styles.sub}>Dark: already logged today · light: this meal so far</Text>
          </>
        )}
      </View>
      {food.source === 'open_food_facts' ? (
        <View style={styles.offNote}>
          <Text style={styles.sub}>From Open Food Facts · nutrition per 100 {basis}.</Text>
          <Text style={styles.sub}>
            Wrong values? Edit before adding and we’ll keep your version.
          </Text>
          <LinkButton label="Edit values" align="left" onPress={editValues} />
          <Text style={styles.sub}>{OPEN_FOOD_FACTS_CREDIT}</Text>
        </View>
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
  amountRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  amountField: { flex: 1 },
  unitToggle: { width: 112 },
  hint: {
    ...type.footnote,
    color: colors.textSecondary,
    marginTop: -space.sm,
    marginBottom: space.md,
  },
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
  offNote: { marginTop: space.lg },
  pot: { gap: space.sm, marginBottom: space.lg },
  afterRow: { flexDirection: 'row', gap: space.lg },
  afterLabel: { ...type.headline, color: colors.text, width: 90 },
  afterValue: { ...type.callout, color: colors.text, flex: 1 },
});
