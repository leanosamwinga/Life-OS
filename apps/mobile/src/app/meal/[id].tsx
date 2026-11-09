import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  deleteSummary,
  formatAmount,
  formatDateUK,
  formatKcal,
  formatTimeUK,
  componentsFromLog,
  pickedInstant,
  pickerStart,
  planBackNote,
  toFood,
  type Food,
  type LocalDate,
  type LocalTime,
  sumMacros,
  toLondonDate,
  type MealLog,
} from '@life-os/core';
import {
  FormMessage,
  FormScreen,
  LinkButton,
  PrimaryButton,
  SecondaryButton,
  formStyles,
} from '@/components/forms';
import { Overline } from '@/components/ui';
import { Chip, SheetHeader } from '@/features/log-meal/parts';
import { slotOfPlanMeal } from '@/features/log-meal/slots';
import { BottomSheet, TimeSheet } from '@/features/log-meal/TimeSheet';
import { isChangeable, useLoggedMeals } from '@/features/logged-meal/LoggedMealContext';
import { backToToday } from '@/features/logged-meal/navigation';
import { g1, macroLine } from '@/features/logged-meal/parts';
import { usePendingDelete } from '@/features/today/PendingDelete';
import type { RosterMeal } from '@/lib/backend/foods';
import { useSession } from '@/lib/session';
import { colors, radius, space, type } from '@/theme';

