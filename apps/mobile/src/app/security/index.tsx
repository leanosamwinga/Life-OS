import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AuthAlert, AuthScreen, ListGroup, ListRow } from '@/components/auth';
import { PrimaryButton, SecondaryButton } from '@/components/forms';
import { longDateUK, providerName } from '@/lib/auth/copy';
import type { SecurityInfo } from '@/lib/backend/types';
import { useBackend } from '@/lib/session';
import { colors } from '@/theme';

/**
 * S-1 · Security. S-1a password account · S-3a Apple / Google account (no password) ·
 * S-1b loading · S-1c couldn't load.
 */
export default function SecurityScreen() {
  const backend = useBackend();
  const [info, setInfo] = useState<SecurityInfo | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    backend.auth
      .security()
      .then(setInfo)
      .catch(() => setFailed(true));
  }, [backend]);
  useFocusEffect(load);

  const back = { label: 'Me', onPress: () => router.back() };
  if (failed) {
    return (
      <AuthScreen
        testID="screen-S-1c"
        back={back}
        title="Security"
        footer={<PrimaryButton label="Try again" onPress={load} />}
      >
        <AuthAlert
          title="Couldn't load your security settings"
          body="Nothing has changed. Check your connection and try again."
        />
      </AuthScreen>
    );
  }
  if (!info) {
    return (
      <AuthScreen testID="screen-S-1b" back={back} title="Security">
        <View accessibilityLabel="Loading" style={{ paddingVertical: 32 }}>
          <ActivityIndicator color={colors.fill} />
        </View>
      </AuthScreen>
    );
  }

  const password = info.method === 'PASSWORD';
  const name = providerName(info.method);
  return (
    <AuthScreen
      testID={password ? 'screen-S-1a' : 'screen-S-3a'}
      back={back}
      title="Security"
      footer={
        <SecondaryButton label="Delete account" onPress={() => router.push('/security/delete')} />
      }
    >
      <ListGroup title="Signing in">
        <ListRow first label="Sign-in method" value={password ? 'Email and password' : name} />
        {info.isPrivateRelay ? (
          <ListRow label="Email" subtitle="Hide My Email address" value="Hidden" />
        ) : (
          <ListRow label="Email" value={info.email} />
        )}
        {password ? (
          <ListRow
            label="Password"
            subtitle={
              info.passwordChangedAt
                ? `Last changed ${longDateUK(info.passwordChangedAt)}`
                : undefined
            }
            onPress={() => router.push('/security/password')}
          />
        ) : (
          <ListRow
            label="Password"
            subtitle={`You don't have one. You sign in with ${name}.`}
            onPress={() =>
              router.push({ pathname: '/security/method', params: { method: info.method } })
            }
          />
        )}
        <ListRow
          label="Signed-in devices"
          value={String(info.deviceCount)}
          onPress={() => router.push('/security/devices')}
        />
      </ListGroup>
      <ListGroup title="Coming later">
        <ListRow
          first
          muted
          label="Two-step verification"
          subtitle="An extra code when you sign in"
          pill="Later"
        />
        <ListRow muted label="Passkeys" subtitle="Sign in with Face ID instead" pill="Later" />
        <ListRow
          muted
          label="Change sign-in method"
          subtitle="Move to a different way of signing in"
          pill="Later"
        />
      </ListGroup>
    </AuthScreen>
  );
}
