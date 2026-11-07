import { router, useLocalSearchParams } from 'expo-router';
import { AuthScreen } from '@/components/auth';
import { PrimaryButton, SecondaryButton } from '@/components/forms';
import { useProviderFlow } from '@/features/auth/hooks';
import { SigningIn } from '@/features/auth/parts';
import { providerName } from '@/lib/auth/copy';
import type { Intent, Provider } from '@/lib/backend/types';

/** 0b-8g · That didn't work (TOKEN_INVALID, PROVIDER_ERROR, TICKET_EXPIRED, network; mismatch → support copy). */
export default function SignInFailedScreen() {
  const p = useLocalSearchParams<{ provider: Provider; intent: Intent; mismatch?: string }>();
  const flow = useProviderFlow(p.intent ?? 'SIGN_IN');
  const name = providerName(p.provider);
  const mismatch = p.mismatch === '1';
  return (
    <AuthScreen
      testID="screen-0b-8g"
      back={{ onPress: () => router.back() }}
      title="That didn't work"
      lead={
        mismatch
          ? `We couldn't sign you in with ${name}. Contact support and we'll sort it out.`
          : `We couldn't sign you in with ${name}. Nothing has changed. Check your connection and try again.`
      }
      footer={
        <>
          {mismatch ? null : (
            <PrimaryButton
              label="Try again"
              busy={flow.busy !== null}
              onPress={() => void flow.run(p.provider)}
            />
          )}
          <SecondaryButton
            label="Choose another way"
            onPress={() => router.replace(p.intent === 'CREATE' ? '/sign-up' : '/sign-in')}
          />
        </>
      }
    >
      <SigningIn provider={flow.busy} onCancel={() => undefined} />
    </AuthScreen>
  );
}
