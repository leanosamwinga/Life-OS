import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  OPEN_FOOD_FACTS_CREDIT,
  checkPer100g,
  formatKcal,
  per100gFromServing,
  portionMacros,
  roundGrams,
  toFood,
  type NutritionIssue,
} from '@life-os/core';
import { FormMessage, FormScreen, PrimaryButton, TextField, formStyles } from '@/components/forms';
import { ToggleRow } from '@/components/ui';
import { builderPath, useLogMeal } from '@/features/log-meal/LogMealContext';
import { MacroTiles, SheetHeader } from '@/features/log-meal/parts';
import { defaultMealName } from '@/features/log-meal/slots';
import { parseAmount } from '@/features/targets/parse';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

type Key = 'kcal' | 'protein' | 'carbs' | 'fat';
const FIELDS: { key: Key; label: string; max: number }[] = [
  { key: 'kcal', label: 'Calories (kcal)', max: 9000 },
  { key: 'protein', label: 'Protein (g)', max: 1000 },
  { key: 'carbs', label: 'Carbs (g)', max: 1000 },
  { key: 'fat', label: 'Fat (g)', max: 1000 },
];

const ISSUE: Record<NutritionIssue, string> = {
  missing: 'Needed — copy it from the label',
  negative: 'Can’t be negative',
  too_high: 'Too high for 100 g — check the label',
  macros_over_100g: 'Protein, carbs and fat add up to more than 100 g per 100 g',
};

const str = (n: number | null | undefined) => (n == null ? '' : String(n));

/**
 * 7e Add from the label. Creates (or completes) the user's own food — every headline value
 * comes from the label, nothing is invented — then adds it to the meal.
 */
