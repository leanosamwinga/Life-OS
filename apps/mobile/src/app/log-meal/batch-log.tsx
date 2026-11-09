import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  formatAmount,
  formatDateUK,
  formatGrams,
  formatKcal,
  isLiquidBatch,
  portionFormula,
  portionMacros,
  roundGrams,
  unitHint,
  type AmountUnit,
} from '@life-os/core';
import {
  FormMessage,
  FormScreen,
  IconTile,
  LinkButton,
  PrimaryButton,
  TextField,
  formStyles,
} from '@/components/forms';
import { useLogMeal } from '@/features/log-meal/LogMealContext';
import { UnitToggle } from '@/features/logged-meal/parts';
import { amountChips } from '@/features/log-meal/amounts';
import { closeLogMeal } from '@/features/log-meal/navigation';
import { Chip, FoodName, MacroTiles, SheetHeader, TodayBar } from '@/features/log-meal/parts';
import { loggedAtFor, slotLabel } from '@/features/log-meal/slots';
import { parseAmount } from '@/features/targets/parse';
import { useSession } from '@/lib/session';
import { colors, radius, space, type } from '@/theme';

const fmt1 = (n: number) => n.toFixed(1);

/**
 * 7h How much — a batch on its own, in grams (liquids: 1 ml = 1 g), pre-filled with last time.
 * "Log it" logs it through log_meal; "Add to a meal instead" starts 7b with it as a component.
 */
export default function BatchLogScreen() {
  const session = useSession();
  const lm = useLogMeal();
  const pending = lm.pending;
  const [input, setInput] = useState(() => (pending?.grams != null ? String(pending.grams) : ''));
  // 7h-U: opens in g (a batch is per 100 g); ml counts 1 ml as 1 g.
  const [unit, setUnit] = useState<AmountUnit>('g');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pending?.food.batch) {
    return (
      <FormScreen
        testID="screen-how-much-batch"
        header={<SheetHeader left="‹ Back" onLeft={() => router.back()} />}
      >
        <Text style={formStyles.body}>Pick a batch first.</Text>
      </FormScreen>
    );
  }

  const { food } = pending;
  const batch = food.batch!;
  const parsed = parseAmount(input, { max: 5000, decimals: 1 });
  const grams = parsed.ok && parsed.value && parsed.value > 0 ? roundGrams(parsed.value) : null;
  const macros = portionMacros(food, grams ?? 0);
  const last = lm.lastPortion(food.id);
  const chips = last
    ? [{ label: `Last time · ${formatAmount(last.grams, last.unit)}`, ...last }]
    : amountChips(food, null);
  const hint = unitHint(unit, 'g');
  const p = food.per100g;
  const liquid = isLiquidBatch(food.name);

  async function logIt() {
    if (!grams || !session.backend) return;
    setBusy(true);
    setError(null);
    try {
      await session.backend.logMeal({
        name: food.name,
        savedMealId: null,
        loggedAt: loggedAtFor(lm.slot, lm.today, new Date()),
        components: [{ food, grams, unit }],
      });
      lm.setPending(null);
      session.notifyDataChanged();
      closeLogMeal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t log that.');
      setBusy(false);
    }
  }

  const addToMeal = () => {
    if (!grams) return;
    lm.startDraft({ components: [{ food, grams, unit }] });
    lm.setPending(null);
    router.replace('/log-meal/build');
  };

  return (
    <FormScreen
      testID="screen-how-much-batch"
      header={
        <SheetHeader
          left={`‹ ${food.name}`}
          leftLabel="Back"
          onLeft={() => router.back()}
          right={slotLabel(lm.slot)}
        />
      }
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton
            label={grams ? `Log it · ${formatKcal(macros.kcal)} kcal` : 'Enter how much you had'}
            busy={busy}
            disabled={!grams}
            onPress={() => void logIt()}
          />
          <LinkButton label="Add to a meal instead" plain align="center" onPress={addToMeal} />
        </>
      }
    >
      <View style={styles.food}>
        <IconTile size={64} />
        <View style={styles.foodText}>
          <View accessibilityRole="header">
            <FoodName name={food.name} batch style={styles.foodName} />
          </View>
          <Text style={styles.sub}>
            Your batch · cooked {formatDateUK(batch.cookedAt)} ·{' '}
            {batch.weighed
              ? `weighed ${formatGrams(batch.cookedWeightG)}`
              : `≈ ${formatGrams(batch.cookedWeightG)} estimated`}
          </Text>
          <Text style={styles.sub}>
            Per 100 g: {formatKcal(p.kcal)} kcal · P {fmt1(p.protein)} · C {fmt1(p.carbs)} · F{' '}
            {fmt1(p.fat)}
          </Text>
        </View>
      </View>

      <Text style={styles.question}>How much did you have?</Text>
      <View style={styles.amountRow}>
        <View style={styles.amountField}>
          <TextField
            label={unit === 'ml' ? 'Millilitres' : 'Grams'}
            hideLabel
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
        <View style={styles.unitToggle}>
          <UnitToggle what={food.name} value={unit} onChange={setUnit} size="large" />
        </View>
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.chips}>
        {chips.map((c) => (
          <Chip
            key={c.label}
            label={c.label}
            selected={grams === c.grams && unit === c.unit}
            onPress={() => {
              setInput(String(c.grams));
              setUnit(c.unit);
            }}
          />
        ))}
      </View>

      <MacroTiles macros={macros} />
      <Text style={styles.formula}>
        {portionFormula(grams, unit, 'g')}
        {unit === 'g' && !liquid ? ' · weigh what’s on your plate' : ''}
      </Text>

      <View style={styles.after}>
        <TodayBar
          label={`${lm.mealDay.word} after this`}
          logged={lm.mealDay.progress.kcal.consumed}
          meal={macros.kcal}
          target={lm.mealDay.progress.kcal.target}
        />
      </View>
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
  unitToggle: { width: 112, marginTop: 4 },
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
  },
});
