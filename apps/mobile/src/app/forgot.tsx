import { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { isValidEmail } from '@life-os/core';
import { AuthScreen, EmailField, FieldNote, InfoCard, Lead, useCountdown } from '@/components/auth';
import { LinkButton, PrimaryButton, SecondaryButton } from '@/components/forms';
import { SharedAlert } from '@/features/auth/parts';
import { EMAIL_INVALID, countdownText } from '@/lib/auth/copy';
import type { AuthError } from '@/lib/auth/errors';
import { toAuthError } from '@/lib/auth/errors';
import { useBackend } from '@/lib/session';
import { space } from '@/theme';

/**
 * 0b-7a · Reset your password (email carried over) → 0b-7b sending → 0b-7c check your inbox.
 * The answer is always the same, so the screen never says whether the email has an account.
 */
export default function ForgotPasswordScreen() {
  const backend = useBackend();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const wait = useCountdown(resendAt);

  const send = async () => {
    setError(null);
    setEmailError(null);
    if (!isValidEmail(email)) return setEmailError(EMAIL_INVALID);
    setBusy(true);
    try {
      await backend.auth.requestPasswordReset(email);
      setSent(true);
      setResendAt(Date.now() + 30_000);
    } catch (raw) {
      setError(toAuthError(raw));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthScreen
        testID="screen-0b-7c"
        title="Check your inbox"
        lead={
          <Lead
            before="If "
            bold={email.trim()}
            after=" has a Life OS password, we've sent a link to reset it. It works once and expires in 30 minutes."
          />
        }
        footer={
          <>
            <SharedAlert error={error} />
            <View style={styles.pair}>
              {Platform.OS === 'ios' ? (
                <SecondaryButton
                  label="Open Mail"
                  style={styles.half}
                  onPress={() => void Linking.openURL('message://')}
                />
              ) : null}
              <SecondaryButton
                label={wait > 0 ? `Resend in ${countdownText(wait)}` : 'Resend'}
                disabled={wait > 0 || busy}
                style={styles.half}
                onPress={() => void send()}
              />
            </View>
            <LinkButton
              label="Back to sign in"
              onPress={() =>
                router.replace({ pathname: '/sign-in/email', params: { email: email.trim() } })
              }
            />
          </>
        }
      >
        <InfoCard overline="Nothing there?">
          Check your spam folder. If you signed up with Apple or Google, you don't have a password:
          go back and use that button instead.
        </InfoCard>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      testID={busy ? 'screen-0b-7b' : 'screen-0b-7a'}
      back={{ onPress: () => router.back() }}
      title="Reset your password"
      lead="Enter the email you sign in with. We'll send a link to set a new password."
      footer={
        <>
          <SharedAlert error={error} />
          <PrimaryButton
            label={busy ? 'Sending…' : 'Send reset link'}
            busy={busy}
            onPress={() => void send()}
          />
        </>
      }
    >
      <View>
        <EmailField
          value={email}
          onChangeText={setEmail}
          error={emailError}
          onSubmitEditing={() => void send()}
        />
        {params.email ? <FieldNote>Filled in from the sign-in screen.</FieldNote> : null}
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
});
