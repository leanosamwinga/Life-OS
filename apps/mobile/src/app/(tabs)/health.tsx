import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  dayProgress,
  formatGrams,
  formatKcal,
  formatMl,
  formatTimeUK,
  nextSplitDay,
  sumMacros,
  toLondonDate,
  type DayProgress,
  type MealLog,
} from '@life-os/core';
import { Card, ComingIn, PlaceholderBlock, Screen } from '@/components/ui';
import { FormMessage, SecondaryButton } from '@/components/forms';
import { useDay } from '@/features/data/useDay';
import { useNow } from '@/features/data/useNow';
import type { RosterMeal } from '@/lib/backend/foods';
import { useSession } from '@/lib/session';
import {
  sampleCompletedThisCycle,
  sampleMealLogs,
  sampleRotation,
  sampleTargets,
  sampleWaterLogs,
} from '@/data/sample';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

const RANGES = ['Day', 'Week', 'Month'] as const;

export default function HealthScreen() {
  const [range, setRange] = useState<(typeof RANGES)[number]>('Day');
  const today = toLondonDate(useNow());
  const session = useSession();
  const day = useDay(today);
  const live = day.live;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = live
    ? day.progress
    : dayProgress(
        { meals: sampleMealLogs(today), water: sampleWaterLogs(today) },
        sampleTargets,
        today,
      );
  const next = nextSplitDay(sampleRotation, sampleCompletedThisCycle);

  const addWater = async () => {
    if (!session.backend) return;
    setError(null);
    setBusy(true);
    try {
      await session.backend.addWater(250);
      session.notifyDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t add water.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Health" testID="screen-health">
      <View style={styles.segmented} accessibilityRole="tablist">
        {RANGES.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRange(r)}
            accessibilityRole="tab"
            accessibilityState={{ selected: range === r }}
            accessibilityLabel={r}
            style={[styles.segment, range === r && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, range === r && styles.segmentTextActive]}>{r}</Text>
          </Pressable>
        ))}
      </View>

      <Card title="Weight" trailing="Target —">
        <PlaceholderBlock height={40} width="45%" />
        <PlaceholderBlock height={48} />
        <ComingIn phase={3} what="Apple Health" />
      </Card>

      {error ? <FormMessage>{error}</FormMessage> : null}
      {day.consentOff ? (
        <Card title="Nutrition & water">
          <View style={styles.consentOff} testID="health-consent-off">
            <Text style={styles.headline}>Health data is off</Text>
            <Text style={styles.caption}>
              Turn on “Use my health data” in Me to log meals and water. Money, Week and plans keep
              working.
            </Text>
            <SecondaryButton label="Open Me → Privacy" onPress={() => router.push('/me')} />
          </View>
        </Card>
      ) : (
        <>
          <Card title="Nutrition · plan vs eaten" trailing={live ? undefined : 'Plan A'}>
            <View style={styles.bigRow}>
              <View>
                <Text style={styles.big}>{formatKcal(p.kcal.consumed)}</Text>
                <Text style={styles.caption}>
                  {p.kcal.target
                    ? `of ${formatKcal(p.kcal.target)} kcal today`
                    : 'kcal today · no target set'}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/log-meal')}
                accessibilityRole="button"
                accessibilityLabel="Log meal"
                style={styles.darkButton}
              >
                <Text style={styles.darkButtonText}>+ Log meal</Text>
              </Pressable>
            </View>
            <Bar label="Calories" value="" fraction={p.kcal.fraction} hideLabels />
            <Bar label="Protein" value={macroValue(p.protein)} fraction={p.protein.fraction} />
            <Bar label="Carbs" value={macroValue(p.carbs)} fraction={p.carbs.fraction} />
            <Bar label="Fat" value={macroValue(p.fat)} fraction={p.fat.fraction} />
            {live ? <MealList progress={p} roster={day.data.roster} /> : null}
          </Card>

          <Card title="Water">
            <View style={styles.bigRow}>
              <Text
                style={styles.waterBig}
                accessibilityLabel={`Water: ${formatMl(p.water.consumed)} of ${p.water.target ? formatMl(p.water.target) : 'no target'}`}
              >
                {formatMl(p.water.consumed)}
                {p.water.target ? ` of ${formatMl(p.water.target)}` : ''}
              </Text>
              {live ? (
                <Pressable
                  onPress={() => void addWater()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Add 250 ml of water"
                  accessibilityState={{ disabled: busy, busy }}
                  style={[styles.darkButton, busy && styles.disabled]}
                >
                  <Text style={styles.darkButtonText}>+ 250 ml</Text>
                </Pressable>
              ) : null}
            </View>
            <WaterGlasses consumed={p.water.consumed} target={p.water.target} />
            {live ? null : <ComingIn phase={2} what="+ 250 ml quick add" />}
          </Card>
        </>
      )}

      <View style={styles.pair}>
        <Card title="Sleep" style={styles.half}>
          <PlaceholderBlock height={24} width="70%" />
          <ComingIn phase={3} what="Apple Health" />
        </Card>
        <Card title="Steps" style={styles.half}>
          <PlaceholderBlock height={24} width="70%" />
          <ComingIn phase={3} what="Apple Health" />
        </Card>
      </View>

      <Card title="Supplements">
        <ComingIn phase={3} what="Daily supplements" />
      </Card>

      {live ? (
        <Card title="Training this week">
          <ComingIn phase={3} what="Strava sync and “Log workout in Liftoff”" />
        </Card>
      ) : (
        <Card
          title={`Training this week · ${sampleCompletedThisCycle} of ${sampleRotation.targetPerWeek}`}
          trailing="Liftoff via Strava"
        >
          <Text style={styles.headline}>
            Next: Day {next.day} · {next.name}
          </Text>
          <Text style={styles.caption}>
            Split: {sampleRotation.days.map((d) => `${d.day} ${d.name}`).join(' · ')}
          </Text>
          <ComingIn phase={3} what="Strava sync and “Log workout in Liftoff”" />
        </Card>
      )}
    </Screen>
  );
}

