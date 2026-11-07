import { Platform, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AuthScreen, InfoCard, authStyles } from '@/components/auth';
import { LinkButton, SecondaryButton } from '@/components/forms';
import { useProviderFlow } from '@/features/auth/hooks';
import { LegalNote, ProviderButtons, SharedAlert, SigningIn } from '@/features/auth/parts';

/** 0b-2 · Sign in — choose how you signed up. */
export default function SignInScreen() {
  const flow = useProviderFlow('SIGN_IN');
  const { signedOut } = useLocalSearchParams<{ signedOut?: string }>();
  return (
    <AuthScreen
      testID="screen-0b-2"
      back={{ onPress: () => (router.canGoBack() ? router.back() : router.replace('/welcome')) }}
      title="Welcome back"
      lead="Sign in the same way you did when you created your account."
      footer={
        <>
          <SharedAlert error={flow.alert} />
          <ProviderButtons verb="Continue" busy={flow.busy} onPress={(p) => void flow.run(p)} />
          <SecondaryButton
            label="Continue with email"
            disabled={flow.busy !== null}
            onPress={() => router.push('/sign-in/email')}
          />
          <View style={authStyles.row}>
            <Text style={authStyles.note}>New to Life OS?</Text>
            <LinkButton label="Create an account" onPress={() => router.replace('/sign-up')} />
          </View>
          <LegalNote />
        </>
      }
    >
      {/* Spec 3.3: on the web, a signed-out session says so here. */}
      {signedOut && Platform.OS === 'web' ? (
        <InfoCard>You've been signed out. Sign in again.</InfoCard>
      ) : null}
      <SigningIn provider={flow.busy} onCancel={() => undefined} />
    </AuthScreen>
  );
}
