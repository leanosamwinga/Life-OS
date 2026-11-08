import { Redirect } from 'expo-router';
import { Platform } from 'react-native';
import { resumeStep, stepHref, type AppPlatform } from '@/features/onboarding/steps';
import { useSession } from '@/lib/session';

/**
 * Onboarding starts at health-data consent (0c); a relaunch part-way through picks up after the
 * last answer that was saved (resumeStep). Once 0g is saved the root guard never comes here.
 */
export default function OnboardingIndex() {
  const session = useSession();
  const step = resumeStep(Platform.OS as AppPlatform, {
    healthConsent: session.healthConsent,
    settings: session.settings,
  });
  return <Redirect href={step ? stepHref(step) : '/'} />;
}
