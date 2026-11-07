import { Text, View } from 'react-native';
import { formStyles } from '@/components/forms';
import { Overline } from '@/components/ui';
import { ComingSoonStep } from '@/features/onboarding/ComingSoonStep';
import { useSession } from '@/lib/session';

/**
 * 0e Show your Screen Time (iPhone only). Apple draws the card on-device; Life OS can never
 * read, store or sync Screen Time data. Only the user's choice is saved. Family Controls in phase 3.
 */
export default function ScreenTimeStep() {
  const session = useSession();
  return (
    <ComingSoonStep
      step="screen-time"
      testID="screen-onboarding-screen-time"
      title="Show your Screen Time"
      body="See today’s screen time and top apps on your Health tab, next to sleep and steps."
      nextNote="Next, iOS will ask you to allow Screen Time access with Face ID or your passcode."
      save={(choice) =>
        session.updateSettings({ screenTimeChoice: choice === 'yes' ? 'show' : 'not_now' })
      }
    >
      <View style={formStyles.greyCard}>
        <Overline>Stays on this iPhone</Overline>
        <Text style={formStyles.cardText}>
          Apple draws this card inside Life OS. We can’t read, save or upload your Screen Time, so
          it never leaves your phone and won’t appear on the web.
        </Text>
      </View>
    </ComingSoonStep>
  );
}
