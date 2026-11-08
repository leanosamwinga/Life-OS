import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AuthAlert, AuthScreen, ListGroup, ListRow, Lead } from '@/components/auth';
import { PrimaryButton, SecondaryButton } from '@/components/forms';
import type { DeviceSession } from '@/lib/backend/types';
import { useBackend } from '@/lib/session';
import { colors, space, type } from '@/theme';

function ago(iso: string, now = Date.now()): string {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 5) return 'active now';
  if (mins < 60) return `${mins} minutes ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * S-4 · Signed-in devices. 4a list · 4b confirm sign out one (action sheet) · 4c signing out ·
 * 4d signed out (list updates) · 4e sign out everywhere (confirm) · 4f only this device ·
 * 4g couldn't sign out. Platform, label and a rough town only — never an IP address.
 */
export default function DevicesScreen() {
  const backend = useBackend();
  const [devices, setDevices] = useState<DeviceSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<DeviceSession | 'all' | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<string | null>(null);

  const load = useCallback(() => {
    backend.auth
      .listSessions()
      .then((d) => {
        setDevices(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [backend]);
  useFocusEffect(load);

  const signOutOne = async (d: DeviceSession) => {
    setBusy(true);
    try {
      await backend.auth.revokeSession(d.id);
      setRemoved(d.label);
      setConfirming(null);
      load();
    } catch {
      setConfirming(null);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const signOutAll = async () => {
    setBusy(true);
    try {
      await backend.auth.revokeAllSessions(); // → 0a, this device included
    } catch {
      setConfirming(null);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const current = devices?.find((d) => d.isCurrent);
  const others = devices?.filter((d) => !d.isCurrent) ?? [];
  const testID = failed
    ? 'screen-S-4g'
    : removed
      ? 'screen-S-4d'
      : devices && others.length === 0
        ? 'screen-S-4f'
        : 'screen-S-4a';

  return (
    <AuthScreen
      testID={testID}
      back={{ onPress: () => router.back() }}
      title="Signed-in devices"
      lead="If you don't recognise a device, sign it out and change your password."
      footer={
        <>
          <SecondaryButton label="Sign out everywhere" onPress={() => setConfirming('all')} />
          <Lead
            before={`Includes this ${current?.label ?? 'device'}. You'll need to sign in again.`}
          />
        </>
      }
    >
      {failed ? (
        <AuthAlert
          title="Couldn't sign out"
          body="Nothing has changed. Check your connection and try again."
        />
      ) : null}
      {removed ? (
        <AuthAlert
          title={`Signed out of ${removed}`}
          body="That device will ask for your password next time it's opened."
          testID="alert-removed"
        />
      ) : null}
      {!devices ? (
        <ActivityIndicator color={colors.fill} accessibilityLabel="Loading devices" />
      ) : (
        <ListGroup>
          {devices.map((d, i) => (
            <ListRow
              key={d.id}
              first={i === 0}
              label={d.label}
              subtitle={[d.coarseLocation, d.isCurrent ? 'active now' : ago(d.lastActiveAt)]
                .filter(Boolean)
                .join(' · ')}
              pill={d.isCurrent ? 'This device' : undefined}
              action={
                d.isCurrent ? undefined : (
                  <SecondaryButton
                    label="Sign out"
                    accessibilityLabel={`Sign out of ${d.label}`}
                    style={styles.rowButton}
                    onPress={() => setConfirming(d)}
                  />
                )
              }
            />
          ))}
        </ListGroup>
      )}
      {devices && others.length === 0 ? (
        <Lead before="You're only signed in on this device." />
      ) : null}

      <Modal
        visible={confirming !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirming(null)}
      >
        <View style={styles.overlay}>
          <View
            style={styles.sheet}
            accessibilityViewIsModal
            testID={confirming === 'all' ? 'sheet-S-4e' : 'sheet-S-4b'}
          >
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {confirming === 'all'
                ? 'Sign out everywhere?'
                : `Sign out of ${confirming?.label ?? ''}?`}
            </Text>
            <Text style={styles.sheetBody}>
              {confirming === 'all'
                ? "You'll be signed out on every device, including this one. You'll need to sign in again."
                : "Life OS on that device will ask for your password next time it's opened."}
            </Text>
            <PrimaryButton
              label={
                busy ? 'Signing out…' : confirming === 'all' ? 'Sign out everywhere' : 'Sign out'
              }
              busy={busy}
              onPress={() =>
                void (confirming === 'all' ? signOutAll() : confirming && signOutOne(confirming))
              }
            />
            <SecondaryButton label="Cancel" onPress={() => setConfirming(null)} />
          </View>
        </View>
      </Modal>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  rowButton: { minHeight: 44, paddingHorizontal: space.md },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
    padding: space.sm,
  },
  sheet: { backgroundColor: colors.background, borderRadius: 28, padding: space.xl, gap: space.md },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  sheetBody: { ...type.callout, color: colors.textSecondary, lineHeight: 20 },
});