const macroValue = (m: DayProgress['protein']) =>
  m.target ? `${Math.round(m.consumed)} / ${m.target} g` : `${Math.round(m.consumed)} g`;

function Bar({
  label,
  value,
  fraction,
  hideLabels,
}: {
  label: string;
  value: string;
  fraction: number;
  hideLabels?: boolean;
}) {
  return (
    <View
      style={styles.bar}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={hideLabels ? label : `${label}: ${value}`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      {hideLabels ? null : (
        <View style={styles.barLabels}>
          <Text style={styles.barLabel}>{label}</Text>
          <Text style={styles.barLabel}>{value}</Text>
        </View>
      )}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round(fraction * 100)}%` }]} />
      </View>
    </View>
  );
}

const describe = (items: { foodName: string; grams: number }[]) =>
  items
    .slice(0, 3)
    .map((i) => `${i.foodName} ${formatGrams(i.grams)}`)
    .join(' · ');

/** Plan meals (eaten or not) and other meals logged today, under the macro bars. */
function MealList({ progress, roster }: { progress: DayProgress; roster: RosterMeal[] }) {
  const byPlan = new Map<string, MealLog>();
  for (const m of progress.meals) if (m.savedMealId) byPlan.set(m.savedMealId, m);
  const plan = roster
    .filter((m) => m.inDailyPlan)
    .sort((a, b) => (a.usualTime ?? '').localeCompare(b.usualTime ?? ''));
  const planIds = new Set(plan.map((m) => m.id));
  const rows = [
    ...plan.map((m) => {
      const log = byPlan.get(m.id);
      return log
        ? {
            key: log.id,
            done: true,
            title: m.name,
            sub: describe(log.items),
            kcal: sumMacros(log.items).kcal,
          }
        : {
            key: m.id,
            done: false,
            title: m.name,
            sub: describe(m.components.map((c) => ({ foodName: c.food.name, grams: c.grams }))),
            kcal: sumMacros(m.components).kcal,
          };
    }),
    ...progress.meals
      .filter((m) => !m.savedMealId || !planIds.has(m.savedMealId))
      .map((m) => ({
        key: m.id,
        done: true,
        title: m.name,
        sub: `${formatTimeUK(m.loggedAt)} · ${describe(m.items)}`,
        kcal: sumMacros(m.items).kcal,
      })),
  ];
  if (rows.length === 0) {
    return <Text style={[styles.caption, styles.mealsEmpty]}>No meals logged today yet.</Text>;
  }
  return (
    <View style={styles.meals}>
      {rows.map((r) => (
        <View
          key={r.key}
          style={styles.mealRow}
          accessible
          accessibilityLabel={`${r.title}, ${r.done ? 'eaten' : 'planned'}, ${formatKcal(r.kcal)} kcal`}
        >
          <View style={[styles.check, r.done && styles.checkOn]}>
            {r.done ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          <View style={styles.mealText}>
            <Text style={styles.mealTitle}>{r.title}</Text>
            <Text style={styles.caption} numberOfLines={1}>
              {r.sub}
            </Text>
          </View>
          <Text style={styles.mealKcal}>{formatKcal(r.kcal)}</Text>
        </View>
      ))}
    </View>
  );
}

/** 250 ml glasses toward the target (wireframe water card). */
function WaterGlasses({ consumed, target }: { consumed: number; target: number }) {
  const glasses = Math.min(24, Math.max(1, Math.ceil((target || 3000) / 250)));
  const filled = Math.min(glasses, Math.floor(consumed / 250));
  return (
    <View style={styles.glasses} importantForAccessibility="no-hide-descendants">
      {Array.from({ length: glasses }, (_, i) => (
        <View key={i} style={[styles.glass, i < filled && styles.glassOn]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  consentOff: { gap: space.sm, paddingVertical: space.sm },
  disabled: { opacity: 0.5 },
  waterBig: { fontSize: 28, fontWeight: '700', color: colors.text, flexShrink: 1 },
  glasses: { flexDirection: 'row', gap: 4, marginVertical: space.md },
  glass: { flex: 1, height: 20, borderRadius: 4, backgroundColor: colors.track },
  glassOn: { backgroundColor: colors.fill },
  meals: {
    marginTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  mealsEmpty: { marginTop: space.md, paddingVertical: space.sm },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TOUCH + 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.fill },
  tick: { color: colors.inverseText, fontSize: 14, fontWeight: '700' },
  mealText: { flex: 1 },
  mealTitle: { ...type.headline, color: colors.text },
  mealKcal: { ...type.callout, color: colors.text },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: space.lg,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.background },
  segmentText: { ...type.callout, color: colors.textSecondary },
  segmentTextActive: { color: colors.text, fontWeight: '600' },
  bigRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  big: { fontSize: 34, fontWeight: '700', color: colors.text },
  headline: { ...type.headline, color: colors.text },
  caption: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  darkButton: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.fill,
    justifyContent: 'center',
  },
  darkButtonText: { ...type.headline, color: colors.inverseText },
  bar: { marginTop: space.md },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barLabel: { ...type.callout, color: colors.text },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.track, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.fill },
  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
});
