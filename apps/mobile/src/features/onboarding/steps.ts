/**
 * First-run onboarding (wireframes 0c–0g).
 *
 * - Apple Health (0d) and Screen Time (0e) only exist on iPhone; web and Android skip them.
 * - "Not now" on health-data consent (0c) skips the health step (Apple Health). Screen Time is
 *   not health data and is never collected, so it stays.
 */
export type OnboardingStep = 'consent' | 'apple-health' | 'screen-time' | 'nudges' | 'finish';

export type AppPlatform = 'ios' | 'android' | 'web' | 'windows' | 'macos' | 'native';

export function onboardingSteps(
  platform: AppPlatform,
  opts: { healthConsent: boolean | null } = { healthConsent: null },
): OnboardingStep[] {
  const iphone = platform === 'ios';
  const steps: OnboardingStep[] = ['consent'];
  if (iphone && opts.healthConsent !== false) steps.push('apple-health');
  if (iphone) steps.push('screen-time');
  steps.push('nudges', 'finish');
  return steps;
}

/** The step after `current`, or `null` at the end. */
export function nextStep(
  steps: readonly OnboardingStep[],
  current: OnboardingStep,
): OnboardingStep | null {
  const i = steps.indexOf(current);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1]! : null;
}

/** 1-based position for "2 of 5"; steps not in the list (e.g. skipped) report the nearest. */
export function stepNumber(steps: readonly OnboardingStep[], current: OnboardingStep): number {
  const i = steps.indexOf(current);
  return i === -1 ? 1 : i + 1;
}

export const stepHref = (step: OnboardingStep) => `/onboarding/${step}` as const;
