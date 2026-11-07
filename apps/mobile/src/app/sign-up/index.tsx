import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { AuthScreen, InfoCard, authStyles } from '@/components/auth';
import { LinkButton, SecondaryButton } from '@/components/forms';
import { useProviderFlow } from '@/features/auth/hooks';
import { LegalNote, ProviderButtons, SharedAlert, SigningIn } from '@/features/auth/parts';

/** 0b-1 · Create account — choose how. */
export default function CreateAccountScreen() {
  const flow = useProviderFlow('CREATE');
  return (
    <AuthScreen
      testID="screen-0b-1"
      back={{ onPress: () => router.back() }}
      title="Create your account"
      lead="Choose how you'll sign in. You'll use the same way every time."
      footer={
        <>
          <SharedAlert error={flow.alert} />
          <ProviderButtons verb="Continue" busy={flow.busy} onPress={(p) => void flow.run(p)} />
          <SecondaryButton
            label="Continue with email"
            disabled={flow.busy !== null}
            onPress={() => router.push('/sign-up/email')}
          />
          <View style={authStyles.row}>
            <Text style={authStyles.note}>Already have an account?</Text>
            <LinkButton label="Sign in" onPress={() => router.replace('/sign-in')} />
          </View>
          <LegalNote />
        </>
      }
    >
      <InfoCard overline="Good to know">
        Each email works with one sign-in method. If you choose Google now, you'll always sign in
        with Google.
      </InfoCard>
      <SigningIn provider={flow.busy} onCancel={() => undefined} />
    </AuthScreen>
  );
}
