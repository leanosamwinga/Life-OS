import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AuthScreen, InfoCard, Lead, PasswordField, RuleList, authStyles } from '@/components/auth';
import { PrimaryButton } from '@/components/forms';
import { useClearOnBlur, usePasswordRules } from '@/features/auth/hooks';
import { SharedAlert } from '@/features/auth/parts';
import { PASSWORD_ERRORS, PASSWORDS_DONT_MATCH } from '@/lib/auth/copy';
import type { AuthError } from '@/lib/auth/errors';
import { toAuthError } from '@/lib/auth/errors';
import { useBackend } from '@/lib/session';
import { colors } from '@/theme';

/** The token comes in the URL fragment (`#t=…`) so it never reaches server logs (spec 2.8.4). */
function useResetToken(): string | null {
  const params = useLocalSearchParams<{ t?: string }>();
  const [token] = useState(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.hash.slice(1)).get('t');
      if (t) {
        // Drop it from the address bar and history straight away.
        window.history.replaceState(null, '', window.location.pathname);
        return t;
      }
    }
    return params.t ?? null;
  });
  return token;
}

/**
 * 0b-7f · Set a new password · 7g filled · 7h saving · 7i don't match · password errors ·
 * 7j link expired · 7k password changed. The link never signs anyone in.
 */
export default function ResetPasswordScreen() {
  const backend = useBackend();
  const token = useResetToken();
  const [state, setState] = useState<'checking' | 'form' | 'invalid' | 'done'>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const { rules } = usePasswordRules(password, email);
  useClearOnBlur(setPassword, setConfirm);

  useEffect(() => {
    if (!token) return setState('invalid');
    backend.auth
      .verifyResetLink(token)
      .then((r) => {
        setEmail(r.email);
        setState('form');
      })
      .catch(() => setState('invalid'));
  }, [backend, token]);

  const save = async () => {
    setError(null);
    setMismatch(false);
    if (password !== confirm) {
      setMismatch(true);
      setPassword('');
      setConfirm('');
      return;
    }
    setBusy(true);
    try {
      await backend.auth.completeReset(token!, password);
      setState('done');
    } catch (raw) {
      const e = toAuthError(raw);
      if (e.code === 'RESET_LINK_INVALID') setState('invalid');
      else setError(e);
    } finally {
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  };

  const toSignIn = () =>
    router.replace({ pathname: '/sign-in/email', params: email ? { email } : {} });

  if (state === 'checking') {
    return (
      <View style={[authStyles.row, { flex: 1 }]} accessibilityLabel="Checking your link">
        <ActivityIndicator color={colors.fill} />
      </View>
    );
  }
  if (state === 'invalid') {
    return (
      <AuthScreen
        testID="screen-0b-7j"
        title="This link has expired"
        lead="Reset links work once and last 30 minutes. Ask for a new one and use the latest email."
        footer={
          <PrimaryButton
            label="Send a new link"
            onPress={() => router.replace({ pathname: '/forgot', params: email ? { email } : {} })}
          />
        }
      />
    );
  }
  if (state === 'done') {
    return (
      <AuthScreen
        testID="screen-0b-7k"
        title="Password changed"
        lead="Sign in with your new password. We've signed you out on your other devices and emailed you to confirm."
        footer={
          <>
            <PrimaryButton label="Sign in" onPress={toSignIn} />
            <Lead before="Your email will be filled in." />
          </>
        }
      >
        <InfoCard>Didn't change it yourself? Reset it again straight away.</InfoCard>
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
      testID={mismatch ? 'screen-0b-7i' : busy ? 'screen-0b-7h' : 'screen-0b-7f'}
      title="Set a new password"
      lead={<Lead before="For " bold={email} after="." />}
      footer={
        <>
          <SharedAlert error={passwordError ? null : error} />
          <PrimaryButton
            label={busy ? 'Saving…' : 'Save password'}
            busy={busy}
            onPress={() => void save()}
          />
        </>
      }
    >
      <PasswordField
        kind="new"
        label="New password"
        value={password}
        onChangeText={setPassword}
        error={passwordError}
      />
      <PasswordField
        kind="new"
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        testID="field-confirm"
        onSubmitEditing={() => void save()}
      />
      <RuleList rules={rules} />
    </AuthScreen>
  );
}
