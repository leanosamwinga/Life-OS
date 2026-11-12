import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { dayProgress, formatDateUK, makeRotation, type LocalDate } from '@life-os/core';
import { Card } from '@/components/ui';
import { FormMessage, SecondaryButton } from '@/components/forms';
import { useDay } from '@/features/data/useDay';
import { useSession } from '@/lib/session';
import { DEFAULT_HEALTH_TARGETS } from '@/lib/backend/settings';
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
import { colors, space, type } from '@/theme';
import { useAppleHealth } from './AppleHealth';
import { NoAccessBanner, SleepCard, StepsCard, WeightCard } from './Body';
import { NutritionCard, WaterCard } from './Intake';
import { Pair, Section } from './parts';
import { SupplementsCard, TrainingCard } from './Routine';
import { useHealthDay } from './useHealthData';

/** "Health data is off": nothing health-related is loaded or shown (UK GDPR Art. 9(2)(a)). */
export function ConsentOffCard() {
  return (
    <Card title="Health data">
      <View style={styles.consentOff} testID="health-consent-off">
        <Text style={styles.headline}>Health data is off</Text>
        <Text style={styles.caption}>
          Turn on “Use my health data” in Me to see weight, sleep and steps and to log meals, water,
          supplements and training. Money, Week and plans keep working.
        </Text>
        <SecondaryButton label="Open Me → Privacy" onPress={() => router.push('/me')} />
      </View>
    </Card>
  );
}

/** 1B Health · Day: Body (Weight, Sleep | Steps), Intake (Nutrition, Water, Supplements), Training. */
export function HealthDayView({ today }: { today: LocalDate }) {
  const session = useSession();
  const apple = useAppleHealth();
  const day = useDay(today);
  const health = useHealthDay(today);
  const live = day.live;
  const targets = live ? (session.settings?.health ?? DEFAULT_HEALTH_TARGETS) : sampleHealthTargets;
  const sample = useMemo(
    () =>
      live
        ? null
        : {
            values: sampleHealthValues(today),
            training: sampleTraining(today),
            taken: sampleSupplementLogs([today]),
          },
    [live, today],
  );
  const progress = live
    ? day.progress
    : dayProgress(
        { meals: sampleMealLogs(today), water: sampleWaterLogs(today) },
        sampleTargets,
        today,
      );
  const stepsTarget = live ? (session.settings?.targets.steps ?? null) : sampleTargets.steps;
  const values = sample?.values ?? health.data.values;
  const rotation = makeRotation(targets.split, targets.trainingPerWeek);
  const backend = session.backend;

  return (
    <View testID="health-day">
      <View style={styles.dateRow}>
        <Text style={styles.date}>{formatDateUK(today)}</Text>
        <Text style={styles.caption}>Today</Text>
      </View>
      {live && day.consentOff ? (
        <ConsentOffCard />
      ) : (
        <>
          {live ? <NoAccessBanner /> : null}
          {day.error || health.error ? (
            <FormMessage>{(day.error ?? health.error)!}</FormMessage>
          ) : null}
          <Section title="Body" />
          <View style={styles.gapTop} />
          <WeightCard
            today={today}
            values={values}
            target={targets.weightKg}
            access={live ? apple.access : 'connected'}
          />
          <Pair>
            <SleepCard today={today} values={values} access={live ? apple.access : 'connected'} />
            <StepsCard
              today={today}
              values={values}
              target={stepsTarget}
              access={live ? apple.access : 'connected'}
            />
          </Pair>

          <Section title="Intake" />
          <View style={styles.gapTop} />
          <NutritionCard
            progress={progress}
            roster={live ? day.data.roster : null}
            planName={targets.planName}
          />
          <WaterCard progress={progress} water={day.data.water} live={live} />
          <SupplementsCard
            supplements={live ? health.data.supplements : sampleSupplements}
            taken={sample?.taken ?? health.data.taken}
            today={today}
            onToggle={
              live && backend
                ? async (s, taken) => {
                    await backend.setSupplementTaken(s.id, taken);
                    session.notifyDataChanged();
                  }
                : null
            }
          />

          <Section title="Training" />
          <View style={styles.gapTop} />
          <TrainingCard
            today={today}
            rotation={rotation}
            history={sample?.training ?? health.data.training}
            actions={
              live && backend
                ? {
                    mark: async (date, split) => {
                      await backend.markTrained(date, split);
                      session.notifyDataChanged();
                    },
                    unmark: async (date) => {
                      await backend.unmarkTrained(date);
                      session.notifyDataChanged();
                    },
                  }
                : null
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 24,
    marginBottom: space.sm,
  },
  date: { ...type.callout, fontWeight: '600', color: colors.text },
  caption: { ...type.footnote, color: colors.textSecondary },
  headline: { ...type.headline, color: colors.text },
  consentOff: { gap: space.sm, paddingVertical: space.sm },
  gapTop: { height: space.md },
});
