import { nextStep, onboardingSteps, stepNumber } from './steps';

describe('onboarding steps', () => {
  it('shows all five steps on iPhone', () => {
    expect(onboardingSteps('ios')).toEqual([
      'consent',
      'apple-health',
      'screen-time',
      'nudges',
      'finish',
    ]);
  });

  it('hides Apple Health and Screen Time on web and Android', () => {
    expect(onboardingSteps('web')).toEqual(['consent', 'nudges', 'finish']);
    expect(onboardingSteps('android')).toEqual(['consent', 'nudges', 'finish']);
  });

  it('"Not now" on health consent skips the Apple Health step', () => {
    const steps = onboardingSteps('ios', { healthConsent: false });
    expect(steps).toEqual(['consent', 'screen-time', 'nudges', 'finish']);
    expect(nextStep(steps, 'consent')).toBe('screen-time');
    expect(onboardingSteps('android', { healthConsent: false })).toEqual([
      'consent',
      'nudges',
      'finish',
    ]);
  });

  it('numbers steps and ends after finish', () => {
    const steps = onboardingSteps('ios', { healthConsent: true });
    expect(stepNumber(steps, 'nudges')).toBe(4);
    expect(nextStep(steps, 'finish')).toBeNull();
  });
});
