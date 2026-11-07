import { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { PRIVACY_POLICY_URL } from '@life-os/core';
import {
  FormMessage,
  FormScreen,
  Lead,
  LinkButton,
  PrimaryButton,
  SecondaryButton,
  formStyles,
} from '@/components/forms';
import { Overline } from '@/components/ui';
import { goToNext, OnboardingHeader } from '@/features/onboarding/OnboardingHeader';
import { onboardingSteps, type AppPlatform } from '@/features/onboarding/steps';
import { useSession } from '@/lib/session';
import { space } from '@/theme';

/** 0c Privacy · health-data consent. "Not now" skips the health steps; the rest of the app works. */
export default function ConsentStep() {
  const session = useSession();
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const platform = Platform.OS as AppPlatform;

  async function choose(granted: boolean) {
    setError(null);
    setBusy(granted ? 'yes' : 'no');
    try {
      if (granted !== session.healthConsent) await session.setHealthConsent(granted);
      goToNext(onboardingSteps(platform, { healthConsent: granted }), 'consent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your choice. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <FormScreen
      testID="screen-onboarding-consent"
      header={<OnboardingHeader step="consent" steps={onboardingSteps(platform)} />}
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton
            label="Yes, use my health data"
            busy={busy === 'yes'}
            disabled={busy !== null}
            onPress={() => void choose(true)}
          />
          <SecondaryButton
            label="Not now"
            disabled={busy !== null}
            onPress={() => void choose(false)}
          />
          <Text style={formStyles.footnote}>
            “Not now” skips the health steps. Money, Week and plans still work.
          </Text>
        </>
      }
    >
      <Lead
        title="Can Life OS use your health data?"
        body="To track meals, water, supplements and Apple Health, we need your explicit permission. It’s off until you say yes."
      />
      <View style={formStyles.outlineCard}>
        <View style={styles.cardHead}>
          <Overline>What this covers</Overline>
        </View>
        <Text style={[formStyles.cardText, styles.item]}>Meals, foods and macro targets</Text>
        <Text style={[formStyles.cardText, styles.item]}>Water and supplements</Text>
        <Text style={[formStyles.cardText, styles.item]}>
          Steps, sleep, weight and workouts you choose to share
        </Text>
      </View>
      <View style={formStyles.greyCard}>
        <Overline>Our promise</Overline>
        <Text style={formStyles.cardText}>
          Stored in the UK/EU. Never sold, never used for ads or AI training. Withdraw any time in
          Me → Privacy; the rest of the app keeps working.
        </Text>
        <LinkButton
          label="Read the Privacy Policy"
          align="left"
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        />
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  cardHead: { paddingTop: space.sm, paddingBottom: space.xs },
  item: { paddingVertical: space.sm },
});
