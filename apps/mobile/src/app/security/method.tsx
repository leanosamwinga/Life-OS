import { router, useLocalSearchParams } from 'expo-router';
import { AuthScreen, InfoCard, Lead } from '@/components/auth';
import { SecondaryButton } from '@/components/forms';
import { providerName } from '@/lib/auth/copy';

/** S-3b (Apple) / S-3c (Google) · No password: you manage it with them. */
export default function NoPasswordScreen() {
  const { method } = useLocalSearchParams<{ method: 'APPLE' | 'GOOGLE' }>();
  const name = providerName(method);
  return (
    <AuthScreen
      testID={method === 'APPLE' ? 'screen-S-3b' : 'screen-S-3c'}
      back={{ onPress: () => router.back() }}
      title="No password to change"
      lead={
        <Lead
          before="You sign in to Life OS with "
          bold={name}
          after=", so there's no Life OS password."
        />
      }
      footer={<SecondaryButton label="Back to Security" onPress={() => router.back()} />}
    >
      <InfoCard>
        {method === 'APPLE'
          ? 'To change your Apple Account password or stop using Sign in with Apple, go to Settings → your name → Sign-In & Security on your iPhone.'
          : 'To change your Google password or remove access, go to your Google Account → Security.'}
      </InfoCard>
    </AuthScreen>
  );
}
