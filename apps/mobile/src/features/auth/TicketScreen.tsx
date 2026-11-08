import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AuthScreen, InfoCard, Lead, ProviderButton } from '@/components/auth';
import { SecondaryButton } from '@/components/forms';
import { providerName } from '@/lib/auth/copy';
import { toAuthError } from '@/lib/auth/errors';
import type { Provider } from '@/lib/backend/types';
import { useBackend } from '@/lib/session';
import { postSignIn } from './hooks';

/**
 * Development only, on 0b-8i: a local database reset erases every account, so an Apple/Google
 * account made before it is "not recognised" afterwards — which is right, but surprising.
 */
export const DB_RESET_NOTE =
  'Local data was reset? `supabase db reset` erases every account — create it again.';

/**
 * 0b-8h (an account already exists → "Sign in with Google") and 0b-8i (not recognised →
 * "Create account with Google"). One tap uses the 2-minute, single-use ticket from auth-api,
 * so the person doesn't pick their Google/Apple account again.
 */
export function TicketScreen(props: {
  kind: 'exists' | 'not-found';
  ticket: string;
  email: string;
  provider: Provider;
}) {
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const name = providerName(props.provider);
  const exists = props.kind === 'exists';

  const go = async () => {
    setBusy(true);
    postSignIn.clear();
    try {
      await backend.auth.useTicket(props.ticket);
    } catch (raw) {
      const e = toAuthError(raw);
      router.replace({
        pathname: '/sign-in/failed',
        params: {
          provider: props.provider,
          intent: exists ? 'SIGN_IN' : 'CREATE',
          mismatch: e.code === 'PROVIDER_ACCOUNT_MISMATCH' ? '1' : '',
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      testID={exists ? 'screen-0b-8h' : 'screen-0b-8i'}
      back={{ onPress: () => router.back() }}
      title={
        exists ? 'An account already exists for this email' : "We don't recognise that account"
      }
      lead={
        exists ? (
          <Lead
            before=""
            bold={props.email}
            after={` already has a Life OS account with ${name}.`}
          />
        ) : (
          <Lead before="No Life OS account uses " bold={props.email} after="." />
        )
      }
      footer={
        <>
          <ProviderButton
            provider={props.provider}
            label={exists ? `Sign in with ${name}` : `Create account with ${name}`}
            primary
            busy={busy}
            onPress={() => void go()}
          />
          <SecondaryButton
            label={exists ? 'Use a different account' : 'Try a different account'}
            onPress={() => router.replace(exists ? '/sign-up' : '/sign-in')}
          />
        </>
      }
    >
      <InfoCard>
        {exists
          ? `Sign in goes straight to Today. You won't need to choose your ${name} account again.`
          : `Picked the wrong ${name} account? Try again and choose another.`}
      </InfoCard>
      {!exists && __DEV__ ? (
        <View testID="dev-note-db-reset">
          <InfoCard overline="Development build">{DB_RESET_NOTE}</InfoCard>
        </View>
      ) : null}
    </AuthScreen>
  );
}
