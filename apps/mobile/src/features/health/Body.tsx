import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  addDays,
  averageOfDays,
  formatKg1,
  formatKgChange,
  formatSleep,
  formatSleepWindow,
  formatSteps,
  weeklyWeightChange,
  type LocalDate,
} from '@life-os/core';
import { Card } from '@/components/ui';
import { FormMessage } from '@/components/forms';
import type { HealthDailyValue } from '@/lib/backend/health';
import { colors, space } from '@/theme';
import { useAppleHealth, type AppleHealthAccess } from './AppleHealth';
import { WeightLine } from './charts';
import { Big, Body, Button, DashedRing, Muted, TextLink, healthStyles } from './parts';
import { valuesOf } from './useHealthData';

/** Copy (wireframes 3b, 3c, 8a, 8b). */
export const COPY = {
  weightNoData: 'No weight yet. Add a weight in the Apple Health app and it will appear here.',
  weightOff:
    'Life OS can’t read your weight. Allow Weight for Life OS in Settings › Health › Data access.',
  sleepOff: 'Life OS can’t read sleep.',
  stepsOff: 'Life OS can’t read steps.',
  sleepNoData: 'No sleep from Apple Health yet.',
  stepsNoData: 'No steps from Apple Health yet.',
  elsewhere: 'Connect Apple Health on your iPhone to see this.',
  bannerTitle: 'Apple Health access is off',
  bannerBody:
    'Life OS can’t read weight, sleep or steps. Meals, water, supplements and training still work.',
  openSettings: 'Open Settings ↗',
};

/** The Open Settings link and any error from it. */
function useOpenSettings() {
  const apple = useAppleHealth();
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    setError(null);
    apple.openSettings().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Couldn’t open Settings.');
    });
  };
  return { open, error };
}

function SettingsLink() {
  const { open, error } = useOpenSettings();
  return (
    <>
      <TextLink label={COPY.openSettings} onPress={open} accessibilityLabel="Open Settings" />
      {error ? <FormMessage>{error}</FormMessage> : null}
    </>
  );
}

/** 8b: one dismissible banner at the top of Health when we know access isn't granted. */
export function NoAccessBanner() {
  const apple = useAppleHealth();
  const { open, error } = useOpenSettings();
  if (apple.access !== 'off' || apple.bannerDismissed) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert" testID="health-no-access-banner">
      <Big size={16}>{COPY.bannerTitle}</Big>
      <Body>{COPY.bannerBody}</Body>
      <View style={styles.bannerButtons}>
        <Button label={COPY.openSettings} accessibilityLabel="Open Settings" onPress={open} />
        <Button
          label="Dismiss"
          variant="outline"
          accessibilityLabel="Dismiss Apple Health access message"
          onPress={apple.dismissBanner}
        />
      </View>
      {error ? <FormMessage>{error}</FormMessage> : null}
    </View>
  );
}

/** What a card without data says, by where we are and what we know. */
type Empty = { kind: 'off' } | { kind: 'no_data' } | { kind: 'elsewhere' };
const emptyFor = (access: AppleHealthAccess): Empty =>
  access === 'off'
    ? { kind: 'off' }
    : access === 'elsewhere'
      ? { kind: 'elsewhere' }
      : { kind: 'no_data' };

/** 1B / 3a–3c Weight: current kg, change this week, 14-day line against a dashed target. */
export function WeightCard(props: {
  today: LocalDate;
  values: readonly HealthDailyValue[];
  target: number | null;
  access: AppleHealthAccess;
}) {
  const weights = valuesOf(props.values, 'weight_kg').filter((w) => w.day <= props.today);
  const latest = weights[weights.length - 1];
  const trailing = props.target != null ? `Target ${formatKg1(props.target)}` : undefined;
  if (!latest) {
    const empty = emptyFor(props.access);
    return (
      <Card title="Weight" trailing={trailing}>
        <View style={styles.body} testID={empty.kind === 'off' ? 'weight-off' : 'weight-no-data'}>
          {empty.kind === 'off' ? (
            <>
              <Body>{COPY.weightOff}</Body>
              <SettingsLink />
            </>
          ) : (
            <>
              <Body>{COPY.weightNoData}</Body>
              <View style={styles.dashedLine} importantForAccessibility="no" />
            </>
          )}
        </View>
      </Card>
    );
  }
  const change = weeklyWeightChange(weights, props.today);
  const slots = Array.from({ length: 14 }, (_, i) => addDays(props.today, i - 13));
  const byDay = new Map(weights.map((w) => [w.day, w.value]));
  const line = slots.map((d) => byDay.get(d) ?? null);
  return (
    <Card title="Weight" trailing={trailing}>
      <View style={styles.body} testID="weight-card">
        <View
          style={healthStyles.baseline}
          accessible
          accessibilityLabel={`Weight ${formatKg1(latest.value)}${change != null ? `, ${formatKgChange(change)} this week` : ''}`}
        >
          <Big>{formatKg1(latest.value)}</Big>
          {change != null ? <Muted>{`${formatKgChange(change)} this week`}</Muted> : null}
        </View>
        <WeightLine
          values={line}
          target={props.target}
          accessibilityLabel={`Weight over the last 14 days${props.target != null ? `, target ${formatKg1(props.target)}` : ''}`}
          testID="weight-line"
        />
      </View>
    </Card>
  );
}

