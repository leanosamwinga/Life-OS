import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/forms';
import { getBackend } from '@/lib/backend/current';
import { postSignIn } from '@/features/auth/hooks';
import { AppleHealthProvider } from '@/features/health/AppleHealth';
import { PendingDeleteProvider } from '@/features/today/PendingDelete';
import { SessionProvider, useSession } from '@/lib/session';
import { colors, space, type } from '@/theme';

// Deep links into modals (e.g. /log-meal) open on top of the tabs.
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider backend={getBackend()}>
        <AppleHealthProvider>
          <PendingDeleteProvider>
            <RootStack />
          </PendingDeleteProvider>
        </AppleHealthProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * Route guards (screen IDs → routes: docs/sign-in-supabase-mapping.md):
 * - Not connected (no Supabase env): the tabs with sample data, no sign-in.
 * - Signed out: 0a Welcome and the sign-up / sign-in screens (rows 1–8). The reset link
 *   (/reset) works signed in or out: it never signs anyone in.
 * - Account being deleted (scope PENDING_DELETION): only S-5h (/deletion).
 * - Signed in, onboarding not finished: 0b-4g, then 0c–0g.
 * - Signed in and set up: the app, including Me → Security (row 9).
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
  const pending = signedIn && session.pendingDeletion;
  const active = signedIn && !pending;
  const onboarded = active && Boolean(session.settings?.onboardingCompletedAt);
  // Where the next redirect lands: 0b-4g for a new email account, S-5i after "Keep my
  // account". The stack remounts when the session changes, so every guard below uses it.
  const landing = postSignIn.take();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected
        guard={!connected || onboarded}
        redirectTo={pending ? '/deletion' : active ? (landing ?? '/onboarding') : '/welcome'}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="log-meal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="meal" />
        <Stack.Screen name="security" />
        <Stack.Screen name="kept" />
      </Stack.Protected>
      <Stack.Protected
        guard={connected && !signedIn}
        redirectTo={pending ? '/deletion' : (landing ?? '/')}
      >
        <Stack.Screen name="welcome" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="forgot" />
      </Stack.Protected>
      <Stack.Protected guard={pending} redirectTo={landing ?? '/'}>
        <Stack.Screen name="deletion" />
      </Stack.Protected>
      <Stack.Protected
        guard={active && !onboarded}
        redirectTo={pending ? '/deletion' : active ? '/' : '/welcome'}
      >
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={active} redirectTo="/welcome">
        <Stack.Screen name="targets" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Screen name="reset" />
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
