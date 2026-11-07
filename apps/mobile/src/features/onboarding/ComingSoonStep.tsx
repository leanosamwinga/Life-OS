import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  FormMessage,
  FormScreen,
  IconTile,
  Lead,
  PrimaryButton,
  formStyles,
} from '@/components/forms';
import { Pill } from '@/components/ui';
import { space } from '@/theme';
import { goToNext, OnboardingHeader, useOnboardingSteps } from './OnboardingHeader';
import type { OnboardingStep } from './steps';

/**
 * Shared layout for 0d Apple Health and 0e Screen Time. In phase 2 these only record the
 * user's choice; the real iOS permission requests (HealthKit, Family Controls) land in phase 3.
 */
export function ComingSoonStep(props: {
  step: Extract<OnboardingStep, 'apple-health' | 'screen-time'>;
  testID: string;
  title: string;
  body: string;
  children: React.ReactNode;
  /** What iOS will ask, shown with a "Coming soon" note in phase 2. */
  nextNote: string;
  save: (choice: 'yes' | 'no') => Promise<void>;
}) {
  const steps = useOnboardingSteps();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: 'yes' | 'no') {
    setError(null);
    setBusy(true);
    try {
      await props.save(choice);
      goToNext(steps, props.step);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your choice. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen
      testID={props.testID}
      header={<OnboardingHeader step={props.step} steps={steps} onSkip={() => void choose('no')} />}
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton label="Continue" busy={busy} onPress={() => void choose('yes')} />
        </>
      }
    >
      <View style={styles.icon}>
        <IconTile size={80} />
      </View>
      <Lead title={props.title} body={props.body} />
      {props.children}
      <View style={styles.soon}>
        <Pill label="Coming soon" />
        <Text style={formStyles.body}>
          {props.nextNote} We’ll remember your choice and ask in a later update.
        </Text>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  icon: { marginTop: space.lg },
  soon: { gap: space.sm, alignItems: 'flex-start' },
});