/** 1B Sleep: last night's duration, "23:48–07:00", 7-day average. */
export function SleepCard(props: {
  today: LocalDate;
  values: readonly HealthDailyValue[];
  access: AppleHealthAccess;
}) {
  const nights = valuesOf(props.values, 'sleep_min');
  const tonight = nights.find((n) => n.day === props.today);
  const week = nights.filter((n) => n.day > addDays(props.today, -7) && n.day <= props.today);
  const avg = averageOfDays(week.map((n) => n.value));
  return (
    <Card title="Sleep" style={healthStyles.half}>
      <View style={styles.small} testID="sleep-card">
        {tonight ? (
          <View
            accessible
            accessibilityLabel={`Sleep ${formatSleep(tonight.value)}${tonight.start && tonight.end ? `, ${formatSleepWindow(tonight.start, tonight.end)}` : ''}${avg != null ? `, 7-day average ${formatSleep(avg)}` : ''}`}
            style={healthStyles.gap}
          >
            <Big size={24}>{formatSleep(tonight.value)}</Big>
            <Muted>
              {tonight.start && tonight.end ? formatSleepWindow(tonight.start, tonight.end) : ''}
              {avg != null ? `\n7-day avg ${formatSleep(avg)}` : ''}
            </Muted>
          </View>
        ) : (
          <EmptySmall access={props.access} off={COPY.sleepOff} noData={COPY.sleepNoData} />
        )}
      </View>
    </Card>
  );
}

/** 1B Steps: "6,240" of the target, from Apple Health. */
export function StepsCard(props: {
  today: LocalDate;
  values: readonly HealthDailyValue[];
  target: number | null;
  access: AppleHealthAccess;
}) {
  const steps = valuesOf(props.values, 'steps').find((s) => s.day === props.today);
  return (
    <Card title="Steps" style={healthStyles.half}>
      <View style={styles.small} testID="steps-card">
        {steps ? (
          <View
            accessible
            accessibilityLabel={`Steps ${formatSteps(steps.value)}${props.target ? ` of ${formatSteps(props.target)}` : ''}`}
            style={healthStyles.gap}
          >
            <Big size={24}>{formatSteps(steps.value)}</Big>
            <Muted>
              {props.target ? `of ${formatSteps(props.target)}\n` : ''}from Apple Health
            </Muted>
          </View>
        ) : (
          <EmptySmall access={props.access} off={COPY.stepsOff} noData={COPY.stepsNoData} />
        )}
      </View>
    </Card>
  );
}

function EmptySmall(props: { access: AppleHealthAccess; off: string; noData: string }) {
  const empty = emptyFor(props.access);
  if (empty.kind === 'off') {
    return (
      <View testID="small-off" style={healthStyles.gap}>
        <Body>{props.off}</Body>
        <SettingsLink />
      </View>
    );
  }
  return (
    <View testID="small-no-data" style={healthStyles.gap}>
      <DashedRing />
      <Muted>{empty.kind === 'elsewhere' ? COPY.elsewhere : props.noData}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.sm },
  small: { gap: space.sm, paddingBottom: space.sm },
  dashedLine: {
    height: 40,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    marginTop: space.md,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.text,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: space.lg,
    gap: 10,
    marginBottom: space.lg,
  },
  bannerButtons: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
});
