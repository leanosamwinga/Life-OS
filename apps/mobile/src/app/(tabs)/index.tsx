import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  ateItAt,
  dayProgress,
  formatCount,
  formatDateUK,
  formatKcal,
  formatMl,
  formatPence,
  nextSplitDay,
  snapshotComponents,
  toLondonDate,
  toLondonTime,
  viewDate,
  type MealLog,
  type TodayView,
} from '@life-os/core';
import { Avatar, Card, OutlineButton, Overline, Row, Screen } from '@/components/ui';
import { FormMessage, SecondaryButton } from '@/components/forms';
import { useDay } from '@/features/data/useDay';
import { useNow } from '@/features/data/useNow';
import { usePendingDelete } from '@/features/today/PendingDelete';
import { useSession } from '@/lib/session';
import { Ring } from '@/components/Ring';
import {
  sampleCalendar,
  sampleCompletedThisCycle,
  sampleMealLogs,
  samplePlanMeals,
  sampleRotation,
  sampleSleepMinutes,
  sampleSteps,
  sampleTargets,
  sampleWaterLogs,
} from '@/data/sample';
import { buildTimeline, nowIndex, type TimelineItem } from '@/features/today/timeline';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** Re-render every minute so the "Now" line moves. */
const formatSleep = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

/** Ring value for a metric with no target yet, or not tracked until a later phase. */
const DASH = '—';

