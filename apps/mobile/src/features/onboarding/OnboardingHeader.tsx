import { Platform, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { LinkButton, StepProgress } from '@/components/forms';
import { useSession } from '@/lib/session';
import { colors, type } from '@/theme';
import {
  nextStep,
  onboardingSteps,
  stepHref,
  stepNumber,
  type AppPlatform,
  type OnboardingStep,
} from './steps';

/** The steps for this device, given what the user chose on the consent step. */
export function useOnboardingSteps(): OnboardingStep[] {
  const { healthConsent } = useSession();
  return onboardingSteps(Platform.OS as AppPlatform, { healthConsent });
}

export function goToNext(steps: readonly OnboardingStep[], current: OnboardingStep) {
  const next = nextStep(steps, current);
  if (next) router.push(stepHref(next));
}

/** Progress segments plus either "Skip" or "n of N" (wireframes 0c–0g). */
export function OnboardingHeader(props: {
  step: OnboardingStep;
  steps: readonly OnboardingStep[];
  onSkip?: () => void;
}) {
  const n = stepNumber(props.steps, props.step);
  const total = props.steps.length;
  return (
    <>
      <StepProgress step={n} total={total} />
      {props.onSkip ? (
        <LinkButton label="Skip" plain onPress={props.onSkip} accessibilityLabel="Skip this step" />
      ) : (
        <Text style={styles.count}>
          {n} of {total}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  count: { ...type.callout, color: colors.textSecondary },
});
