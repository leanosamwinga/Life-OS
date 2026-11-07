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
import { MIN_PASSWORD_LENGTH, resolveSignInEmail } from '@/features/auth/email';
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
  const [code, setCode] = useState('');

  // In development builds a bare username (e.g. "admin") means the seeded local account.
  const address = resolveSignInEmail(email, __DEV__ && mode === 'password');
  const emailOk = address !== null;
  const codeOk = /^\d{6}$/.test(code.trim());

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
      const to = address!;
      await backend.auth.sendMagicLink(to);
      if (sentTo === to) setInfo('Sent again.');
      setSentTo(to);
    });

  const signIn = () => attempt(() => backend.auth.signInWithPassword(address!, password));

  const signInWithCode = () => attempt(() => backend.auth.verifyEmailCode(sentTo!, code.trim()));

  const createAccount = () =>
    attempt(async () => {
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
      const { needsEmailConfirmation } = await backend.auth.signUpWithPassword(address!, password);
      if (needsEmailConfirmation) {
        setSentTo(address);
        setInfo('Check your inbox to confirm your email, then sign in.');
      }
    });

  return (
    <FormScreen testID="screen-sign-in-email" header={<LinkButtonBack />}>
      <Lead
        title="Continue with email"
        body={
          mode === 'link'
            ? 'We’ll email you a sign-in code and link. No password needed.'
            : 'Sign in with your email and password, or create an account.'
        }
      />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder={
          __DEV__ && mode === 'password' ? 'you@example.com, or admin' : 'you@example.com'
        }
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
            We sent a 6-digit code and a link to {sentTo}. Type the code here, or tap the link on
            this device. Both expire in 1 hour.
          </Text>
          <View style={styles.code}>
            <TextField
              label="6-digit code"
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="123456"
              returnKeyType="go"
              onSubmitEditing={codeOk ? signInWithCode : undefined}
            />
            <PrimaryButton
              label="Sign in with code"
              busy={busy}
              disabled={!codeOk}
              onPress={signInWithCode}
            />
          </View>
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
              Local development: emails arrive in Mailpit at {mailpitUrl()}
            </Text>
          ) : null}
        </View>
      ) : null}
    </FormScreen>
  );
}

/** Mailpit runs next to the local Supabase API, on port 54324. */
function mailpitUrl(): string {
  const api = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  return api.replace(/:\d+\/?$/, ':54324');
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
  code: { marginTop: space.md },
  sentButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  dev: { ...type.caption, color: colors.textTertiary, marginTop: space.sm },
});