export default function TodayScreen() {
  const now = useNow();
  const today = toLondonDate(now);
  const session = useSession();
  const undo = usePendingDelete();
  // C: "‹ Yesterday" shows yesterday's timeline (the edit window); nothing older.
  const [chosenView, setView] = useState<TodayView>('today');
  const canSeeYesterday = session.status === 'signedIn' && session.healthConsent;
  const view: TodayView = canSeeYesterday ? chosenView : 'today';
  const yesterday = view === 'yesterday';
  const shownDate = viewDate(view, now);
  // H: a meal waiting on "Undo" is hidden (a plan meal shows as not eaten meanwhile).
  const day = useDay(shownDate, undo.pending ? [undo.pending.id] : []);
  const [extraLogs, setExtraLogs] = useState<MealLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const live = day.live;

  // Not connected: sample data. Signed in: the user's own data (steps/sleep arrive in phase 3).
  const sampleLogs = useMemo(() => [...sampleMealLogs(today), ...extraLogs], [today, extraLogs]);
  const progress = live
    ? day.progress
    : dayProgress(
        { meals: sampleLogs, water: sampleWaterLogs(today), steps: sampleSteps },
        sampleTargets,
        today,
      );
  const planMeals = live ? day.data.roster.filter((m) => m.inDailyPlan) : samplePlanMeals;
  // Yesterday: only the meals logged, in time order; no plan, no "Now" line, no "Ate it".
  const timeline = buildTimeline({
    mealLogs: progress.meals,
    planMeals: yesterday ? [] : planMeals,
    calendar: live ? [] : sampleCalendar,
  });
  const nowAt = yesterday ? -1 : nowIndex(timeline, toLondonTime(now));
  const nextDay = nextSplitDay(sampleRotation, sampleCompletedThisCycle);

  const ateIt = async (savedMealId: string) => {
    const meal = planMeals.find((m) => m.id === savedMealId);
    if (!meal) return;
    // F: at its usual time today once that has passed, otherwise now.
    const loggedAt = ateItAt(meal.usualTime, new Date());
    if (live && session.backend) {
      setError(null);
      try {
        await session.backend.logMeal({
          name: meal.name,
          savedMealId: meal.id,
          loggedAt,
          components: meal.components,
        });
        session.notifyDataChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Couldn’t log that meal.');
      }
      return;
    }
    setExtraLogs((logs) => [
      ...logs,
      {
        id: `log-${meal.id}-${Date.now()}`,
        userId: meal.userId,
        savedMealId: meal.id,
        name: meal.name,
        loggedAt,
        items: snapshotComponents(meal.components),
      },
    ]);
  };

  return (
    <Screen
      testID="screen-today"
      title="Today"
      subtitle={
        yesterday
          ? `Yesterday · ${formatDateUK(shownDate)}`
          : live
            ? formatDateUK(today)
            : `${formatDateUK(today)} · rest day`
      }
      accessory={<Avatar size={60} label={session.displayName ?? 'Profile'} />}
      footer={
        yesterday ? undefined : (
          <Pressable
            onPress={() => router.push('/log-meal')}
            accessibilityRole="button"
            accessibilityLabel="Log meal"
            style={({ pressed }) => [styles.fab, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.fabText}>+ Log meal</Text>
          </Pressable>
        )
      }
    >
      <View style={styles.rings}>
        <Ring
          fraction={progress.kcal.fraction}
          value={day.consentOff ? DASH : formatKcal(progress.kcal.consumed)}
          label="kcal"
          accessibilityLabel={
            day.consentOff
              ? 'Calories: health data is off'
              : `${yesterday ? 'Yesterday’s calories' : 'Calories'}: ${formatKcal(progress.kcal.consumed)} of ${progress.kcal.target ? formatKcal(progress.kcal.target) : 'no target set'}`
          }
        />
        <Ring
          fraction={progress.water.fraction}
          value={day.consentOff ? DASH : formatMl(progress.water.consumed)}
          label="water"
          accessibilityLabel={
            day.consentOff
              ? 'Water: health data is off'
              : `${yesterday ? 'Yesterday’s water' : 'Water'}: ${formatMl(progress.water.consumed)} of ${progress.water.target ? formatMl(progress.water.target) : 'no target set'}`
          }
        />
        {yesterday ? null : live ? (
          <>
            <Ring
              fraction={0}
              value={DASH}
              label="steps"
              accessibilityLabel="Steps: from Apple Health in a later update"
            />
            <Ring
              fraction={0}
              value={DASH}
              label="sleep"
              accessibilityLabel="Sleep: from Apple Health in a later update"
            />
          </>
        ) : (
          <>
            <Ring
              fraction={progress.steps.fraction}
              value={formatCount(progress.steps.consumed)}
              label="steps"
              accessibilityLabel={`Steps: ${formatCount(progress.steps.consumed)} of ${formatCount(progress.steps.target)}`}
            />
            <Ring
              fraction={sampleSleepMinutes / (8 * 60)}
              value={formatSleep(sampleSleepMinutes)}
              label="sleep"
              accessibilityLabel={`Sleep: ${formatSleep(sampleSleepMinutes)}`}
            />
          </>
        )}
      </View>

      {error || day.error || undo.error ? (
        <FormMessage>{error ?? undo.error ?? day.error ?? ''}</FormMessage>
      ) : null}
      {undo.pending ? <UndoNote onUndo={undo.undo} onDismiss={undo.commit} /> : null}
      {live && !yesterday && !day.targetsSet && !day.consentOff ? (
        <Row
          label="Set your daily targets"
          subtitle="Calories, protein, carbs, fat and water"
          chevron
          onPress={() => router.push('/targets')}
        />
      ) : null}

      <View style={[styles.section, styles.sectionRow]}>
        <Overline>{yesterday ? 'Yesterday' : 'Your day'}</Overline>
        {canSeeYesterday ? (
          <Pressable
            onPress={() => setView(yesterday ? 'today' : 'yesterday')}
            accessibilityRole="button"
            accessibilityLabel={yesterday ? 'Back to today' : 'See yesterday'}
            hitSlop={8}
            style={styles.dayLink}
            testID={yesterday ? 'show-today' : 'show-yesterday'}
          >
            <Text style={styles.dayLinkText}>{yesterday ? 'Today ›' : '‹ Yesterday'}</Text>
          </Pressable>
        ) : null}
      </View>
      {day.consentOff ? (
        <View style={styles.consentOff} testID="today-consent-off">
          <Text style={styles.consentTitle}>Health data is off</Text>
          <Text style={styles.emptyText}>
            Meals and water need your permission. Turn on “Use my health data” in Me; the rest of
            the app keeps working.
          </Text>
          <SecondaryButton label="Open Me → Privacy" onPress={() => router.push('/me')} />
        </View>
      ) : (
        <Timeline
          items={timeline}
          nowAt={nowAt}
          nowLabel={toLondonTime(now)}
          testID={yesterday ? 'timeline-yesterday' : 'timeline'}
          onAteIt={(id) => void ateIt(id)}
          onOpen={
            live ? (id) => router.push({ pathname: '/meal/[id]', params: { id } }) : undefined
          }
          emptyText={
            live && day.loading
              ? 'Loading your day…'
              : yesterday
                ? 'Nothing logged yesterday.'
                : 'Nothing planned yet. Log a meal or add plan meals to your roster.'
          }
        />
      )}

      {yesterday ? null : live ? (
        <Card variant="filled" style={styles.elsewhere}>
          <Row label="Money" pill="Later" muted />
          <Row label="Sunday service" pill="Later" muted />
          <Row label="Training" pill="Later" muted />
          <Row label="Habits & journal" pill="Later" muted last />
        </Card>
      ) : (
        <Card variant="filled" style={styles.elsewhere}>
          <Row
            label="Money"
            detail={`Last month ${formatPence(3800)} under`}
            chevron
            onPress={() => router.push('/money')}
          />
          <Row label="Sunday service" detail="Notion · phase 4" chevron muted />
          <Row
            label="Training"
            detail={`${sampleCompletedThisCycle} of ${sampleRotation.targetPerWeek} · Day ${nextDay.day} ${nextDay.name} next`}
            chevron
            onPress={() => router.push('/health')}
          />
          <Row label="Habits & journal" pill="Later" muted last />
        </Card>
      )}
    </Screen>
  );
}

function Timeline(props: {
  items: TimelineItem[];
  nowAt: number;
  nowLabel: string;
  onAteIt: (savedMealId: string) => void;
  /** 7j: open a logged meal. Absent for sample data. */
  onOpen?: (mealLogId: string) => void;
  emptyText: string;
  testID: string;
}) {
  if (props.items.length === 0) {
    return (
      <View style={styles.empty} testID="timeline-empty">
        <Text style={styles.emptyText}>{props.emptyText}</Text>
      </View>
    );
  }
  const rows: ReactNode[] = [];
  props.items.forEach((item, i) => {
    if (i === props.nowAt) rows.push(<NowLine key="now" label={props.nowLabel} />);
    rows.push(
      <TimelineRow
        key={item.id}
        item={item}
        past={i < props.nowAt}
        onAteIt={props.onAteIt}
        onOpen={props.onOpen}
      />,
    );
  });
  if (props.nowAt === props.items.length) rows.push(<NowLine key="now" label={props.nowLabel} />);
  return <View testID={props.testID}>{rows}</View>;
}

/** H: "Meal deleted · Undo", for about five seconds after 7l's "Delete meal". */
function UndoNote(props: { onUndo: () => void; onDismiss: () => void }) {
  return (
    <View style={styles.undo} testID="undo-note" accessibilityLiveRegion="polite">
      <Text style={styles.undoText} accessibilityRole="text">
        Meal deleted ·
      </Text>
      <Pressable
        onPress={props.onUndo}
        accessibilityRole="button"
        accessibilityLabel="Undo delete"
        style={styles.undoButton}
        testID="undo-delete"
      >
        <Text style={styles.undoAction}>Undo</Text>
      </Pressable>
      <Pressable
        onPress={props.onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.undoButton}
      >
        <Text style={styles.undoDismiss}>×</Text>
      </Pressable>
    </View>
  );
}

function NowLine({ label }: { label: string }) {
  return (
    <View style={styles.nowLine} accessible accessibilityLabel={`Now, ${label}`}>
      <Text style={styles.nowTime}>{label}</Text>
      <View style={styles.nowRule} />
      <Text style={styles.nowText}>Now</Text>
    </View>
  );
}

function Marker({ kind }: { kind: TimelineItem['kind'] }) {
  switch (kind) {
    case 'meal-eaten':
      return (
        <View style={[styles.marker, styles.markerEaten]}>
          <Text style={styles.tick}>✓</Text>
        </View>
      );
    case 'meal-planned':
      return <View style={[styles.marker, styles.markerPlanned]} />;
    case 'event':
      return <View style={[styles.marker, styles.markerEvent]} />;
    case 'rhythm':
      return <View style={[styles.marker, styles.markerRhythm]} />;
    case 'checkin':
      return <View style={[styles.marker, styles.markerCheckin]} />;
  }
}

const KIND_LABEL: Record<TimelineItem['kind'], string> = {
  'meal-eaten': 'eaten',
  'meal-planned': 'planned meal',
  event: 'calendar event',
  rhythm: 'weekly rhythm',
  checkin: 'check-in',
};

function TimelineRow(props: {
  item: TimelineItem;
  past: boolean;
  onAteIt: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  const { item } = props;
  const muted = props.past;
  const label = [item.time, item.title, item.subtitle, KIND_LABEL[item.kind]]
    .filter(Boolean)
    .join(', ');
  const content = (
    <>
      <Text style={[styles.tlTime, !muted && styles.tlTimeStrong]}>{item.time}</Text>
      <Marker kind={item.kind} />
      <View style={styles.tlText}>
        <Text style={[styles.tlTitle, !muted && styles.tlTitleStrong]}>{item.title}</Text>
        {item.subtitle ? <Text style={styles.tlSubtitle}>{item.subtitle}</Text> : null}
      </View>
    </>
  );
  const open = item.kind === 'meal-eaten' ? props.onOpen : undefined;
  return (
    <View style={styles.tlRow}>
      {open ? (
        <Pressable
          onPress={() => open(item.id)}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Opens the meal"
          style={({ pressed }) => [styles.tlMain, pressed && { opacity: 0.6 }]}
          testID={`open-${item.id}`}
        >
          {content}
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : (
        <View style={styles.tlMain} accessible accessibilityLabel={label}>
          {content}
        </View>
      )}
      {item.kind === 'meal-planned' && item.savedMealId ? (
        <OutlineButton
          label="Ate it"
          accessibilityLabel={`Ate it: ${item.title}`}
          onPress={() => props.onAteIt(item.savedMealId!)}
        />
      ) : null}
    </View>
  );
}

const MARKER = 36;

const styles = StyleSheet.create({
  rings: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xl },
  section: { marginBottom: space.sm },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayLink: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center' },
  dayLinkText: { ...type.callout, color: colors.textSecondary },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingLeft: space.lg,
    marginBottom: space.md,
  },
  undoText: { ...type.callout, color: colors.text, flex: 1 },
  undoButton: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  undoAction: { ...type.headline, color: colors.text },
  undoDismiss: { fontSize: 20, color: colors.textSecondary },
  tlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH + 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: space.sm,
  },
  tlMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
  tlTime: { ...type.callout, color: colors.textSecondary, width: 56 },
  tlTimeStrong: { color: colors.text, fontWeight: '600' },
  tlText: { flex: 1, marginLeft: space.lg },
  tlTitle: { ...type.body, color: colors.textSecondary },
  tlTitleStrong: { color: colors.text, fontWeight: '600' },
  tlSubtitle: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 24, color: colors.textSecondary, marginLeft: space.sm },
  marker: { width: MARKER, height: MARKER, alignItems: 'center', justifyContent: 'center' },
  markerEaten: { borderRadius: MARKER / 2, backgroundColor: colors.fill },
  tick: { color: colors.inverseText, fontSize: 18, fontWeight: '700' },
  markerPlanned: { borderRadius: MARKER / 2, borderWidth: 2, borderColor: colors.fill },
  markerEvent: { borderRadius: radius.sm, backgroundColor: colors.fill },
  markerRhythm: {
    borderRadius: radius.sm,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.fill,
  },
  markerCheckin: { borderRadius: MARKER / 2, backgroundColor: colors.track },
  nowLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, gap: space.md },
  nowTime: { ...type.callout, fontWeight: '700', color: colors.text, width: 56 },
  nowRule: { flex: 1, height: 2, backgroundColor: colors.fill },
  nowText: { ...type.callout, fontWeight: '700', color: colors.text },
  empty: { paddingVertical: space.xl },
  emptyText: { ...type.callout, color: colors.textSecondary },
  elsewhere: { marginTop: space.xl },
  consentOff: { paddingVertical: space.md, gap: space.sm },
  consentTitle: { ...type.headline, color: colors.text },
  fab: {
    position: 'absolute',
    right: space.xl,
    bottom: space.xl,
    minHeight: 56,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { ...type.headline, color: colors.inverseText, fontSize: 20 },
});
