import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  adherence,
  averageOfDays,
  elapsedDays,
  formatAdherence,
  formatCount,
  formatKcal,
  formatKg1,
  formatKgChange,
  formatMl,
  formatPeriod,
  formatSleep,
  formatSteps,
  hitTarget,
  kcalWithinTarget,
  monthName,
  periodOf,
  sessionsOn,
  shiftPeriod,
  splitShortName,
  sumMacros,
  toLondonDate,
  trainingTargetFor,
  weekdayShort,
  weightChange,
  type LocalDate,
  type Macros,
  type Period,
  type PeriodKind,
} from '@life-os/core';
import { Card } from '@/components/ui';
import { FormMessage } from '@/components/forms';
import { supplementLabel } from '@/lib/backend/health';
import { DEFAULT_HEALTH_TARGETS } from '@/lib/backend/settings';
import { useSession } from '@/lib/session';
import {
  sampleHealthTargets,
  sampleHealthValues,
  sampleMealLogs,
  sampleSupplementLogs,
  sampleSupplements,
  sampleTargets,
  sampleTraining,
  sampleWaterLogs,
} from '@/data/sample';
import { colors, MIN_TOUCH, space, type } from '@/theme';
import { useAppleHealth, type AppleHealthAccess } from './AppleHealth';
import { COPY } from './Body';
import { Sparkline, WeightLine } from './charts';
import { ConsentOffCard } from './DayView';
import { Bar, Big, Body, Muted, Pair, healthStyles } from './parts';
import { useHealthPeriod, valuesOf, type HealthPeriodData } from './useHealthData';

/** Per-day totals of what was eaten and drunk (London days). */
function dailyTotals(data: HealthPeriodData) {
  const eaten = new Map<LocalDate, Macros>();
  const byDay = new Map<LocalDate, typeof data.meals>();
  for (const m of data.meals) {
    const d = toLondonDate(m.loggedAt);
    byDay.set(d, [...(byDay.get(d) ?? []), m]);
  }
  for (const [d, meals] of byDay) eaten.set(d, sumMacros(meals.flatMap((m) => m.items)));
  const water = new Map<LocalDate, number>();
  for (const w of data.water) {
    const d = toLondonDate(w.loggedAt);
    water.set(d, (water.get(d) ?? 0) + w.ml);
  }
  return { eaten, water };
}

