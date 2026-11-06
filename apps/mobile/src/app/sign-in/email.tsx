import { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  FormMessage,
  FormScreen,
  Lead,
  LinkButton,
  PrimaryButton,
  TextField,
  formStyles,
} from '@/components/forms';
import { OutlineButton, Overline } from '@/components/ui';
import { isPlausibleEmail, MIN_PASSWORD_LENGTH } from '@/features/auth/email';
import { useBackend } from '@/lib/session';
import { colors, space, type } from '@/theme';

type Mode = 'link' | 'password';

/** 0b Continue with email — magic link by default, password optional. */
export default function EmailSignInScreen() {
  const backend = useBackend();
  const [mode, setMode] = useState<Mode>('link');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const emailOk = isPlausibleEmail(email);

  async function attempt(fn: () => Promise<void>) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const sendLink = () =>
    attempt(async () => {
      const to = email.trim();
      await backend.auth.sendMagicLink(to);
      if (sentTo === to) setInfo('Sent again.');
      setSentTo(to);
    });

  const signIn = () => attempt(() => backend.auth.signInWithPassword(email.trim(), password));

  const createAccount = () =>
    attempt(async () => {
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
      const { needsEmailConfirmation } = await backend.auth.signUpWithPassword(
        email.trim(),
        password,
      );
      if (needsEmailConfirmation) {
        setSentTo(email.trim());
        setInfo('Check your inbox to confirm your email, then sign in.');
      }
    });

  return (
    <FormScreen testID="screen-sign-in-email" header={<LinkButtonBack />}>
      <Lead
        title="Continue with email"
        body={
          mode === 'link'
            ? 'We’ll email you a sign-in link. No password needed.'
            : 'Sign in with your email and password, or create an account.'
        }
      />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        autoCapitalize="none"
        returnKeyType={mode === 'link' ? 'send' : 'next'}
        onSubmitEditing={mode === 'link' && emailOk ? sendLink : undefined}
      />
      {mode === 'password' ? (
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          autoCapitalize="none"
          returnKeyType="go"
          onSubmitEditing={emailOk && password ? signIn : undefined}
        />
      ) : null}

      {error ? <FormMessage>{error}</FormMessage> : null}
      {info ? <FormMessage tone="info">{info}</FormMessage> : null}

      {mode === 'link' ? (
        <PrimaryButton
          label="Send sign-in link"
          busy={busy}
          disabled={!emailOk}
          onPress={sendLink}
        />
      ) : (
        <View style={formStyles.stack}>
          <PrimaryButton
            label="Sign in"
            busy={busy}
            disabled={!emailOk || !password}
            onPress={signIn}
          />
          <LinkButton
            label="New here? Create an account"
            onPress={createAccount}
            accessibilityLabel="Create an account with this email and password"
          />
        </View>
      )}

      <LinkButton
        label={mode === 'link' ? 'Use a password instead' : 'Email me a sign-in link instead'}
        onPress={() => {
          setMode(mode === 'link' ? 'password' : 'link');
          setError(null);
          setInfo(null);
        }}
      />

      {sentTo && mode === 'link' ? (
        <View style={[formStyles.greyCard, styles.sent]} accessibilityLiveRegion="polite">
          <Overline>After sending</Overline>
          <Text style={styles.sentTitle}>Check your inbox</Text>
          <Text style={formStyles.body}>
            We sent a link to {sentTo}. Tap it on this device to finish. It expires in 1 hour.
          </Text>
          <View style={styles.sentButtons}>
            {Platform.OS === 'ios' ? (
              <OutlineButton label="Open Mail" onPress={() => void Linking.openURL('message://')} />
            ) : null}
            <OutlineButton
              label="Resend"
              onPress={sendLink}
              accessibilityLabel="Resend sign-in link"
            />
          </View>
          {__DEV__ ? (
            <Text style={styles.dev}>
              Local development: links arrive in Mailpit at http://127.0.0.1:54324
            </Text>
          ) : null}
        </View>
      ) : null}
    </FormScreen>
  );
}

function LinkButtonBack() {
  return (
    <LinkButton
      label="‹ Back"
      plain
      accessibilityLabel="Back"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
    />
  );
}

const styles = StyleSheet.create({
  sent: { marginTop: space.xl },
  sentTitle: { ...type.headline, color: colors.text },
  sentButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  dev: { ...type.caption, color: colors.textTertiary, marginTop: space.sm },
});
