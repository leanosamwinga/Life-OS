import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  FormMessage,
  FormScreen,
  Lead,
  PrimaryButton,
  SecondaryButton,
  TextField,
  formStyles,
} from '@/components/forms';
import { Overline } from '@/components/ui';
import { OnboardingHeader, useOnboardingSteps } from '@/features/onboarding/OnboardingHeader';
import { countNudgesOn } from '@/lib/backend/settings';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/theme';

const onOff = (on: boolean) => (on ? 'on' : 'off');

/** 0g Nearly there — first name, targets, a summary of choices, then Today. */
export default function FinishStep() {
  const session = useSession();
  const steps = useOnboardingSteps();
  const [name, setName] = useState(session.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = session.settings;
  const iphone = Platform.OS === 'ios';
  const targetsSet = s ? Object.values(s.targets).some((v) => v != null) : false;

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      if ((name.trim() || null) !== session.displayName) await session.setDisplayName(name);
      // Once this is set the root guards switch from onboarding to the app.
      await session.updateSettings({ onboardingCompletedAt: new Date().toISOString() });
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t finish setting up. Try again.');
      setBusy(false);
    }
  }

  const chose = [
    `Health data: ${onOff(session.healthConsent)}`,
    ...(iphone ? [`Apple Health: ${onOff(s?.appleHealthChoice === 'connect')}`] : []),
  ].join(' · ');
  const chose2 = [
    ...(iphone ? [`Screen Time: ${onOff(s?.screenTimeChoice === 'show')}`] : []),
    `Nudges: ${s ? countNudgesOn(s.nudges) : 0} on`,
  ].join(' · ');

  return (
    <FormScreen
      testID="screen-onboarding-finish"
      header={<OnboardingHeader step="finish" steps={steps} />}
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton label="Go to Today" busy={busy} onPress={() => void finish()} />
        </>
      }
    >
      <Lead
        title="Nearly there"
        body="What should we call you? Filled in from Apple or Google if you used them."
      />
      <TextField
        label="First name"
        value={name}
        onChangeText={setName}
        placeholder="Your first name"
        autoComplete="given-name"
        textContentType="givenName"
      />
      <View style={formStyles.outlineCard}>
        <View style={styles.pad}>
          <Overline>Daily targets</Overline>
          <Text style={formStyles.cardText}>
            {targetsSet
              ? 'Saved. You can change them any time in Me → Meal plan & macro targets.'
              : 'Calories, protein, carbs, fat, water and steps. Set them now or later in Me → Meal plan & macro targets.'}
          </Text>
          <SecondaryButton
            label={targetsSet ? 'Edit targets' : 'Set targets now'}
            onPress={() => router.push('/targets')}
          />
        </View>
      </View>
      <View
        style={formStyles.greyCard}
        accessible
        accessibilityLabel={`You chose: ${chose}. ${chose2}.`}
      >
        <Overline>You chose</Overline>
        <Text style={styles.chose}>{chose}</Text>
        <Text style={styles.chose}>{chose2}</Text>
        <Text style={styles.small}>Change any of these in Me.</Text>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingVertical: space.sm, gap: space.sm },
  chose: { ...type.callout, color: colors.text },
  small: { ...type.footnote, color: colors.textSecondary },
});
