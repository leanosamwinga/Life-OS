import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { AuthScreen, FieldError, Lead, PasswordField, ProviderButton } from '@/components/auth';
import { LinkButton, PrimaryButton } from '@/components/forms';
import { useClearOnBlur } from '@/features/auth/hooks';
import { reauth } from '@/features/auth/reauth';
import { SharedAlert } from '@/features/auth/parts';
import { WRONG_PASSWORD, providerName, waitText } from '@/lib/auth/copy';
import { AuthError, toAuthError } from '@/lib/auth/errors';
import type { SecurityInfo } from '@/lib/backend/types';
import { useBackend } from '@/lib/session';

/** S-5b (password) / S-5c (Apple or Google) · Confirm it's you · S-5d wrong password. */
export default function ConfirmItsYouScreen() {
  const backend = useBackend();
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  useClearOnBlur(setPassword);

  useEffect(() => {
    backend.auth
      .security()
      .then(setInfo)
      .catch((e) => setError(toAuthError(e)));
  }, [backend]);

  const done = useCallback((token: string) => {
    reauth.set(token);
    router.replace('/security/delete/type');
  }, []);

  const withPassword = async () => {
    setBusy(true);
    setError(null);
    try {
      done(await backend.auth.reauthWithPassword(password));
    } catch (raw) {
      setError(toAuthError(raw));
    } finally {
      setPassword('');
      setBusy(false);
    }
  };

  const withProvider = async (p: 'APPLE' | 'GOOGLE') => {
    setBusy(true);
    setError(null);
    try {
      done(await backend.auth.reauthWithProvider(p));
    } catch (raw) {
      if ((raw as Error)?.name !== 'ProviderCancelled') setError(toAuthError(raw));
    } finally {
      setBusy(false);
    }
  };

  const back = { onPress: () => router.back() };
  if (info && info.method !== 'PASSWORD') {
    const name = providerName(info.method);
    return (
      <AuthScreen
        testID="screen-S-5c"
        back={back}
        title="Confirm it's you"
        lead={`Continue with ${name} to carry on.`}
        footer={
          <>
            <SharedAlert
              error={error?.code === 'TOKEN_INVALID' ? new AuthError('SERVER_ERROR') : error}
            />
            <ProviderButton
              provider={info.method}
              label={`Continue with ${name}`}
              primary
              busy={busy}
              onPress={() => void withProvider(info.method as 'APPLE' | 'GOOGLE')}
            />
          </>
        }
      />
    );
  }
  const wrong = error?.code === 'WRONG_PASSWORD';
  const paused = error?.code === 'SIGN_IN_PAUSED';
  return (
    <AuthScreen
      testID={wrong ? 'screen-S-5d' : 'screen-S-5b'}
      back={back}
      title="Confirm it's you"
      lead="Enter your password to carry on."
      footer={
        <>
          <SharedAlert error={wrong || paused ? null : error} />
          <PrimaryButton
            label="Continue"
            busy={busy}
            disabled={!password}
            onPress={() => void withPassword()}
          />
          <Lead before="Signed up with Apple or Google? You'll confirm with them instead." />
        </>
      }
    >
      <PasswordField
        kind="current"
        value={password}
        onChangeText={setPassword}
        error={wrong ? WRONG_PASSWORD : null}
        onSubmitEditing={() => void withPassword()}
      />
      <FieldError>
        {paused
          ? `Too many tries. Try again in ${waitText(error?.retryAfterSeconds ?? 900)}.`
          : null}
      </FieldError>
      <LinkButton
        label="Forgot password?"
        onPress={() =>
          router.push({ pathname: '/forgot', params: info ? { email: info.email } : {} })
        }
      />
    </AuthScreen>
  );
}
