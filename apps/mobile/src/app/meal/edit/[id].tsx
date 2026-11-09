import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  formatAmount,
  moveNote,
  pickedInstant,
  pickedLine,
  pickerStart,
  sumMacros,
  toLondonDate,
  toLondonTime,
  UNIT_HINT,
  type AmountUnit,
  type LocalDate,
  type LocalTime,
} from '@life-os/core';
import { FormMessage, FormScreen, PrimaryButton, formStyles } from '@/components/forms';
import { Overline } from '@/components/ui';
import { SheetHeader } from '@/features/log-meal/parts';
import { TimeSheet } from '@/features/log-meal/TimeSheet';
import { useLoggedMeals } from '@/features/logged-meal/LoggedMealContext';
import { backToToday } from '@/features/logged-meal/navigation';
import { LockIcon, UnitToggle, macroLine } from '@/features/logged-meal/parts';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/**
 * 7k Edit logged meal: the name, the time (7i) and each item's unit only. Amounts and components
 * are locked; switching g / ml changes no numbers (1 ml counts as 1 g). The saved or plan meal it
 * came from is never touched, and nothing marks the meal as edited.
 */
export default function EditLoggedMealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const lm = useLoggedMeals();
  const log = lm.logs.find((l) => l.id === id);

  const [name, setName] = useState<string | null>(null);
  const [when, setWhen] = useState<{ date: LocalDate; time: LocalTime } | null>(null);
  const [units, setUnits] = useState<Record<number, AmountUnit>>({});
  const [picker, setPicker] = useState<Date | null>(null);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = <SheetHeader left="Cancel" onLeft={() => router.back()} title="Edit meal" />;
  if (!log) {
    return (
      <FormScreen testID="screen-7k" header={header}>
        <Text style={formStyles.body}>
          {lm.status === 'loading' ? 'Loading…' : 'That meal has gone.'}
        </Text>
      </FormScreen>
    );
  }

  const origDate = toLondonDate(log.loggedAt);
  const origTime = toLondonTime(log.loggedAt);
  const nameNow = name ?? log.name;
  const date = when?.date ?? origDate;
  const time = when?.time ?? origTime;
  const timeChanged = date !== origDate || time !== origTime;
  const unitOf = (i: number): AmountUnit => units[i] ?? log.items[i]!.unit ?? 'g';
  const changedUnits = log.items.flatMap((item, i) =>
    unitOf(i) !== (item.unit ?? 'g') ? [{ position: i, unit: unitOf(i) }] : [],
  );
  const nameOk = nameNow.trim().length > 0 && nameNow.trim().length <= 120;
  const dirty = nameNow.trim() !== log.name || timeChanged || changedUnits.length > 0;
  const totals = sumMacros(log.items);
  const now = new Date();
  const move = moveNote({
    from: origDate,
    to: date,
    kcal: totals.kcal,
    fromTotal: lm.dayKcal(origDate),
    today: lm.today,
  });

  const save = async () => {
    if (!session.backend || !dirty || !nameOk) return;
    setBusy(true);
    setError(null);
    try {
      await session.backend.updateLoggedMeal({
        id: log.id,
        name: nameNow.trim(),
        // The time only changes when the user changed it.
        loggedAt: timeChanged ? pickedInstant(date, time) : null,
        units: changedUnits,
      });
      session.notifyDataChanged();
      // A new time: back to Today to see it in time order. Otherwise back to the meal (7j).
      if (timeChanged) backToToday();
      else router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save those changes.');
      setBusy(false);
    }
  };

  return (
    <FormScreen
      testID="screen-7k"
      header={header}
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton
            label={busy ? 'Saving…' : 'Save changes'}
            busy={busy}
            disabled={!dirty || !nameOk}
            onPress={() => void save()}
          />
        </>
      }
    >
      <View style={busy && styles.saving} pointerEvents={busy ? 'none' : 'auto'}>
        <Overline>Meal name</Overline>
        <TextInput
          value={nameNow}
          onChangeText={setName}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="Meal name"
          editable={!busy}
          maxLength={120}
          style={[styles.input, focused && styles.inputFocused]}
          returnKeyType="done"
        />

        <Overline>Time eaten</Overline>
        <Pressable
          onPress={() => setPicker(new Date())}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Time eaten: ${pickedLine(date, time, now)}. Change`}
          style={styles.timeRow}
          testID="time-row"
        >
          <Text style={styles.timeText}>{pickedLine(date, time, now)}</Text>
          <Text style={styles.change}>Change ›</Text>
        </Pressable>

        {move ? (
          <View style={styles.panel} testID="move-note" accessibilityLiveRegion="polite">
            <Text style={styles.panelText}>
              <Text style={styles.bold}>{move.bold}</Text> {move.rest}
            </Text>
          </View>
        ) : null}

        <View style={styles.card} testID="locked-items">
          <Overline>Components · Amounts locked</Overline>
          {log.items.map((item, i) => (
            <View key={i} style={[styles.item, i > 0 && styles.divided]}>
              <LockIcon />
              <View
                style={styles.itemText}
                accessible
                accessibilityLabel={`${item.foodName}, ${formatAmount(item.grams, unitOf(i))}, locked`}
              >
                <Text style={styles.itemName}>
                  {item.foodName} · {formatAmount(item.grams, unitOf(i))}
                </Text>
                <Text style={styles.sub}>{macroLine(item.macros)}</Text>
              </View>
              <UnitToggle
                what={item.foodName}
                value={unitOf(i)}
                onChange={(u) => setUnits((m) => ({ ...m, [i]: u }))}
                disabled={busy}
                testID={`unit-${i}`}
              />
            </View>
          ))}
          <View style={[styles.totalRow, styles.divided]}>
            <Text style={styles.total}>Meal total · {macroLine(totals)}</Text>
          </View>
        </View>
        <Text style={styles.note}>
          {changedUnits.length ? `${UNIT_HINT}, so switching only fixes the label.\n` : ''}
          To change amounts, delete this meal and log it again.
        </Text>
      </View>

      <TimeSheet
        visible={picker !== null}
        now={picker ?? now}
        start={pickerStart(pickedInstant(date, time), picker ?? now)}
        onCancel={() => setPicker(null)}
        onDone={(d, t) => {
          setWhen({ date: d, time: t });
          setPicker(null);
        }}
      />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  saving: { opacity: 0.55 },
  input: {
    minHeight: MIN_TOUCH + 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    ...type.body,
    color: colors.text,
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  inputFocused: { borderColor: colors.fill, borderWidth: 2 },
  timeRow: {
    minHeight: MIN_TOUCH + 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
    marginBottom: space.md,
  },
  // 16 pt keeps "Yesterday · Sun 8 Nov · 21:30" and "Change ›" on one line on a 390 pt phone.
  timeText: { ...type.body, fontSize: 16, color: colors.text, flexShrink: 1 },
  change: {
    ...type.body,
    fontSize: 16,
    color: colors.textSecondary,
    flexShrink: 0,
    marginLeft: space.sm,
  },
  panel: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
  },
  panelText: { ...type.callout, color: colors.text, lineHeight: 21 },
  bold: { fontWeight: '700' },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    gap: space.sm,
  },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  itemText: { flex: 1, gap: 2 },
  itemName: { ...type.headline, color: colors.textSecondary },
  sub: { ...type.footnote, color: colors.textSecondary },
  totalRow: { paddingTop: space.md },
  total: { ...type.callout, color: colors.textSecondary },
  note: { ...type.footnote, color: colors.textSecondary, marginTop: space.md, lineHeight: 19 },
});
