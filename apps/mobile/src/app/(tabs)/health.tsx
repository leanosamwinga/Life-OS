import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { dayProgress, formatKcal, formatMl, nextSplitDay, toLondonDate } from '@life-os/core';
import { Card, ComingIn, PlaceholderBlock, Screen } from '@/components/ui';
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
  const today = toLondonDate(new Date());
  const p = dayProgress(
    { meals: sampleMealLogs(today), water: sampleWaterLogs(today) },
    sampleTargets,
    today,
  );
  const next = nextSplitDay(sampleRotation, sampleCompletedThisCycle);

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

      <Card title="Nutrition · plan vs eaten" trailing="Plan A">
        <View style={styles.bigRow}>
          <View>
            <Text style={styles.big}>{formatKcal(p.kcal.consumed)}</Text>
            <Text style={styles.caption}>of {formatKcal(p.kcal.target)} kcal today</Text>
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
        <Bar
          label="Protein"
          value={`${Math.round(p.protein.consumed)} / ${p.protein.target} g`}
          fraction={p.protein.fraction}
        />
        <Bar
          label="Carbs"
          value={`${Math.round(p.carbs.consumed)} / ${p.carbs.target} g`}
          fraction={p.carbs.fraction}
        />
        <Bar
          label="Fat"
          value={`${Math.round(p.fat.consumed)} / ${p.fat.target} g`}
          fraction={p.fat.fraction}
        />
      </Card>

      <Card title="Water">
        <Text style={styles.big}>
          {formatMl(p.water.consumed)} of {formatMl(p.water.target)}
        </Text>
        <ComingIn phase={2} what="+ 250 ml quick add" />
      </Card>

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
    </Screen>
  );
}

function Bar({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  return (
    <View
      style={styles.bar}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
    >
      <View style={styles.barLabels}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barLabel}>{value}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round(fraction * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