export default function ManualEntryScreen() {
  const session = useSession();
  const lm = useLogMeal();
  const prefill = lm.manual ?? { barcode: null, record: null, reason: 'new' as const };
  const rec = prefill.record;

  const [name, setName] = useState(rec?.name ?? '');
  const [values, setValues] = useState<Record<Key, string>>({
    kcal: str(rec?.kcalPer100g),
    protein: str(rec?.proteinPer100g),
    carbs: str(rec?.carbsPer100g),
    fat: str(rec?.fatPer100g),
  });
  const [perServing, setPerServing] = useState(false);
  const [serving, setServing] = useState(str(rec?.servingGrams));
  const [gramsInput, setGramsInput] = useState('');
  const [remember, setRemember] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse what's typed; unknown stays null (never filled in for the user).
  const typed = Object.fromEntries(
    FIELDS.map((f) => {
      const r = parseAmount(values[f.key], { max: f.max, decimals: 1 });
      return [f.key, r.ok ? r.value : Number.NaN];
    }),
  ) as Record<Key, number | null>;
  const servingParsed = parseAmount(serving, { max: 10000, decimals: 1 });
  const servingGrams = servingParsed.ok && servingParsed.value ? servingParsed.value : null;
  const per100 =
    perServing && servingGrams
      ? per100gFromServing(typed, servingGrams)
      : perServing
        ? { kcal: null, protein: null, carbs: null, fat: null }
        : typed;
  const issues = checkPer100g(per100);
  const valid = Object.keys(issues).length === 0 && name.trim().length > 0;

  const gramsParsed = parseAmount(gramsInput, { max: 5000, decimals: 1 });
  const grams = gramsParsed.ok && gramsParsed.value ? roundGrams(gramsParsed.value) : null;
  const macros =
    valid && grams
      ? portionMacros({ per100g: per100 as Record<Key, number> }, grams)
      : { kcal: 0, protein: 0, carbs: 0, fat: 0 };

  async function add() {
    setShowErrors(true);
    if (!valid || !grams || !session.backend) return;
    setError(null);
    setBusy(true);
    try {
      const saved = await session.backend.saveUserFood({
        name: name.trim(),
        brand: rec?.brand ?? null,
        barcode: prefill.barcode ?? rec?.barcode ?? null,
        per100g: per100 as Record<Key, number>,
        packGrams: rec?.packGrams ?? null,
        servingGrams: perServing ? servingGrams : (rec?.servingGrams ?? null),
        remembered: remember,
      });
      const food = toFood(saved);
      if (!food) throw new Error('That food is missing values.');
      lm.addComponent(food, grams);
      lm.setManual(null);
      session.notifyDataChanged();
      router.dismissTo(builderPath(lm.draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that food.');
      setBusy(false);
    }
  }

  const fieldError = (k: Key): string | null => {
    const issue = issues[k];
    if (!issue) return null;
    // Only nag about empty fields after the first attempt; wrong values show straight away.
    if (issue === 'missing' && !showErrors) return null;
    return perServing && issue === 'too_high' ? 'Too high for this serving size' : ISSUE[issue];
  };

  const mealName = lm.draft.name.trim() || defaultMealName(lm.slot);
  const fromOff = rec?.source === 'open_food_facts';

  return (
    <FormScreen
      testID="screen-manual-entry"
      header={
        <SheetHeader
          left={`‹ ${mealName}`}
          leftLabel="Back"
          onLeft={() => router.back()}
          right="Manual entry"
        />
      }
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton
            label={
              grams && valid ? `Add component · ${formatKcal(macros.kcal)} kcal` : 'Add component'
            }
            busy={busy}
            disabled={!grams}
            onPress={() => void add()}
          />
        </>
      }
    >
      <Text style={styles.title} accessibilityRole="header">
        Add from the label
      </Text>
      {prefill.reason === 'not_found' ? (
        <Text style={[formStyles.body, styles.note]}>
          Barcode {prefill.barcode} isn’t on Open Food Facts. Add it from the pack and we’ll know it
          next time.
        </Text>
      ) : prefill.reason === 'incomplete' ? (
        <Text style={[formStyles.body, styles.note]}>
          Open Food Facts is missing some values for this product. Fill in the blanks from the pack.
        </Text>
      ) : prefill.reason === 'edit' ? (
        <Text style={[formStyles.body, styles.note]}>
          Correct anything that doesn’t match your pack. We’ll keep your version.
        </Text>
      ) : null}

      <TextField
        label="Food name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Rice noodles, dried"
        error={showErrors && !name.trim() ? 'Give it a name' : null}
      />

      <View style={styles.fieldset}>
        <Text style={styles.legend}>
          {perServing ? 'Per serving, from the pack' : 'Per 100 g, from the pack'}
        </Text>
        {perServing ? (
          <TextField
            label="Serving size (g)"
            value={serving}
            onChangeText={setServing}
            keyboardType="decimal-pad"
            error={showErrors && !servingGrams ? 'Needed to work out per 100 g' : null}
          />
        ) : null}
        <View style={styles.grid}>
          {FIELDS.map((f) => (
            <View key={f.key} style={styles.cell}>
              <TextField
                label={f.label}
                value={values[f.key]}
                onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
                keyboardType="decimal-pad"
                error={Number.isNaN(typed[f.key] as number) ? 'Enter a number' : fieldError(f.key)}
              />
            </View>
          ))}
        </View>
        {issues.total ? <FormMessage>{ISSUE.macros_over_100g}</FormMessage> : null}
        <Pressable
          onPress={() => setPerServing((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            perServing ? 'Label is per 100 g instead?' : 'Label is per serving instead?'
          }
          style={styles.switchLink}
        >
          <Text style={styles.switchLinkText}>
            {perServing ? 'Label is per 100 g instead?' : 'Label is per serving instead?'}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.question}>How much did you have?</Text>
      <TextField
        label="Grams"
        value={gramsInput}
        onChangeText={setGramsInput}
        keyboardType="decimal-pad"
        big
        suffix="g"
        placeholder="0"
        error={gramsParsed.ok ? null : gramsParsed.error}
      />
      <MacroTiles macros={macros} />

      <View style={styles.remember}>
        <ToggleRow
          label="Remember this food"
          subtitle="Shows up in suggestions next time"
          value={remember}
          onValueChange={setRemember}
          last
        />
      </View>
      {fromOff ? <Text style={styles.credit}>{OPEN_FOOD_FACTS_CREDIT}</Text> : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.text,
    marginTop: space.md,
    marginBottom: space.md,
  },
  note: { marginBottom: space.lg },
  fieldset: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    paddingBottom: space.sm,
    marginBottom: space.xl,
  },
  legend: { ...type.headline, color: colors.text, marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md },
  cell: { flexBasis: '45%', flexGrow: 1 },
  switchLink: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  switchLinkText: { ...type.callout, color: colors.text },
  question: { ...type.headline, color: colors.text, marginBottom: space.sm },
  remember: { marginTop: space.lg },
  credit: { ...type.footnote, color: colors.textSecondary, marginTop: space.md },
});
