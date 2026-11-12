import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  formatDateUK,
  sessionsOn,
  splitShortName,
  suggestSplitDay,
  weekOf,
  weekdayIndex,
  type LocalDate,
  type SplitDay,
  type SplitRotation,
  type TrainedDay,
} from '@life-os/core';
import { Card } from '@/components/ui';
import { FormMessage } from '@/components/forms';
import { BottomSheet } from '@/features/log-meal/TimeSheet';
import { supplementLabel, type Supplement, type SupplementLog } from '@/lib/backend/health';
import { openLiftoff } from '@/lib/liftoff';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';
import { Button, Muted, TextLink } from './parts';

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const GROUPS = [
  { key: 'morning', label: 'Morning' },
  { key: 'evening', label: 'Evening' },
  { key: 'any', label: 'Any time' },
] as const;

/** A group's heading: "Evening · 21:30" when every supplement in it shares one reminder time. */
function groupHeading(label: string, list: readonly Supplement[]): string {
  const times = new Set(list.map((s) => s.reminderTime));
  const [only] = [...times];
  return times.size === 1 && only ? `${label} · ${only}` : label;
}

/** 1B Supplements: chips grouped Morning / Evening; tap to mark taken today, tap again to undo. */
export function SupplementsCard(props: {
  supplements: readonly Supplement[];
  taken: readonly SupplementLog[];
  today: LocalDate;
  /** null when read-only (sample data). */
  onToggle: ((s: Supplement, taken: boolean) => Promise<void>) | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const takenIds = new Set(
    props.taken.filter((t) => t.takenOn === props.today).map((t) => t.supplementId),
  );
  const count = props.supplements.filter((s) => takenIds.has(s.id)).length;

  const toggle = async (s: Supplement) => {
    if (!props.onToggle) return;
    setError(null);
    setBusy(s.id);
    try {
      await props.onToggle(s, !takenIds.has(s.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that.');
    } finally {
      setBusy(null);
    }
  };

  if (props.supplements.length === 0) {
    return (
      <Card title="Supplements">
        <View style={styles.body} testID="supplements-empty">
          <Muted>No supplements yet. Add them in Me → Health targets → Supplements.</Muted>
          {props.onToggle ? (
            <TextLink
              label="Add supplements"
              onPress={() => router.push('/health-targets/supplements')}
            />
          ) : null}
        </View>
      </Card>
    );
  }

  return (
    <Card
      title={`Supplements · ${count} of ${props.supplements.length}`}
      trailing="Tap to mark taken"
    >
      <View style={styles.body} testID="supplements-card">
        {GROUPS.map((g) => {
          const list = props.supplements.filter((s) => s.timeOfDay === g.key);
          if (list.length === 0) return null;
          return (
            <View key={g.key} style={styles.group}>
              <Text style={styles.groupLabel}>{groupHeading(g.label, list)}</Text>
              <View style={styles.chips}>
                {list.map((s) => {
                  const on = takenIds.has(s.id);
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => void toggle(s)}
                      disabled={!props.onToggle || busy === s.id}
                      accessibilityRole="checkbox"
                      accessibilityLabel={supplementLabel(s)}
                      accessibilityState={{ checked: on, busy: busy === s.id }}
                      style={[styles.chip, on && styles.chipOn]}
                      testID={`supplement-${s.id}`}
                    >
                      {on ? <Text style={styles.chipTick}>✓</Text> : null}
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>
                        {supplementLabel(s)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
        {error ? <FormMessage>{error}</FormMessage> : null}
      </View>
    </Card>
  );
}

/**
 * Training option 1: "Today: Legs?" with Done and Change above the Mon–Sun strip. Tapping a day
 * marks it trained or untrained; the split name shows under each trained day. Sets and reps
 * stay in Liftoff.
 */
export function TrainingCard(props: {
  today: LocalDate;
  rotation: SplitRotation;
  history: readonly TrainedDay[];
  /** null when read-only (sample data). */
  actions: {
    mark: (date: LocalDate, split: SplitDay | null) => Promise<void>;
    unmark: (date: LocalDate) => Promise<void>;
  } | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const week = weekOf(props.today);
  const done = sessionsOn(props.history, week.days);
  const byDay = new Map(props.history.map((h) => [h.trainedOn, h]));
  const todayRow = byDay.get(props.today);
  const suggestion = suggestSplitDay(props.rotation, props.history, props.today);

  const run = async (fn: () => Promise<void>) => {
    if (!props.actions) return;
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that.');
    } finally {
      setBusy(false);
    }
  };

  /** A past day or today: mark it with the split it would have been, or untrain it. */
  const toggleDay = (date: LocalDate) =>
    run(async () => {
      if (byDay.has(date)) return props.actions!.unmark(date);
      const s = suggestSplitDay(props.rotation, props.history, date);
      await props.actions!.mark(date, s?.day ?? null);
    });

  return (
    <Card
      title={`Training this week · ${done} of ${props.rotation.targetPerWeek}`}
      trailing={`Target ${props.rotation.targetPerWeek}`}
    >
      <View style={styles.body} testID="training-card">
        <View style={styles.prompt} testID="training-prompt">
          {todayRow ? (
            <>
              <Text style={styles.promptTitle}>
                {todayRow.splitName ? `Today: ${todayRow.splitName} · done` : 'Today: trained'}
              </Text>
              <Muted>Tap today below to undo.</Muted>
            </>
          ) : suggestion ? (
            <>
              <Text style={styles.promptTitle}>{`Today: ${suggestion.day.name}?`}</Text>
              <Muted>
                {suggestion.after
                  ? `Next in your rotation after ${suggestion.after}`
                  : 'First in your rotation'}
              </Muted>
              <View style={styles.promptButtons}>
                <Button
                  label="Done"
                  flex
                  busy={busy}
                  disabled={!props.actions}
                  accessibilityLabel={`Done: trained ${suggestion.day.name} today`}
                  onPress={() => void run(() => props.actions!.mark(props.today, suggestion.day))}
                />
                <Button
                  label="Change"
                  variant="outline"
                  flex
                  disabled={!props.actions || busy}
                  accessibilityLabel="Change today’s split day"
                  onPress={() => setChanging(true)}
                />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.promptTitle}>Today: training?</Text>
              <Muted>Set your split in Me → Health targets → Training.</Muted>
              <Button
                label="Done"
                busy={busy}
                disabled={!props.actions}
                accessibilityLabel="Done: trained today"
                onPress={() => void run(() => props.actions!.mark(props.today, null))}
              />
            </>
          )}
        </View>

        <View style={styles.strip} testID="training-strip">
          {week.days.map((d) => {
            const i = weekdayIndex(d);
            const row = byDay.get(d);
            const isToday = d === props.today;
            const future = d > props.today;
            const state = row ? 'trained' : isToday ? 'not trained yet' : 'not trained';
            return (
              <View key={d} style={styles.stripDay}>
                <Text style={[styles.stripLabel, isToday && styles.stripLabelToday]}>
                  {SHORT_DAYS[i]}
                </Text>
                <Pressable
                  onPress={() => void toggleDay(d)}
                  disabled={!props.actions || future || busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${FULL_DAYS[i]}${isToday ? ', today' : ''}, ${state}${row?.splitName ? `, ${row.splitName}` : ''}`}
                  accessibilityHint={
                    future ? undefined : row ? 'Marks it not trained' : 'Marks it trained'
                  }
                  accessibilityState={{ selected: Boolean(row), disabled: future }}
                  style={[
                    styles.dayBox,
                    row && styles.dayBoxOn,
                    !row && isToday && styles.dayBoxToday,
                    future && styles.dayBoxFuture,
                  ]}
                  testID={`train-${d}`}
                >
                  {row ? <Text style={styles.dayTick}>✓</Text> : null}
                </Pressable>
                <Text style={styles.stripName} numberOfLines={1}>
                  {splitShortName(row?.splitName ?? null)}
                </Text>
              </View>
            );
          })}
        </View>
        {error ? <FormMessage>{error}</FormMessage> : null}
        <View>
          <TextLink
            label="Log workout in Liftoff ↗"
            accessibilityLabel="Log workout in Liftoff"
            accessibilityHint="Opens Liftoff"
            onPress={() => void openLiftoff().catch(() => {})}
            center
          />
          <Text style={styles.liftoffNote}>Opens Liftoff for sets, reps and history</Text>
        </View>
      </View>
      {suggestion ? (
        <BottomSheet
          visible={changing}
          onClose={() => setChanging(false)}
          testID="sheet-change-split"
        >
          <Text style={styles.sheetTitle} accessibilityRole="header">
            {`Today, ${formatDateUK(props.today)}`}
          </Text>
          <Muted>Pick today’s split day. Your rotation carries on from it.</Muted>
          <View style={styles.sheetList}>
            {props.rotation.days.map((d) => (
              <Pressable
                key={d.day}
                onPress={() => {
                  setChanging(false);
                  void run(() => props.actions!.mark(props.today, d));
                }}
                accessibilityRole="button"
                accessibilityLabel={`Day ${d.day}: ${d.name}${d.day === suggestion.day.day ? ', suggested' : ''}`}
                style={styles.sheetRow}
              >
                <Text style={styles.sheetRowText}>{`Day ${d.day} · ${d.name}`}</Text>
                {d.day === suggestion.day.day ? <Muted>Suggested</Muted> : null}
              </Pressable>
            ))}
          </View>
          <Button label="Cancel" variant="outline" onPress={() => setChanging(false)} />
        </BottomSheet>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.sm },
  group: { gap: space.sm },
  groupLabel: { ...type.footnote, fontWeight: '600', color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.text,
    backgroundColor: colors.background,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipOn: { backgroundColor: colors.fill, borderColor: colors.fill },
  chipTick: { color: colors.inverseText, fontSize: 13, fontWeight: '700' },
  chipText: { ...type.callout, fontWeight: '500', color: colors.text },
  chipTextOn: { color: colors.inverseText },
  prompt: {
    borderWidth: 1,
    borderColor: colors.text,
    borderRadius: radius.md,
    padding: space.md,
    gap: 6,
  },
  promptTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  promptButtons: { flexDirection: 'row', gap: space.sm, marginTop: 4 },
  strip: { flexDirection: 'row', gap: 4 },
  stripDay: { flex: 1, alignItems: 'center', gap: 4, minWidth: 0 },
  stripLabel: { fontSize: 12, color: colors.textSecondary },
  stripLabelToday: { color: colors.text, fontWeight: '700' },
  dayBox: {
    height: MIN_TOUCH,
    alignSelf: 'stretch',
    borderRadius: 10,
    backgroundColor: '#F3F3F3',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBoxOn: { backgroundColor: colors.fill, borderColor: colors.fill },
  dayBoxToday: { backgroundColor: colors.background, borderWidth: 2, borderColor: colors.text },
  dayBoxFuture: { opacity: 0.6 },
  dayTick: { color: colors.inverseText, fontSize: 15, fontWeight: '700' },
  stripName: { fontSize: 11, minHeight: 14, color: colors.text, textAlign: 'center' },
  liftoffNote: { ...type.caption, color: colors.textSecondary, textAlign: 'center' },
  sheetTitle: { ...type.headline, color: colors.text, marginBottom: space.xs },
  sheetList: { marginVertical: space.md },
  sheetRow: {
    minHeight: MIN_TOUCH + 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetRowText: { ...type.body, color: colors.text },
});
