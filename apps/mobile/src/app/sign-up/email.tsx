import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { isValidEmail } from '@life-os/core';
import {
  AuthScreen,
  EmailField,
  Lead,
  PasswordField,
  ProviderButton,
  RuleList,
  authStyles,
} from '@/components/auth';
import { LinkButton, PrimaryButton } from '@/components/forms';
import {
  postSignIn,
  useClearOnBlur,
  usePasswordRules,
  useProviderFlow,
} from '@/features/auth/hooks';
import { SharedAlert, SigningIn } from '@/features/auth/parts';
import {
  EMAIL_INVALID,
  PASSWORD_ERRORS,
  PASSWORDS_DONT_MATCH,
  providerName,
} from '@/lib/auth/copy';
import type { AuthError } from '@/lib/auth/errors';
import { toAuthError } from '@/lib/auth/errors';
import { useBackend } from '@/lib/session';

/**
 * 0b-3 · Create account with email.
 *   3a empty · 3b filled (rules ticked live) · 3c creating · 3d passwords don't match ·
 *   3e too short (and too long / contains email) · 3f breached · 3g account exists ·
 *   3h uses Google / Apple.
 */
export default function CreateWithEmailScreen() {
  const backend = useBackend();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const { rules } = usePasswordRules(password, email);
  const provider = useProviderFlow('SIGN_IN');
  useClearOnBlur(setPassword, setConfirm);

  const clearPasswords = () => {
    setPassword('');
    setConfirm('');
  };

  const submit = async () => {
    setError(null);
    setEmailError(null);
    setMismatch(false);
    if (!isValidEmail(email)) {
      setEmailError(EMAIL_INVALID);
      clearPasswords();
      return;
    }
    if (password !== confirm) {
      setMismatch(true); // 0b-3d — checked on the device only
      clearPasswords();
      return;
    }
    setBusy(true);
    try {
      const c = await backend.auth.createAccount(email, password);
      clearPasswords();
      router.push({
        pathname: '/sign-up/code',
        params: { challengeId: c.challengeId, email: email.trim(), resendAt: c.resendAvailableAt },
      });
    } catch (raw) {
      const e = toAuthError(raw);
      clearPasswords();
      if (e.code === 'EMAIL_INVALID') setEmailError(EMAIL_INVALID);
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const wrongMethod =
    error?.code === 'WRONG_METHOD' && error.details.method !== 'PASSWORD'
      ? error.details.method!
      : null;
  if (error?.code === 'ACCOUNT_EXISTS') {
    // 0b-3g
    return (
      <AuthScreen
        testID="screen-0b-3g"
        back={{ onPress: () => setError(null) }}
        title="An account already exists for this email"
        lead={<Lead before="" bold={email.trim()} after=" already has a Life OS account." />}
        footer={
          <>
            <PrimaryButton
              label="Sign in instead"
              onPress={() => {
                postSignIn.clear();
                router.replace({ pathname: '/sign-in/email', params: { email: email.trim() } });
              }}
            />
            <Text style={authStyles.note}>We'll fill in your email for you.</Text>
          </>
        }
      />
    );
  }
  if (wrongMethod) {
    // 0b-3h (Google) and its Apple variant
    const name = providerName(wrongMethod);
    return (
      <AuthScreen
        testID="screen-0b-3h"
        back={{ onPress: () => setError(null) }}
        title={`This email uses ${name} to sign in`}
        lead={
          <Lead
            before=""
            bold={email.trim()}
            after={` already has a Life OS account set up with ${name}, so it can't have a password too.`}
          />
        }
        footer={
          <>
            <SharedAlert error={provider.alert} />
            <ProviderButton
              provider={wrongMethod}
              label={`Continue with ${name}`}
              primary
              busy={provider.busy !== null}
              onPress={() => void provider.run(wrongMethod)}
            />
          </>
        }
      >
        <SigningIn provider={provider.busy} onCancel={() => undefined} />
      </AuthScreen>
    );
  }

  const passwordError = mismatch
    ? PASSWORDS_DONT_MATCH
    : error
      ? (PASSWORD_ERRORS[error.code] ?? null)
      : null;
  return (
    <AuthScreen
      testID={
        mismatch
          ? 'screen-0b-3d'
          : error?.code === 'PASSWORD_BREACHED'
            ? 'screen-0b-3f'
            : passwordError
              ? 'screen-0b-3e'
              : 'screen-0b-3a'
      }
      back={{ onPress: () => router.back() }}
      title="Create account with email"
      footer={
        <>
          <SharedAlert error={passwordError ? null : error} />
          <PrimaryButton
            label={busy ? 'Creating account…' : 'Create account'}
            busy={busy}
            onPress={() => void submit()}
          />
          <View style={authStyles.row}>
            <Text style={authStyles.note}>Already have an account?</Text>
            <LinkButton
              label="Sign in"
              onPress={() =>
                router.replace({ pathname: '/sign-in/email', params: { email: email.trim() } })
              }
            />
          </View>
        </>
      }
    >
      <EmailField value={email} onChangeText={setEmail} error={emailError} />
      <PasswordField kind="new" value={password} onChangeText={setPassword} error={passwordError} />
      <PasswordField
        kind="new"
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        testID="field-confirm"
        onSubmitEditing={() => void submit()}
      />
      <RuleList rules={rules} />
    </AuthScreen>
  );
}
