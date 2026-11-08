import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatGrams, formatKcal, portionMacros, type Food } from '@life-os/core';
import {
  FormMessage,
  FormScreen,
  LinkButton,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from '@/components/forms';
import { Overline, ToggleRow } from '@/components/ui';
import { useLogMeal } from '@/features/log-meal/LogMealContext';
import { closeLogMeal } from '@/features/log-meal/navigation';
import { FoodName, SheetHeader, TodayBar } from '@/features/log-meal/parts';
import { defaultMealName, isValidTime, loggedAtFor, slotLabel } from '@/features/log-meal/slots';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

const macroLine = (m: { kcal: number; protein: number; carbs: number; fat: number }) =>
  `${formatKcal(m.kcal)} kcal · P ${m.protein.toFixed(1)} · C ${m.carbs.toFixed(1)} · F ${m.fat.toFixed(1)}`;

function confirmDelete(name: string): Promise<boolean> {
  const msg = `“${name}” leaves your roster. Meals you’ve already logged stay in your history.`;
  if (Platform.OS === 'web') {
    const c = (globalThis as { confirm?: (m: string) => boolean }).confirm;
    return Promise.resolve(c ? c(msg) : true);
  }
  return new Promise((resolve) =>
    Alert.alert('Delete this meal?', msg, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/** 7b Build meal — components, suggestions from last time, live totals. Also edits roster meals. */
export default function BuildMealScreen() {
  const session = useSession();
  const lm = useLogMeal();
  const { draft, draftTotals: t } = lm;
  const editing = draft.mode === 'edit';
  // 7b-R: "Save to roster only" — save_meal, never log_meal.
  const saveOnly = !editing && draft.saveOnly;
  const planFields = editing || saveOnly;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backend = session.backend;

  const inMeal = new Set(draft.components.map((c) => c.food.id));
  const suggestions = lm.data.recentFoods.filter((r) => !inMeal.has(r.food.id)).slice(0, 3);
  const name = draft.name.trim() || defaultMealName(lm.slot);
  const timeOk = !draft.inDailyPlan || isValidTime(draft.usualTime);

  const openHowMuch = (food: Food, grams: number | null, componentKey?: string) => {
    lm.setPending({ food, grams, componentKey });
    router.push('/log-meal/how-much');
  };

  async function run(fn: () => Promise<void>) {
    if (!backend) return;
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that meal.');
      setBusy(false);
    }
  }

  const logMeal = () =>
    run(async () => {
      let savedMealId: string | null = null;
      if (draft.saveToRoster) {
        savedMealId = await backend!.saveMeal({
          id: null,
          name,
          inDailyPlan: false,
          usualTime: null,
          components: draft.components,
        });
      }
      await backend!.logMeal({
        name,
        savedMealId,
        loggedAt: loggedAtFor(lm.slot, lm.today, new Date()),
        components: draft.components,
      });
      session.notifyDataChanged();
      closeLogMeal();
    });

  const saveMeal = () =>
    run(async () => {
      if (!draft.name.trim()) throw new Error('Give the meal a name.');
      await backend!.saveMeal({
        id: draft.savedMealId,
        name: draft.name.trim(),
        inDailyPlan: draft.inDailyPlan,
        usualTime: draft.inDailyPlan ? draft.usualTime.trim() : null,
        components: draft.components,
      });
      session.notifyDataChanged();
      router.back();
    });

  const saveToRosterOnly = () =>
    run(async () => {
      await backend!.saveMeal({
        id: null,
        name,
        inDailyPlan: draft.inDailyPlan,
        usualTime: draft.inDailyPlan ? draft.usualTime.trim() : null,
        components: draft.components,
      });
      session.notifyDataChanged();
      lm.setTab('saved');
      router.dismissTo('/log-meal');
    });

  const deleteMeal = async () => {
    if (!draft.savedMealId || !(await confirmDelete(draft.name))) return;
    await run(async () => {
      await backend!.deleteSavedMeal(draft.savedMealId!);
      session.notifyDataChanged();
      router.back();
    });
  };

  return (
    <FormScreen
      testID="screen-build-meal"
      header={
        <SheetHeader
          left="‹ Log meal"
          leftLabel="Back to Log meal"
          onLeft={() => router.back()}
          right={editing ? 'Edit meal' : saveOnly ? 'Not logging' : slotLabel(lm.slot)}
        />
      }
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          {editing ? (
            <>
              <PrimaryButton
                label="Save meal"
                busy={busy}
                disabled={draft.components.length === 0 || !timeOk}
                onPress={() => void saveMeal()}
              />
              <SecondaryButton
                label="Delete meal"
                disabled={busy}
                onPress={() => void deleteMeal()}
              />
            </>
          ) : saveOnly ? (
            <>
              <PrimaryButton
                label="Save meal"
                busy={busy}
                disabled={draft.components.length === 0 || !timeOk}
                onPress={() => void saveToRosterOnly()}
              />
              <LinkButton
                label="Log it instead"
                plain
                align="center"
                onPress={() => lm.updateDraft({ saveOnly: false })}
              />
            </>
          ) : (
            <>
              <PrimaryButton
                label={`Done · log meal (${formatKcal(t.kcal)} kcal)`}
                busy={busy}
                disabled={draft.components.length === 0}
                onPress={() => void logMeal()}
              />
              <SecondaryButton
                strong
                label="Save to roster only"
                disabled={busy || draft.components.length === 0}
                onPress={() =>
                  lm.updateDraft({
                    saveOnly: true,
                    usualTime: draft.usualTime || lm.slot.time,
                  })
                }
              />
            </>
          )}
        </>
      }
    >
      <View style={styles.nameBlock}>
        <Overline>Meal name</Overline>
        <TextInput
          value={draft.name}
          onChangeText={(v) => lm.updateDraft({ name: v })}
          placeholder={defaultMealName(lm.slot)}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Meal name"
          style={styles.nameInput}
          maxLength={120}
        />
      </View>

      <View style={styles.card}>
        <Overline>{`Components · ${draft.components.length} added`}</Overline>
        {draft.components.length === 0 ? (
          <Text style={styles.sub}>Nothing yet. Add a suggestion, scan a barcode or search.</Text>
        ) : null}
        {draft.components.map((c, i) => (
          <View
            key={c.key}
            style={[styles.compRow, i < draft.components.length - 1 && styles.divider]}
          >
            <Pressable
              style={styles.compMain}
              onPress={() => openHowMuch(c.food, c.grams, c.key)}
              accessibilityRole="button"
              accessibilityLabel={`${c.food.name}, ${formatGrams(c.grams)}. Change amount`}
            >
              <FoodName
                name={c.food.name}
                batch={Boolean(c.food.batch)}
                suffix={` · ${formatGrams(c.grams)}`}
                style={styles.compTitle}
              />
              <Text style={styles.sub}>{macroLine(portionMacros(c.food, c.grams))}</Text>
            </Pressable>
            <Pressable
              onPress={() => lm.removeComponent(c.key)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${c.food.name}`}
              style={styles.remove}
            >
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <View style={styles.addPanel}>
        <Text style={styles.addTitle}>Add component</Text>
        {suggestions.length ? (
          <>
            <Overline>Suggested · from last time</Overline>
            {suggestions.map((r) => (
              <Pressable
                key={r.food.id}
                onPress={() => lm.addComponent(r.food, r.grams)}
                onLongPress={() => openHowMuch(r.food, r.grams)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${r.food.name}, ${formatGrams(r.grams)}`}
                accessibilityHint="Hold to change grams"
                style={styles.suggestion}
              >
                <View style={styles.suggestionName}>
                  <FoodName
                    name={`+ ${r.food.name}`}
                    batch={Boolean(r.food.batch)}
                    suffix={` · ${formatGrams(r.grams)}`}
                    style={styles.suggestionText}
                  />
                </View>
                <Text style={styles.sub}>
                  {formatKcal(portionMacros(r.food, r.grams).kcal)} kcal
                </Text>
              </Pressable>
            ))}
            <Text style={styles.sub}>
              {suggestions.some((r) => r.food.batch)
                ? 'Your batches show up in suggestions and search, like any food.'
                : 'Amounts are what you had last time. Tap to add, or hold to change grams.'}
            </Text>
          </>
        ) : null}
        <View style={styles.addButtons}>
          {(['Scan', 'Search', 'Manual'] as const).map((tab, i) => (
            <Pressable
              key={tab}
              onPress={() => router.push({ pathname: '/log-meal/add', params: { tab } })}
              accessibilityRole="button"
              accessibilityLabel={`${tab} to add a component`}
              style={[styles.addButton, i === 0 && styles.addButtonDark]}
            >
              <Text style={[styles.addButtonText, i === 0 && styles.addButtonTextDark]}>{tab}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.card} accessible accessibilityLabel={`Meal so far: ${macroLine(t)}`}>
        <Overline>Meal so far</Overline>
        <View style={styles.totals}>
          {(
            [
              [formatKcal(t.kcal), 'kcal'],
              [t.protein.toFixed(1), 'protein g'],
              [t.carbs.toFixed(1), 'carbs g'],
              [t.fat.toFixed(1), 'fat g'],
            ] as const
          ).map(([v, l]) => (
            <View key={l} style={styles.total}>
              <Text style={styles.totalValue}>{v}</Text>
              <Text style={styles.sub}>{l}</Text>
            </View>
          ))}
        </View>
        {editing ? null : saveOnly ? (
          <Text style={styles.sub}>Not added to today. Log it from Saved when you eat it.</Text>
        ) : (
          <TodayBar
            logged={lm.progress.kcal.consumed}
            meal={t.kcal}
            target={lm.progress.kcal.target}
          />
        )}
      </View>

      {planFields ? (
        <>
          <ToggleRow
            label="In my daily plan"
            subtitle="Shows on Today at its usual time, with “Ate it”"
            value={draft.inDailyPlan}
            onValueChange={(v) =>
              lm.updateDraft({ inDailyPlan: v, usualTime: draft.usualTime || lm.slot.time })
            }
            last={!draft.inDailyPlan}
          />
          {draft.inDailyPlan ? (
            <TextField
              label="Usual time (24-hour)"
              value={draft.usualTime}
              onChangeText={(v) => lm.updateDraft({ usualTime: v })}
              placeholder="12:30"
              keyboardType="numbers-and-punctuation"
              error={draft.usualTime && !timeOk ? 'Use HH:MM, e.g. 08:00' : null}
            />
          ) : null}
        </>
      ) : (
        <ToggleRow
          label="Save to my roster"
          value={draft.saveToRoster}
          onValueChange={(v) => lm.updateDraft({ saveToRoster: v })}
          last
        />
      )}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  nameBlock: { marginTop: space.md, marginBottom: space.lg, gap: space.xs },
  nameInput: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: space.sm,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
    gap: space.sm,
  },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  compMain: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center' },
  compTitle: { ...type.headline, color: colors.text },
  sub: { ...type.footnote, color: colors.textSecondary },
  remove: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: 20, color: colors.text },
  addPanel: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
    gap: space.sm,
  },
  addTitle: { ...type.headline, color: colors.text },
  suggestion: {
    minHeight: MIN_TOUCH + 8,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestionText: { ...type.headline, color: colors.text, flexShrink: 1 },
  suggestionName: { flexShrink: 1, paddingVertical: space.sm },
  addButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  addButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDark: { backgroundColor: colors.fill, borderColor: colors.fill },
  addButtonText: { ...type.headline, color: colors.text },
  addButtonTextDark: { color: colors.inverseText },
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: space.sm },
  total: { alignItems: 'center', flex: 1 },
  totalValue: { fontSize: 24, fontWeight: '700', color: colors.text },
});
