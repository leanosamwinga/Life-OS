import { router, useLocalSearchParams } from 'expo-router';
import type { SignInMethod } from '@life-os/core';
import { AuthScreen, InfoCard, Lead, ProviderButton } from '@/components/auth';
import { PrimaryButton, SecondaryButton } from '@/components/forms';
import { useProviderFlow } from '@/features/auth/hooks';
import { SharedAlert, SigningIn } from '@/features/auth/parts';
import { providerName } from '@/lib/auth/copy';
import type { Provider } from '@/lib/backend/types';

/**
 * Wrong method after tapping Apple or Google (spec 2.4):
 *   0b-6e Google tapped → password account · 0b-6f Apple tapped → password account ·
 *   0b-6g Google tapped → Apple account · 0b-6h Apple tapped → Google account.
 * Nothing happens until a button is tapped.
 */
export default function UseMethodScreen() {
  const p = useLocalSearchParams<{ method: SignInMethod; tapped: Provider; email: string }>();
  const flow = useProviderFlow('SIGN_IN');
  const email = p.email ?? '';

  if (p.method === 'PASSWORD') {
    return (
      <AuthScreen
        testID={p.tapped === 'GOOGLE' ? 'screen-0b-6e' : 'screen-0b-6f'}
        back={{ onPress: () => router.back() }}
        title="This email uses a password"
        lead={
          <Lead
            before=""
            bold={email}
            after=" has a Life OS password. Sign in with your email and password instead."
          />
        }
        footer={
          <>
            <PrimaryButton
              label="Sign in with email"
              onPress={() => router.replace({ pathname: '/sign-in/email', params: { email } })}
            />
            <SecondaryButton
              label="Back to sign-in options"
              onPress={() => router.replace('/sign-in')}
            />
          </>
        }
      >
        <InfoCard>
          We'll fill in your email. Forgotten the password? You can reset it on the next screen.
        </InfoCard>
      </AuthScreen>
    );
  }

  const method = p.method as Provider;
  const name = providerName(method);
  return (
    <AuthScreen
      testID={method === 'APPLE' ? 'screen-0b-6g' : 'screen-0b-6h'}
      back={{ onPress: () => router.back() }}
      title={`This email uses ${name} to sign in`}
      lead={
        <Lead before="The Life OS account for " bold={email} after={` was set up with ${name}.`} />
      }
      footer={
        <>
          <SharedAlert error={flow.alert} />
          <ProviderButton
            provider={method}
            label={`Continue with ${name}`}
            primary
            busy={flow.busy !== null}
            onPress={() => void flow.run(method)}
          />
          <SecondaryButton
            label="Back to sign-in options"
            onPress={() => router.replace('/sign-in')}
          />
        </>
      }
    >
      <SigningIn provider={flow.busy} onCancel={() => undefined} />
    </AuthScreen>
  );
}
