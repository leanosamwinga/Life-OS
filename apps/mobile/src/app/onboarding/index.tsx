import { Redirect } from 'expo-router';

/** Onboarding always starts at health-data consent (0c). */
export default function OnboardingIndex() {
  return <Redirect href="/onboarding/consent" />;
}
