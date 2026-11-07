import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { isPrivateRelayEmail, isValidEmail } from '@life-os/core';
import {
  AuthAlert,
  AuthScreen,
  EmailField,
  FieldError,
  FieldNote,
  PasswordField,
  ProviderButton,
  authStyles,
  useCountdown,
} from '@/components/auth';
import { LinkButton, PrimaryButton } from '@/components/forms';
import { useClearOnBlur, useProviderFlow } from '@/features/auth/hooks';
import { SharedAlert, SigningIn } from '@/features/auth/parts';
import { EMAIL_INVALID, WRONG_PASSWORD, providerName, waitText } from '@/lib/auth/copy';
import type { AuthError } from '@/lib/auth/errors';
import { toAuthError } from '@/lib/auth/errors';
import { useBackend } from '@/lib/session';

/**
 * 0b-5 · Sign in with email.
 *   5a empty · 5b filled · 5c signing in · 5d wrong password · 5e not recognised (0b-6d fuller
 *   Apple hint) · 5f paused · 5g email not confirmed · 6a/6b/6c this email uses Google / Apple.
 *   Correct password + new device after unusual tries → 0b-5h (sign-in/check).
 * The password clears after every error; the email stays.
 */
export default function SignInWithEmailScreen() {
  const backend = useBackend();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const wait = useCountdown(waitUntil);
  const provider = useProviderFlow('SIGN_IN');
  useClearOnBlur(setPassword);

  // Local development only (decision 7): the bare username "admin" means the seeded account.
  const typed = __DEV__ && email.trim() === 'admin' ? 'admin@example.test' : email.trim();

  const submit = async () => {
    setError(null);
    setEmailError(null);
    if (!isValidEmail(typed)) {
      setEmailError(EMAIL_INVALID);
      setPassword('');
      return;
    }
    setBusy(true);
    try {
      await backend.auth.signInWithPassword(typed, password);
      setPassword('');
      // Signed in: the root guard goes to Today (or S-5h for an account being deleted).
    } catch (raw) {
      const e = toAuthError(raw);
      setPassword('');
      if (e.code === 'EMAIL_INVALID') setEmailError(EMAIL_INVALID);
      else if (e.code === 'STEP_UP_REQUIRED') {
        router.push({
          pathname: '/sign-in/check',
          params: { challengeId: e.details.challenge_id ?? '', email: typed },
        });
      } else {
        if ((e.code === 'SIGN_IN_PAUSED' || e.code === 'RATE_LIMITED') && e.retryAfterSeconds) {
          setWaitUntil(Date.now() + e.retryAfterSeconds * 1000);
        }
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const paused = error?.code === 'SIGN_IN_PAUSED' && wait > 0;
  const limited = error?.code === 'RATE_LIMITED' && wait > 0;
  const method = error?.code === 'WRONG_METHOD' ? error.details.method : undefined;
  const relay = Boolean(error?.details.is_private_relay) || isPrivateRelayEmail(typed);

  let alert: React.ReactNode = null;
  let testID = busy ? 'screen-0b-5c' : password || typed ? 'screen-0b-5b' : 'screen-0b-5a';
  if (error?.code === 'ACCOUNT_NOT_FOUND') {
    const fuller = !isPrivateRelayEmail(typed); // 0b-6d (spec 2.5.2)
    testID = fuller ? 'screen-0b-6d' : 'screen-0b-5e';
    alert = (
      <AuthAlert
        title="We don't recognise that account"
        body={
          fuller
            ? `No Life OS account uses ${typed}. Signed up with Apple and 'Hide My Email'? Continue with Apple instead.`
            : `No Life OS account uses ${typed}.`
        }
        note={fuller ? undefined : 'Signed up with Apple? Try Continue with Apple instead.'}
      >
        {fuller ? (
          <ProviderButton
            provider="APPLE"
            label="Continue with Apple"
            primary
            busy={provider.busy === 'APPLE'}
            onPress={() => void provider.run('APPLE')}
          />
        ) : null}
        <PrimaryButton
          label="Create account with this email"
          onPress={() => router.replace({ pathname: '/sign-up/email', params: { email: typed } })}
          style={fuller ? undefined : undefined}
        />
      </AuthAlert>
    );
  } else if (method && method !== 'PASSWORD') {
    const name = providerName(method);
    testID = method === 'GOOGLE' ? 'screen-0b-6a' : relay ? 'screen-0b-6c' : 'screen-0b-6b';
    alert = (
      <AuthAlert
        title={`This email uses ${name} to sign in`}
        body={
          method === 'APPLE' && relay
            ? "This is an Apple 'Hide My Email' address. It works with Continue with Apple only."
            : `${typed} was set up with ${name}, so there's no password to enter.`
        }
      >
        <ProviderButton
          provider={method}
          label={`Continue with ${name}`}
          primary
          busy={provider.busy === method}
          onPress={() => void provider.run(method)}
        />
      </AuthAlert>
    );
  } else if (error?.code === 'SIGN_IN_PAUSED') {
    testID = 'screen-0b-5f';
    alert = (
      <AuthAlert
        title="Too many tries"
        body={`For your security, sign-in is paused on this device for ${waitText(error.retryAfterSeconds ?? 900)}. Wait and try again, or reset your password now.`}
      >
        <PrimaryButton
          label="Reset password"
          onPress={() => router.push({ pathname: '/forgot', params: { email: typed } })}
        />
      </AuthAlert>
    );
  } else if (error?.code === 'EMAIL_NOT_CONFIRMED') {
    testID = 'screen-0b-5g';
    alert = (
      <AuthAlert
        title="Confirm your email first"
        body={`We've sent a new 6-digit code to ${typed}.`}
      >
        <PrimaryButton
          label="Enter code"
          onPress={() =>
            router.push({
              pathname: '/sign-up/code',
              params: { challengeId: error.details.challenge_id ?? '', email: typed },
            })
          }
        />
      </AuthAlert>
    );
  } else if (error?.code === 'WRONG_PASSWORD') {
    testID = 'screen-0b-5d';
  } else if (error) {
    alert = <SharedAlert error={error} />;
  }

  const locked = paused || limited;
  return (
    <AuthScreen
      testID={testID}
      back={{ onPress: () => (router.canGoBack() ? router.back() : router.replace('/sign-in')) }}
      title="Sign in with email"
      footer={
        <>
          <PrimaryButton
            label={locked ? `Try again in ${waitText(wait)}` : busy ? 'Signing in…' : 'Sign in'}
            busy={busy}
            disabled={locked || !typed || !password}
            onPress={() => void submit()}
          />
          <View style={authStyles.row}>
            <Text style={authStyles.note}>New to Life OS?</Text>
            <LinkButton
              label="Create an account"
              onPress={() =>
                router.replace({ pathname: '/sign-up/email', params: { email: typed } })
              }
            />
          </View>
        </>
      }
    >
      {alert}
      <View>
        <EmailField value={email} onChangeText={setEmail} error={emailError} />
        {error?.code === 'ACCOUNT_NOT_FOUND' ? (
          <FieldNote>Typo? Fix it here and sign in again.</FieldNote>
        ) : null}
      </View>
      <PasswordField
        kind="current"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => void submit()}
      />
      <FieldError>{error?.code === 'WRONG_PASSWORD' ? WRONG_PASSWORD : null}</FieldError>
      <View style={{ alignItems: 'flex-end' }}>
        <LinkButton
          label="Forgot password?"
          onPress={() => router.push({ pathname: '/forgot', params: { email: typed } })}
        />
      </View>
      <SigningIn provider={provider.busy} onCancel={() => undefined} />
    </AuthScreen>
  );
}
