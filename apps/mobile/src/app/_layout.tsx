import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/forms';
import { getBackend } from '@/lib/backend/current';
import { SessionProvider, useSession } from '@/lib/session';
import { colors, space, type } from '@/theme';

// Deep links into modals (e.g. /log-meal) open on top of the tabs.
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider backend={getBackend()}>
        <RootStack />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * Route guards:
 * - Not connected (no Supabase env): the tabs with sample data, no sign-in.
 * - Signed out: Welcome (0a) and email sign-in (0b).
 * - Signed in, onboarding not finished: 0c–0g.
 * - Signed in and set up: the app.
 */
function RootStack() {
  const session = useSession();

  if (session.status === 'loading') {
    if (session.loadError) {
      return (
        <View style={styles.center} accessibilityLabel="Could not load your data">
          <Text style={styles.title}>Couldn’t load your data</Text>
          <Text style={styles.body}>{session.loadError}</Text>
          <PrimaryButton label="Try again" onPress={() => void session.refresh()} />
        </View>
      );
    }
    return (
      <View style={styles.center} accessibilityLabel="Loading">
        <ActivityIndicator color={colors.fill} />
      </View>
    );
  }

  const connected = session.status !== 'disconnected';
  const signedIn = session.status === 'signedIn';
  const onboarded = signedIn && Boolean(session.settings?.onboardingCompletedAt);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected
        guard={!connected || onboarded}
        redirectTo={signedIn ? '/onboarding/consent' : '/welcome'}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="log-meal" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={connected && !signedIn} redirectTo="/">
        <Stack.Screen name="welcome" />
        <Stack.Screen name="sign-in/email" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded} redirectTo={signedIn ? '/' : '/welcome'}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn} redirectTo="/welcome">
        <Stack.Screen
          name="targets"
          options={{ presentation: 'modal', headerShown: true, title: 'Daily targets' }}
        />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
    backgroundColor: colors.background,
  },
  title: { ...type.title, color: colors.text },
  body: { ...type.callout, color: colors.textSecondary, textAlign: 'center' },
});