/** 4A Week and 5 Month: period averages against targets, the weight trend and adherence. */
export function HealthPeriodView({ kind, today }: { kind: PeriodKind; today: LocalDate }) {
  const session = useSession();
  const apple = useAppleHealth();
  const [anchor, setAnchor] = useState<LocalDate>(today);
  const period = periodOf(kind, anchor);
  const isCurrent = period.start <= today && today <= period.end;
  const loaded = useHealthPeriod(period);
  const live = loaded.live;

  const data: HealthPeriodData = useMemo(() => {
    if (live) return loaded.data;
    const days = elapsedDays(period, today);
    return {
      meals: days.flatMap((d) => sampleMealLogs(d)),
      water: days.flatMap((d) => sampleWaterLogs(d)),
      supplements: sampleSupplements,
      taken: sampleSupplementLogs(days),
      training: sampleTraining(today).filter((t) => days.includes(t.trainedOn)),
      values: sampleHealthValues(today).filter((v) => days.includes(v.day)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, loaded.data, period.start, today]);

  const daily = session.settings?.targets;
  const health = live ? (session.settings?.health ?? DEFAULT_HEALTH_TARGETS) : sampleHealthTargets;
  const targets = live
    ? {
        kcal: daily?.kcal ?? null,
        protein: daily?.protein ?? null,
        carbs: daily?.carbs ?? null,
        fat: daily?.fat ?? null,
        waterMl: daily?.waterMl ?? null,
        steps: daily?.steps ?? null,
      }
    : sampleTargets;
  const days = elapsedDays(period, today);
  const access: AppleHealthAccess = live ? apple.access : 'connected';
  const light = kind === 'month';

  return (
    <View testID={`health-${kind}`}>
      <View style={styles.periodBar}>
        <Pressable
          onPress={() => setAnchor(shiftPeriod(kind, anchor, -1).start)}
          accessibilityRole="button"
          accessibilityLabel={`Previous ${kind}`}
          style={styles.periodButton}
        >
          <Text style={styles.periodButtonText}>‹ Previous</Text>
        </Pressable>
        <Text style={styles.periodLabel} accessibilityRole="header" testID="period-label">
          {formatPeriod(period)}
        </Text>
        <Pressable
          onPress={() => setAnchor(shiftPeriod(kind, anchor, 1).start)}
          disabled={isCurrent}
          accessibilityRole="button"
          accessibilityLabel={`Next ${kind}`}
          accessibilityState={{ disabled: isCurrent }}
          style={[styles.periodButton, isCurrent && styles.disabled]}
        >
          <Text style={styles.periodButtonText}>Next ›</Text>
        </Pressable>
      </View>
      {live && loaded.consentOff ? (
        <ConsentOffCard />
      ) : days.length === 0 ? (
        <Muted>This {kind} hasn’t started yet.</Muted>
      ) : (
        <>
          {loaded.error ? <FormMessage>{loaded.error}</FormMessage> : null}
          <WeightPeriodCard
            period={period}
            days={days}
            data={data}
            target={health.weightKg}
            access={access}
            light={light}
          />
          <NutritionPeriodCard
            days={days}
            data={data}
            targets={targets}
            planName={health.planName}
            light={light}
          />
          <WaterPeriodCard days={days} data={data} target={targets.waterMl} light={light} />
          <Pair>
            <AveragePeriodCard
              title="Sleep · average"
              kind="sleep_min"
              days={days}
              data={data}
              target={health.sleepMin}
              access={access}
              light={light}
            />
            <AveragePeriodCard
              title="Steps · average"
              kind="steps"
              days={days}
              data={data}
              target={targets.steps}
              access={access}
              light={light}
            />
          </Pair>
          <SupplementsPeriodCard days={days} data={data} light={light} />
          <TrainingPeriodCard
            period={period}
            days={days}
            data={data}
            perWeek={health.trainingPerWeek}
            light={light}
          />
        </>
      )}
    </View>
  );
}

function WeightPeriodCard(props: {
  period: Period;
  days: LocalDate[];
  data: HealthPeriodData;
  target: number | null;
  access: AppleHealthAccess;
  light: boolean;
}) {
  const weights = valuesOf(props.data.values, 'weight_kg').filter((w) =>
    props.days.includes(w.day),
  );
  const avg = averageOfDays(weights.map((w) => w.value));
  const change = weightChange(weights);
  const title = props.light ? `Weight · ${monthName(props.period)}` : 'Weight · this week';
  const trailing = props.target != null ? `Target ${formatKg1(props.target)}` : undefined;
  if (avg == null) {
    return (
      <Card title={title} trailing={trailing}>
        <View style={styles.body} testID="period-weight-empty">
          <Body>{props.access === 'off' ? COPY.weightOff : COPY.weightNoData}</Body>
        </View>
      </Card>
    );
  }
  const byDay = new Map(weights.map((w) => [w.day, w.value]));
  const line = props.period.days.map((d) => byDay.get(d) ?? null);
  const label = `Weight: average ${formatKg1(avg)}${change != null ? `, ${formatKgChange(change)} ${props.light ? 'this month' : 'Monday to Sunday'}` : ''}`;
  if (props.light) {
    return (
      <Card title={title} trailing={trailing}>
        <View style={[styles.body, healthStyles.row]} testID="period-weight">
          <View accessible accessibilityLabel={label}>
            <Big size={28}>{change != null ? formatKgChange(change) : formatKg1(avg)}</Big>
            <Muted>{`Average ${formatKg1(avg)}`}</Muted>
          </View>
          <Sparkline values={line} accessibilityLabel="Weight trend this month" />
        </View>
      </Card>
    );
  }
  return (
    <Card title={title} trailing={trailing}>
      <View style={styles.body} testID="period-weight">
        <View style={healthStyles.row} accessible accessibilityLabel={label}>
          <View>
            <Big size={28}>{formatKg1(avg)}</Big>
            <Muted>Average</Muted>
          </View>
          {change != null ? (
            <View style={healthStyles.right}>
              <Text style={styles.side}>{formatKgChange(change)}</Text>
              <Muted>Mon to Sun</Muted>
            </View>
          ) : null}
        </View>
        <WeightLine
          values={line}
          target={props.target}
          height={96}
          accessibilityLabel={`Weight Monday to Sunday${props.target != null ? `, target ${formatKg1(props.target)}` : ''}`}
        />
        <View style={styles.weekLabels} importantForAccessibility="no-hide-descendants">
          {props.period.days.map((d) => (
            <Text key={d} style={styles.weekLabel}>
              {weekdayShort(d)}
            </Text>
          ))}
        </View>
      </View>
    </Card>
  );
}

function NutritionPeriodCard(props: {
  days: LocalDate[];
  data: HealthPeriodData;
  targets: {
    kcal: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  };
  planName: string | null;
  light: boolean;
}) {
  const { eaten } = dailyTotals(props.data);
  const logged = props.days.map((d) => eaten.get(d) ?? null);
  const avg = (k: keyof Macros) => averageOfDays(logged.map((m) => (m ? m[k] : null)));
  const kcal = avg('kcal');
  const t = props.targets;
  const within = adherence(props.days, (d) => kcalWithinTarget(eaten.get(d)?.kcal, t.kcal));
  const macro = (label: string, k: 'protein' | 'carbs' | 'fat') => {
    const a = avg(k);
    const v = a == null ? '—' : String(Math.round(a));
    return t[k] ? `${v} / ${formatCount(t[k]!)} g` : `${v} g`;
  };
  const title = 'Nutrition · daily average';
  const trailing = props.planName ?? undefined;
  if (kcal == null) {
    return (
      <Card title={title} trailing={trailing}>
        <View style={styles.body} testID="period-nutrition-empty">
          <Muted>No meals logged in this period.</Muted>
        </View>
      </Card>
    );
  }
  const kcalText = t.kcal
    ? `${formatKcal(kcal)} of ${formatKcal(t.kcal)} kcal`
    : `${formatKcal(kcal)} kcal`;
  if (props.light) {
    return (
      <Card title={title} trailing={trailing}>
        <View style={styles.body} testID="period-nutrition">
          <View style={healthStyles.row}>
            <Text style={styles.side}>{kcalText}</Text>
            {t.kcal ? <Muted>{formatAdherence(within)}</Muted> : null}
          </View>
          <Muted>
            {`Protein ${macro('Protein', 'protein')} · Carbs ${macro('Carbs', 'carbs')} · Fat ${macro('Fat', 'fat')}`}
          </Muted>
        </View>
      </Card>
    );
  }
  return (
    <Card title={title} trailing={trailing}>
      <View style={styles.body} testID="period-nutrition">
        <View style={healthStyles.row}>
          <View accessible accessibilityLabel={`Calories: daily average ${kcalText}`}>
            <Big size={28}>{formatKcal(kcal)}</Big>
            <Muted>{t.kcal ? `of ${formatKcal(t.kcal)} kcal` : 'kcal'}</Muted>
          </View>
          {t.kcal ? (
            <View
              style={healthStyles.right}
              accessible
              accessibilityLabel={`${formatAdherence(within)} within target`}
            >
              <Text style={styles.side}>{formatAdherence(within)}</Text>
              <Muted>within target</Muted>
            </View>
          ) : null}
        </View>
        <Bar
          thick
          fraction={t.kcal ? kcal / t.kcal : 0}
          accessibilityLabel="Calories against target"
        />
        {(['protein', 'carbs', 'fat'] as const).map((k) => {
          const label = k === 'protein' ? 'Protein' : k === 'carbs' ? 'Carbs' : 'Fat';
          const a = avg(k);
          return (
            <Bar
              key={k}
              label={label}
              value={macro(label, k)}
              fraction={t[k] && a != null ? a / t[k]! : 0}
              accessibilityLabel={`${label}: ${macro(label, k)}`}
            />
          );
        })}
      </View>
    </Card>
  );
}

function WaterPeriodCard(props: {
  days: LocalDate[];
  data: HealthPeriodData;
  target: number | null;
  light: boolean;
}) {
  const { water } = dailyTotals(props.data);
  const avg = averageOfDays(props.days.map((d) => water.get(d) ?? null));
  const hit = adherence(props.days, (d) => hitTarget(water.get(d), props.target));
  const title = 'Water · daily average';
  if (avg == null) {
    return (
      <Card title={title}>
        <View style={styles.body}>
          <Muted>No water logged in this period.</Muted>
        </View>
      </Card>
    );
  }
  const target = props.target ? formatMl(props.target) : null;
  if (props.light) {
    return (
      <Card title={title}>
        <View style={[styles.body, healthStyles.row]} testID="period-water">
          <Text style={styles.side}>
            {target ? `${formatMl(avg)} of ${target}` : formatMl(avg)}
          </Text>
          {target ? <Muted>{formatAdherence(hit)}</Muted> : null}
        </View>
      </Card>
    );
  }
  return (
    <Card title={title}>
      <View style={styles.body} testID="period-water">
        <View style={healthStyles.row}>
          <View
            accessible
            accessibilityLabel={`Water: daily average ${formatMl(avg)}${target ? ` of ${target}` : ''}`}
          >
            <Big size={24}>{formatMl(avg)}</Big>
            {target ? <Muted>{`of ${target}`}</Muted> : null}
          </View>
          {target ? (
            <View style={healthStyles.right}>
              <Text style={styles.side}>{formatAdherence(hit)}</Text>
              <Muted>hit target</Muted>
            </View>
          ) : null}
        </View>
        <Bar
          thick
          fraction={props.target ? avg / props.target : 0}
          accessibilityLabel="Water against target"
        />
      </View>
    </Card>
  );
}

function AveragePeriodCard(props: {
  title: string;
  kind: 'sleep_min' | 'steps';
  days: LocalDate[];
  data: HealthPeriodData;
  target: number | null;
  access: AppleHealthAccess;
  light: boolean;
}) {
  const values = valuesOf(props.data.values, props.kind).filter((v) => props.days.includes(v.day));
  const avg = averageOfDays(values.map((v) => v.value));
  const byDay = new Map(values.map((v) => [v.day, v.value]));
  const sleep = props.kind === 'sleep_min';
  const fmt = (n: number) => (sleep ? formatSleep(n) : formatSteps(n));
  const met = adherence(props.days, (d) => hitTarget(byDay.get(d), props.target));
  return (
    <Card title={props.title} style={healthStyles.half}>
      <View style={styles.small} testID={`period-${props.kind}`}>
        {avg == null ? (
          <Muted>
            {props.access === 'off'
              ? sleep
                ? COPY.sleepOff
                : COPY.stepsOff
              : props.access === 'elsewhere'
                ? COPY.elsewhere
                : sleep
                  ? COPY.sleepNoData
                  : COPY.stepsNoData}
          </Muted>
        ) : (
          <>
            <Big size={props.light ? 22 : 24}>{fmt(avg)}</Big>
            <Muted>
              {props.target
                ? `${sleep ? `Target ${formatSleep(props.target)}` : `of ${formatSteps(props.target)}`}\n${formatAdherence(met, sleep ? 'nights' : 'days')}`
                : ''}
            </Muted>
          </>
        )}
      </View>
    </Card>
  );
}

function SupplementsPeriodCard(props: {
  days: LocalDate[];
  data: HealthPeriodData;
  light: boolean;
}) {
  const list = props.data.supplements;
  const taken = new Set(props.data.taken.map((t) => `${t.supplementId}|${t.takenOn}`));
  const has = (id: string, d: LocalDate) => taken.has(`${id}|${d}`);
  const all = adherence(props.days, (d) => list.length > 0 && list.every((s) => has(s.id, d)));
  if (list.length === 0) {
    return (
      <Card title="Supplements">
        <View style={styles.body}>
          <Muted>No supplements yet. Add them in Me → Health targets → Supplements.</Muted>
        </View>
      </Card>
    );
  }
  if (props.light) {
    return (
      <Card title="Supplements">
        <View style={[styles.body, healthStyles.row]} testID="period-supplements">
          <Text style={styles.side}>All taken</Text>
          <Muted>{formatAdherence(all)}</Muted>
        </View>
      </Card>
    );
  }
  return (
    <Card title="Supplements" trailing={`All taken ${formatAdherence(all)}`}>
      <View style={styles.body} testID="period-supplements">
        {list.map((s) => {
          const a = adherence(props.days, (d) => has(s.id, d));
          return (
            <View
              key={s.id}
              style={styles.suppRow}
              accessible
              accessibilityLabel={`${supplementLabel(s)}: ${a.count} of ${a.of} days`}
            >
              <Text style={styles.suppName}>{supplementLabel(s)}</Text>
              <View style={healthStyles.row}>
                <View style={styles.pips}>
                  {props.days.map((d) => (
                    <View key={d} style={[styles.pip, has(s.id, d) && styles.pipOn]} />
                  ))}
                </View>
                <Text style={styles.suppCount}>{`${a.count} of ${a.of}`}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function TrainingPeriodCard(props: {
  period: Period;
  days: LocalDate[];
  data: HealthPeriodData;
  perWeek: number;
  light: boolean;
}) {
  const done = sessionsOn(props.data.training, props.period.days);
  const target = trainingTargetFor(props.period, props.perWeek);
  const sessions = `${done} of ${target} sessions`;
  if (props.light) {
    return (
      <Card title="Training">
        <View style={[styles.body, healthStyles.row]} testID="period-training">
          <Text style={styles.side}>{sessions}</Text>
          <Muted>{`Target ${props.perWeek} a week`}</Muted>
        </View>
      </Card>
    );
  }
  const byDay = new Map(props.data.training.map((t) => [t.trainedOn, t]));
  return (
    <Card title="Training" trailing={sessions}>
      <View style={styles.body} testID="period-training">
        <View style={styles.strip}>
          {props.period.days.map((d) => {
            const row = byDay.get(d);
            return (
              <View
                key={d}
                style={styles.stripDay}
                accessible
                accessibilityLabel={`${weekdayShort(d)}, ${row ? `trained${row.splitName ? `, ${row.splitName}` : ''}` : 'not trained'}`}
              >
                <Text style={styles.weekLabel}>{weekdayShort(d)}</Text>
                <View style={[styles.dayBox, row && styles.dayBoxOn]}>
                  {row ? <Text style={styles.dayTick}>✓</Text> : null}
                </View>
                <Text style={styles.stripName} numberOfLines={1}>
                  {splitShortName(row?.splitName ?? null)}
                </Text>
              </View>
            );
          })}
        </View>
        <Muted>{`Target ${props.perWeek} a week${done >= target && target > 0 ? ' · met' : ''}`}</Muted>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  periodButton: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center' },
  periodButtonText: { ...type.callout, fontWeight: '600', color: colors.text },
  periodLabel: { ...type.callout, fontWeight: '700', color: colors.text },
  disabled: { opacity: 0.35 },
  body: { gap: space.md, paddingBottom: space.sm },
  small: { gap: space.sm, paddingBottom: space.sm },
  side: { fontSize: 17, fontWeight: '700', color: colors.text },
  weekLabels: { flexDirection: 'row' },
  weekLabel: { flex: 1, fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  suppRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 28,
    gap: space.sm,
  },
  suppName: { fontSize: 14, color: colors.text, flexShrink: 1 },
  pips: { flexDirection: 'row', gap: 3, flexWrap: 'wrap', maxWidth: 160 },
  pip: {
    width: 10,
    height: 10,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.textSecondary,
  },
  pipOn: { backgroundColor: colors.fill, borderColor: colors.fill },
  suppCount: { ...type.footnote, color: colors.textSecondary, minWidth: 44, textAlign: 'right' },
  strip: { flexDirection: 'row', gap: 4 },
  stripDay: { flex: 1, alignItems: 'center', gap: 4, minWidth: 0 },
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
  dayTick: { color: colors.inverseText, fontSize: 15, fontWeight: '700' },
  stripName: { fontSize: 11, minHeight: 14, color: colors.text, textAlign: 'center' },
});
