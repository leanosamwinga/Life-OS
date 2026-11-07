import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
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
  type MealLog,
} from '@life-os/core';
import { Avatar, Card, OutlineButton, Overline, Row, Screen } from '@/components/ui';
import { FormMessage, SecondaryButton } from '@/components/forms';
import { useDay } from '@/features/data/useDay';
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
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const formatSleep = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

/** Ring value for a metric with no target yet, or not tracked until a later phase. */
const DASH = '—';

export default function TodayScreen() {
  const now = useNow();
  const today = toLondonDate(now);
  const session = useSession();
  const day = useDay(today);
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
  const timeline = buildTimeline({
    mealLogs: progress.meals,
    planMeals,
    calendar: live ? [] : sampleCalendar,
  });
  const nowAt = nowIndex(timeline, toLondonTime(now));
  const nextDay = nextSplitDay(sampleRotation, sampleCompletedThisCycle);

  const ateIt = async (savedMealId: string) => {
    const meal = planMeals.find((m) => m.id === savedMealId);
    if (!meal) return;
    if (live && session.backend) {
      setError(null);
      try {
        await session.backend.logMeal({
          name: meal.name,
          savedMealId: meal.id,
          loggedAt: new Date().toISOString(),
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
        loggedAt: new Date().toISOString(),
        items: snapshotComponents(meal.components),
      },
    ]);
  };

  return (
    <Screen
      testID="screen-today"
      title="Today"
      subtitle={live ? formatDateUK(today) : `${formatDateUK(today)} · rest day`}
      accessory={<Avatar size={60} label={session.displayName ?? 'Profile'} />}
      footer={
        <Pressable
          onPress={() => router.push('/log-meal')}
          accessibilityRole="button"
          accessibilityLabel="Log meal"
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.fabText}>+ Log meal</Text>
        </Pressable>
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
              : `Calories: ${formatKcal(progress.kcal.consumed)} of ${progress.kcal.target ? formatKcal(progress.kcal.target) : 'no target set'}`
          }
        />
        <Ring
          fraction={progress.water.fraction}
          value={day.consentOff ? DASH : formatMl(progress.water.consumed)}
          label="water"
          accessibilityLabel={
            day.consentOff
              ? 'Water: health data is off'
              : `Water: ${formatMl(progress.water.consumed)} of ${progress.water.target ? formatMl(progress.water.target) : 'no target set'}`
          }
        />
        {live ? (
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

      {error || day.error ? <FormMessage>{error ?? day.error ?? ''}</FormMessage> : null}
      {live && !day.targetsSet && !day.consentOff ? (
        <Row
          label="Set your daily targets"
          subtitle="Calories, protein, carbs, fat and water"
          chevron
          onPress={() => router.push('/targets')}
        />
      ) : null}

      <View style={styles.section}>
        <Overline>Your day</Overline>
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
          onAteIt={(id) => void ateIt(id)}
          emptyText={
            live && day.loading
              ? 'Loading your day…'
              : 'Nothing planned yet. Log a meal or add plan meals to your roster.'
          }
        />
      )}

      {live ? (
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
  emptyText: string;
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
      <TimelineRow key={item.id} item={item} past={i < props.nowAt} onAteIt={props.onAteIt} />,
    );
  });
  if (props.nowAt === props.items.length) rows.push(<NowLine key="now" label={props.nowLabel} />);
  return <View testID="timeline">{rows}</View>;
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

function TimelineRow(props: { item: TimelineItem; past: boolean; onAteIt: (id: string) => void }) {
  const { item } = props;
  const muted = props.past;
  return (
    <View style={styles.tlRow}>
      <View
        style={styles.tlMain}
        accessible
        accessibilityLabel={[item.time, item.title, item.subtitle, KIND_LABEL[item.kind]]
          .filter(Boolean)
          .join(', ')}
      >
        <Text style={[styles.tlTime, !muted && styles.tlTimeStrong]}>{item.time}</Text>
        <Marker kind={item.kind} />
        <View style={styles.tlText}>
          <Text style={[styles.tlTitle, !muted && styles.tlTitleStrong]}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.tlSubtitle}>{item.subtitle}</Text> : null}
        </View>
      </View>
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
