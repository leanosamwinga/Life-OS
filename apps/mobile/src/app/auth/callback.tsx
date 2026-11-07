import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PrimaryButton } from '@/components/forms';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/theme';

/**
 * `lifeos://auth/callback?code=…` — where magic links and OAuth providers return.
 * Exchanges the one-time code for a session; the root guards then route to onboarding or Today.
 */
export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<Record<string, string>>();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || session.status === 'loading') return;
    started.current = true;
    if (!session.backend) {
      router.replace('/');
      return;
    }
    // Already signed in (e.g. the in-app browser finished first): nothing to exchange.
    if (session.status === 'signedIn') {
      router.replace('/');
      return;
    }
    session.backend.auth
      .completeRedirect(params)
      .then(() => router.replace('/'))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'That sign-in link didn’t work.'),
      );
  }, [params, session]);

  if (error) {
    return (
      <View style={styles.center} testID="screen-auth-callback">
        <Text style={styles.title} accessibilityRole="header">
          Couldn’t sign you in
        </Text>
        <Text style={styles.body}>{error}</Text>
        <PrimaryButton label="Back to sign in" onPress={() => router.replace('/welcome')} />
      </View>
    );
  }
  return (
    <View style={styles.center} testID="screen-auth-callback" accessibilityLabel="Signing you in">
      <ActivityIndicator color={colors.fill} />
      <Text style={styles.body}>Signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
    backgroundColor: colors.background,
  },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  body: { ...type.callout, color: colors.textSecondary, textAlign: 'center' },
});