/** 7j Logged meal: read-only, with "Edit meal" and a quiet "Delete meal" (7l). */
export default function LoggedMealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const lm = useLoggedMeals();
  const log = lm.logs.find((l) => l.id === id);
  const [deleting, setDeleting] = useState(false);
  // E: "Log again" now, or at another time from the 7i sheet.
  const [picker, setPicker] = useState<Date | null>(null);
  const [again, setAgain] = useState<'busy' | 'done' | null>(null);
  const [againError, setAgainError] = useState<string | null>(null);

  const header = <SheetHeader left="‹ Today" leftLabel="Back to Today" onLeft={backToToday} />;
  if (!log) {
    return (
      <FormScreen testID="screen-7j" header={header}>
        {lm.status === 'loading' ? (
          <Text style={formStyles.body}>Loading…</Text>
        ) : lm.status === 'consent-off' ? (
          <Text style={formStyles.body}>
            Health data is off. Turn on “Use my health data” in Me to see your meals.
          </Text>
        ) : (
          <>
            {lm.error ? <FormMessage>{lm.error}</FormMessage> : null}
            <Text style={formStyles.body}>That meal has gone.</Text>
          </>
        )}
      </FormScreen>
    );
  }

  const totals = sumMacros(log.items);
  const plan = lm.roster.find((m) => m.id === log.savedMealId) ?? null;
  const changeable = isChangeable(log, new Date());

  /** Log the same components (amounts and units) as a new meal; the original is untouched. */
  const logAgain = async (when: { date: LocalDate; time: LocalTime } | null) => {
    const backend = session.backend;
    if (!backend) return;
    setAgain('busy');
    setAgainError(null);
    try {
      const ids = log.items.flatMap((i) => (i.foodId ? [i.foodId] : []));
      const foods = new Map(
        (await backend.getFoods(ids)).flatMap((r) => {
          const f = toFood(r);
          return f ? [[f.id, f] as [string, Food]] : [];
        }),
      );
      const { components, unavailable } = componentsFromLog(log.items, foods);
      if (unavailable.length) {
        // A food has gone: Build meal shows it so it can be removed first.
        setAgain(null);
        router.push({
          pathname: '/log-meal/from-log',
          params: { id: log.id, mode: 'again', ...(when ?? {}) },
        });
        return;
      }
      await backend.logMeal({
        name: log.name,
        savedMealId: null,
        loggedAt: when ? pickedInstant(when.date, when.time) : new Date().toISOString(),
        components,
      });
      session.notifyDataChanged();
      setAgain(null);
      backToToday();
    } catch (err) {
      setAgain(null);
      setAgainError(err instanceof Error ? err.message : 'Couldn’t log that meal again.');
    }
  };

  return (
    <FormScreen
      testID="screen-7j"
      header={header}
      footer={
        changeable ? (
          <>
            <PrimaryButton
              label="Edit meal"
              onPress={() => router.push({ pathname: '/meal/edit/[id]', params: { id: log.id } })}
            />
            <LinkButton label="Delete meal" onPress={() => setDeleting(true)} />
          </>
        ) : null
      }
    >
      <Overline>Logged meal</Overline>
      <Text style={styles.name} accessibilityRole="header">
        {log.name}
      </Text>
      <Text style={styles.when}>
        {formatDateUK(log.loggedAt)} · {formatTimeUK(log.loggedAt)}
      </Text>

      {plan ? <PlanPanel meal={plan} /> : null}

      <View style={styles.card} testID="logged-items">
        <Overline>{`Components · ${log.items.length}`}</Overline>
        {log.items.map((item, i) => (
          <View
            key={i}
            style={[styles.item, i > 0 && styles.divided]}
            accessible
            accessibilityLabel={`${item.foodName}, ${formatAmount(item.grams, item.unit ?? 'g')}, ${macroLine(item.macros)}`}
          >
            <Text style={styles.itemName}>
              {item.foodName} · {formatAmount(item.grams, item.unit ?? 'g')}
            </Text>
            <Text style={styles.sub}>{macroLine(item.macros)}</Text>
          </View>
        ))}
      </View>

      <View
        style={styles.card}
        accessible
        accessibilityLabel={`Meal totals: ${macroLine(totals)}`}
        testID="meal-totals"
      >
        <Overline>Meal totals</Overline>
        <View style={styles.totals}>
          {(
            [
              [formatKcal(totals.kcal), 'kcal'],
              [g1(totals.protein), 'protein g'],
              [g1(totals.carbs), 'carbs g'],
              [g1(totals.fat), 'fat g'],
            ] as const
          ).map(([v, l]) => (
            <View key={l} style={styles.total}>
              <Text style={styles.totalValue}>{v}</Text>
              <Text style={styles.sub}>{l}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.again} testID="log-again">
        <View style={styles.againRow}>
          <PrimaryButton
            label="Log again"
            accessibilityLabel="Log again now"
            busy={again === 'busy'}
            onPress={() => void logAgain(null)}
            style={styles.againButton}
          />
          <Chip
            label="Other time…"
            a11yLabel="Log again at another time"
            onPress={() => setPicker(new Date())}
            testID="again-other-time"
          />
        </View>
        <Text style={styles.sub}>Same amounts as a new meal. This one stays as it is.</Text>
        {againError ? <FormMessage>{againError}</FormMessage> : null}
        {changeable ? (
          <LinkButton
            label="Log a corrected copy"
            align="left"
            onPress={() =>
              router.push({
                pathname: '/log-meal/from-log',
                params: { id: log.id, mode: 'correct' },
              })
            }
          />
        ) : null}
      </View>

      {plan ? (
        <Text style={styles.note}>
          {plan.inDailyPlan
            ? 'Renaming or retiming here doesn’t change the plan meal.'
            : 'Renaming or retiming here doesn’t change the saved meal.'}
        </Text>
      ) : null}
      {!changeable ? (
        <Text style={styles.note}>Meals from before yesterday can’t be changed.</Text>
      ) : null}

      <TimeSheet
        visible={picker !== null}
        now={picker ?? new Date()}
        start={pickerStart(new Date(), picker ?? new Date())}
        onCancel={() => setPicker(null)}
        onDone={(date, time) => {
          setPicker(null);
          void logAgain({ date, time });
        }}
      />
      <DeleteSheet
        log={log}
        plan={plan}
        visible={deleting}
        onClose={() => setDeleting(false)}
        dayKcal={lm.dayKcal(toLondonDate(log.loggedAt))}
        today={lm.today}
      />
    </FormScreen>
  );
}

function PlanPanel({ meal }: { meal: RosterMeal }) {
  return (
    <View style={styles.panel} testID="from-plan">
      <Text style={styles.panelTitle}>
        {meal.inDailyPlan ? `From your plan · ${slotOfPlanMeal(meal)}` : 'From your saved meals'}
      </Text>
      <Text style={styles.sub}>
        {meal.inDailyPlan ? 'Logged from your plan' : `Logged from “${meal.name}”`}
      </Text>
    </View>
  );
}

/** 7l Delete meal: what the day's total becomes; a plan meal comes back as not eaten. */
function DeleteSheet(props: {
  log: MealLog;
  plan: RosterMeal | null;
  visible: boolean;
  onClose: () => void;
  dayKcal: number;
  today: string;
}) {
  const undo = usePendingDelete();
  const t = sumMacros(props.log.items);
  const s = deleteSummary({
    name: props.log.name,
    day: toLondonDate(props.log.loggedAt),
    today: props.today,
    kcal: t.kcal,
    protein: t.protein,
    dayTotal: props.dayKcal,
  });
  const back =
    props.plan?.inDailyPlan === true
      ? planBackNote(slotOfPlanMeal(props.plan), props.plan.usualTime)
      : null;

  // H: hidden now, deleted when Today's "Meal deleted · Undo" note goes (delete_logged_meal).
  const remove = () => {
    undo.schedule(props.log);
    props.onClose();
    backToToday();
  };

  return (
    <BottomSheet visible={props.visible} onClose={props.onClose} testID="sheet-7l">
      <Text style={styles.sheetTitle} accessibilityRole="header">
        {s.title}
      </Text>
      <Text style={styles.sheetBody}>{s.body}</Text>
      <View style={styles.sumCard}>
        <View style={styles.sumRow}>
          <Text style={styles.sumLabel}>{s.nowLabel}</Text>
          <Text style={styles.sumValue}>{s.now}</Text>
        </View>
        <View style={styles.sumRow}>
          <Text style={styles.sumLabel}>Goes down by</Text>
          <Text style={styles.sumValue}>{s.down}</Text>
        </View>
        <View style={styles.sumRow}>
          <Text style={[styles.sumLabel, styles.bold]}>{s.afterLabel}</Text>
          <Text style={[styles.sumValue, styles.bold]}>{s.after}</Text>
        </View>
      </View>
      {back ? (
        <View style={styles.panel} testID="plan-back">
          <Text style={styles.panelText}>
            <Text style={styles.bold}>{back.bold}</Text> {back.rest}
          </Text>
        </View>
      ) : null}
      <PrimaryButton label="Delete meal" onPress={remove} />
      <SecondaryButton label="Cancel" onPress={props.onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  name: { ...type.largeTitle, color: colors.text, marginTop: space.xs },
  when: { ...type.body, color: colors.textSecondary, marginTop: space.xs, marginBottom: space.lg },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    gap: space.sm,
  },
  item: { paddingVertical: space.sm, gap: 2 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  itemName: { ...type.headline, color: colors.text },
  sub: { ...type.footnote, color: colors.textSecondary },
  totals: { flexDirection: 'row', justifyContent: 'space-around' },
  total: { alignItems: 'center' },
  totalValue: { fontSize: 24, fontWeight: '700', color: colors.text },
  note: { ...type.callout, color: colors.textSecondary, marginTop: space.xs },
  panel: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
    gap: 2,
  },
  panelTitle: { ...type.headline, color: colors.text },
  panelText: { ...type.callout, color: colors.text, lineHeight: 21 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  sheetBody: { ...type.callout, color: colors.textSecondary, lineHeight: 21 },
  sumCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  sumLabel: { ...type.callout, color: colors.text },
  sumValue: { ...type.callout, color: colors.text, textAlign: 'right', flexShrink: 1 },
  bold: { fontWeight: '700' },
  again: { marginTop: space.sm, marginBottom: space.md, gap: space.sm },
  againRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  againButton: { flex: 1 },
});
