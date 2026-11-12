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
import { Card, Row } from '@/components/ui';
import { useAppleHealth } from '@/features/health/AppleHealth';
import {
  goToNext,
  OnboardingHeader,
  useOnboardingSteps,
} from '@/features/onboarding/OnboardingHeader';
import { useSession } from '@/lib/session';
import { space } from '@/theme';

/**
 * 0d Connect Apple Health (iPhone only, and only after "Yes" on 0c). Continue shows iOS's own
 * read-only Health permission sheet (steps, sleep, weight); Skip records "Not now". The choice
 * is kept in user_settings.apple_health_choice. Without the native module (Expo Go) the choice
 * is recorded and the sheet appears later from Me → Apple Health in a development build.
 */
export default function AppleHealthStep() {
  const session = useSession();
  const apple = useAppleHealth();
  const steps = useOnboardingSteps();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(connect: boolean) {
    setError(null);
    setBusy(true);
    try {
      if (connect && session.healthConsent && apple.access !== 'elsewhere') await apple.connect();
      else await session.updateSettings({ appleHealthChoice: connect ? 'connect' : 'not_now' });
      goToNext(steps, 'apple-health');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your choice. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen
      testID="screen-onboarding-apple-health"
      header={
        <OnboardingHeader step="apple-health" steps={steps} onSkip={() => void choose(false)} />
      }
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton label="Continue" busy={busy} onPress={() => void choose(true)} />
        </>
      }
    >
      <View style={styles.icon}>
        <IconTile size={80} />
      </View>
      <Lead
        title="Connect Apple Health"
        body="Life OS reads these to fill your rings and Health tab. It never writes to Apple Health."
      />
      <Card>
        <Row label="Steps" detail="Today ring" />
        <Row label="Sleep" detail="Today ring, briefing" />
        <Row label="Weight" detail="Health trend" last />
      </Card>
      <Text style={formStyles.body} testID="apple-health-next">
        Next, iOS will show its own Health permissions sheet, where you can switch each item on or
        off. You can change this any time in Settings › Health › Data access.
      </Text>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  icon: { marginTop: space.lg },
});
