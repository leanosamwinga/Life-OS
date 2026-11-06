import { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { PRIVACY_POLICY_URL, TERMS_URL } from '@life-os/core';
import {
  FormMessage,
  FormScreen,
  IconTile,
  PrimaryButton,
  SecondaryButton,
} from '@/components/forms';
import { CancelledError } from '@/lib/backend/types';
import { useBackend } from '@/lib/session';
import { colors, space, type } from '@/theme';

/** 0a Welcome — sign in with Apple, Google or email. */
export default function WelcomeScreen() {
  const backend = useBackend();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (which: 'apple' | 'google') => async () => {
    setError(null);
    setBusy(which);
    try {
      await (which === 'apple' ? backend.auth.signInWithApple() : backend.auth.signInWithGoogle());
    } catch (err) {
      if (!(err instanceof CancelledError)) {
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <FormScreen
      testID="screen-welcome"
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          {/* Apple is always offered alongside Google (App Store guideline 4.8). */}
          <PrimaryButton
            label="Continue with Apple"
            icon={<View style={styles.appleGlyph} />}
            busy={busy === 'apple'}
            disabled={busy !== null}
            onPress={run('apple')}
          />
          <SecondaryButton
            label="Continue with Google"
            icon={<View style={styles.googleGlyph} />}
            disabled={busy !== null}
            onPress={run('google')}
          />
          <SecondaryButton
            label="Continue with email"
            disabled={busy !== null}
            onPress={() => router.push('/sign-in/email')}
          />
          <Text style={styles.legal}>
            By continuing you agree to the{' '}
            <Text
              style={styles.legalLink}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(TERMS_URL)}
            >
              Terms
            </Text>{' '}
            and have read the{' '}
            <Text
              style={styles.legalLink}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
            >
              Privacy Policy
            </Text>
            . UK only.
          </Text>
        </>
      }
    >
      <View style={styles.top}>
        <IconTile size={88} />
        <Text style={styles.title} accessibilityRole="header">
          Life OS
        </Text>
        <Text style={styles.body}>
          Health, money and plans in one calm place. Your data stays yours: no ads, never sold.
        </Text>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  top: { paddingTop: Platform.OS === 'web' ? space.xxl : space.xl, gap: space.lg },
  title: { ...type.largeTitle, fontSize: 40, color: colors.text, marginTop: space.lg },
  body: { ...type.body, color: colors.textSecondary, lineHeight: 24 },
  appleGlyph: { width: 18, height: 18, borderRadius: 3, backgroundColor: colors.inverseText },
  googleGlyph: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.fillMuted },
  legal: {
    ...type.footnote,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: space.sm,
  },
  legalLink: { color: colors.text, textDecorationLine: 'underline' },
});
