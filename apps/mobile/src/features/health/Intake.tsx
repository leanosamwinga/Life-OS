import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  componentUnit,
  formatAmount,
  formatKcal,
  formatMl,
  formatTimeUK,
  sumMacros,
  WATER_QUICK_ADD_ML,
  type AmountUnit,
  type DayProgress,
  type MealLog,
  type WaterLog,
} from '@life-os/core';
import { Card } from '@/components/ui';
import { FormMessage } from '@/components/forms';
import type { RosterMeal } from '@/lib/backend/foods';
import { TodayWaterSheet, WaterAmountSheet } from '@/features/water/WaterSheets';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';
import { Bar, Button, KcalRing } from './parts';

const macroValue = (m: DayProgress['protein']) =>
  m.target ? `${Math.round(m.consumed)} / ${m.target} g` : `${Math.round(m.consumed)} g`;

/** 1B Nutrition · plan vs eaten: kcal ring, macro bars, plan and logged meals, "+ Log meal". */
export function NutritionCard(props: {
  progress: DayProgress;
  roster: RosterMeal[] | null;
  planName: string | null;
}) {
  const p = props.progress;
  return (
    <Card title="Nutrition · plan vs eaten" trailing={props.planName ?? undefined}>
      <View style={styles.body}>
        <View
          style={styles.nutritionTop}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={
            p.kcal.target
              ? `Calories: ${formatKcal(p.kcal.consumed)} of ${formatKcal(p.kcal.target)} kcal today`
              : `Calories: ${formatKcal(p.kcal.consumed)} kcal today, no target set`
          }
          accessibilityValue={{ min: 0, max: 100, now: Math.round(p.kcal.fraction * 100) }}
        >
          <KcalRing
            fraction={p.kcal.fraction}
            value={formatKcal(p.kcal.consumed)}
            caption={p.kcal.target ? `of ${formatKcal(p.kcal.target)} kcal` : 'kcal · no target'}
          />
          <View style={styles.macros}>
            {(['protein', 'carbs', 'fat'] as const).map((k) => (
              <Bar
                key={k}
                label={k === 'protein' ? 'Protein' : k === 'carbs' ? 'Carbs' : 'Fat'}
                value={macroValue(p[k])}
                fraction={p[k].fraction}
                accessibilityLabel={`${k === 'protein' ? 'Protein' : k === 'carbs' ? 'Carbs' : 'Fat'}: ${macroValue(p[k])}`}
              />
            ))}
          </View>
        </View>
        {props.roster ? <MealList progress={p} roster={props.roster} /> : null}
        <Button
          label="+ Log meal"
          accessibilityLabel="Log meal"
          onPress={() => router.push('/log-meal')}
        />
      </View>
    </Card>
  );
}

const describe = (items: { foodName: string; grams: number; unit?: AmountUnit }[]) =>
  items
    .slice(0, 3)
    .map((i) => `${i.foodName} ${formatAmount(i.grams, i.unit ?? 'g')}`)
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
            sub: describe(
              m.components.map((c) => ({
                foodName: c.food.name,
                grams: c.grams,
                unit: componentUnit(c),
              })),
            ),
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

/**
 * Water, as before Phase 3: the total (tap to list today's water), "+ 250 ml", "Other amount…"
 * and the glasses.
 */
export function WaterCard(props: { progress: DayProgress; water: WaterLog[]; live: boolean }) {
  const session = useSession();
  const p = props.progress;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'amount' | 'today' | null>(null);
  const label = `Water: ${formatMl(p.water.consumed)} of ${p.water.target ? formatMl(p.water.target) : 'no target'}`;
  const total = (
    <Text style={styles.waterBig}>
      {formatMl(p.water.consumed)}
      {p.water.target ? ` of ${formatMl(p.water.target)}` : ''}
    </Text>
  );

  const addWater = async () => {
    if (!session.backend) return;
    setError(null);
    setBusy(true);
    try {
      await session.backend.addWater(WATER_QUICK_ADD_ML);
      session.notifyDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t add water.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Water">
      {error ? <FormMessage>{error}</FormMessage> : null}
      {props.live ? (
        <Pressable
          onPress={() => setSheet('today')}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Shows today’s water"
          style={styles.waterTotal}
          testID="water-total"
        >
          {total}
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label} style={styles.waterTotal}>
          {total}
        </View>
      )}
      {props.live ? (
        <View style={styles.waterButtons}>
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
          <Pressable
            onPress={() => setSheet('amount')}
            accessibilityRole="button"
            accessibilityLabel="Other amount of water"
            style={styles.outlineButton}
            testID="water-other"
          >
            <Text style={styles.outlineButtonText}>Other amount…</Text>
          </Pressable>
        </View>
      ) : null}
      <WaterGlasses consumed={p.water.consumed} target={p.water.target} />
      {props.live ? (
        <>
          <WaterAmountSheet
            visible={sheet === 'amount'}
            onClose={() => setSheet(null)}
            onAdd={async (ml) => {
              await session.backend!.addWater(ml);
              session.notifyDataChanged();
            }}
          />
          <TodayWaterSheet
            visible={sheet === 'today'}
            onClose={() => setSheet(null)}
            logs={props.water}
            onDelete={async (id) => {
              await session.backend!.deleteWater(id);
              session.notifyDataChanged();
            }}
          />
        </>
      ) : null}
    </Card>
  );
}

/** 250 ml glasses toward the target (wireframe water card). */
function WaterGlasses({ consumed, target }: { consumed: number; target: number }) {
  const glasses = Math.min(24, Math.max(1, Math.ceil((target || 3000) / 250)));
  const filled = Math.min(glasses, Math.floor(consumed / 250));
  return (
    <View
      style={styles.glasses}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${filled} of ${glasses} glasses`}
    >
      {Array.from({ length: glasses }, (_, i) => (
        <View key={i} style={[styles.glass, i < filled && styles.glassOn]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.sm },
  nutritionTop: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  macros: { flex: 1, gap: 10 },
  disabled: { opacity: 0.5 },
  waterBig: { fontSize: 28, fontWeight: '700', color: colors.text, flexShrink: 1 },
  glasses: { flexDirection: 'row', gap: 4, marginVertical: space.md },
  glass: { flex: 1, height: 24, borderRadius: 6, backgroundColor: colors.track },
  glassOn: { backgroundColor: colors.fill },
  meals: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  mealsEmpty: { paddingVertical: space.sm },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TOUCH + 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.fill },
  tick: { color: colors.inverseText, fontSize: 13, fontWeight: '700' },
  mealText: { flex: 1 },
  mealTitle: { ...type.headline, fontSize: 16, color: colors.text },
  mealKcal: { ...type.callout, color: colors.text },
  caption: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  darkButton: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.fill,
    justifyContent: 'center',
  },
  darkButtonText: { ...type.headline, color: colors.inverseText },
  outlineButton: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.text,
    justifyContent: 'center',
  },
  outlineButtonText: { ...type.headline, color: colors.text },
  waterButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  waterTotal: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH, flexShrink: 1 },
  chevron: { fontSize: 24, color: colors.textSecondary, marginLeft: space.sm },
});
