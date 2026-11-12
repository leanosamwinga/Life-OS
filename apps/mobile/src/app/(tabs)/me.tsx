import { useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import {
  DEFAULT_NUDGE_SETTINGS,
  formatTimeUK,
  OPEN_FOOD_FACTS_CREDIT,
  PRIVACY_POLICY_URL,
  TERMS_URL,
  type NudgeSettings,
} from '@life-os/core';
import { Avatar, Card, Row, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { FormMessage } from '@/components/forms';
import { useAppleHealth } from '@/features/health/AppleHealth';
import { ordinal } from '@/features/nudges/labels';
import type { NudgeKey } from '@/lib/backend/settings';
import { useSession } from '@/lib/session';
import { colors, space, type } from '@/theme';

/** Ask before withdrawing consent; web has no native alert with buttons. */
function confirmWithdraw(): Promise<boolean> {
  const message =
    'Life OS will stop processing your meals, water, supplements, training and Apple Health data, and stop reading Apple Health. Your other data and the rest of the app keep working.';
  if (Platform.OS === 'web') {
    const c = (globalThis as { confirm?: (m: string) => boolean }).confirm;
    return Promise.resolve(c ? c(message) : true);
  }
  return new Promise((resolve) =>
    Alert.alert('Stop using your health data?', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Withdraw', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function MeScreen() {
  const session = useSession();
  const apple = useAppleHealth();
  const connected = session.status === 'signedIn' && session.settings !== null;

  // Not connected: local state only, so the sample app still demonstrates the toggles.
  const [localNudges, setLocalNudges] = useState<NudgeSettings>(
    () => JSON.parse(JSON.stringify(DEFAULT_NUDGE_SETTINGS)) as NudgeSettings,
  );
  const [localConsent, setLocalConsent] = useState(false);
  const [localLock, setLocalLock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nudges = connected ? session.settings!.nudges : localNudges;
  const healthConsent = connected ? session.healthConsent : localConsent;
  const appLock = connected ? session.settings!.appLockEnabled : localLock;

  const save = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that change.');
    }
  };

  const toggle = (key: NudgeKey) => (enabled: boolean) =>
    connected
      ? void save(() => session.updateSettings({ nudges: { [key]: enabled } }))
      : setLocalNudges((n) => ({ ...n, [key]: { ...n[key], enabled } }));

  const setHealthConsent = async (granted: boolean) => {
    if (!connected) return setLocalConsent(granted);
    if (!granted && !(await confirmWithdraw())) return;
    await save(() => session.setHealthConsent(granted));
  };

  const setAppLock = (enabled: boolean) =>
    connected
      ? void save(() => session.updateSettings({ appLockEnabled: enabled }))
      : setLocalLock(enabled);

  const mb = nudges.morningBriefing;
  const ec = nudges.eveningCheckIn;
  const si = nudges.monthlyStatementImport;
  const qh = nudges.quietHours;

  return (
    <Screen
      testID="screen-me"
      title="You"
      subtitle="Settings, nudges and connected apps"
      accessory={<Avatar size={60} label="Profile photo" />}
    >
      {error ? <FormMessage>{error}</FormMessage> : null}
      {session.status === 'signedIn' ? (
        <>
          <SectionTitle title="Account" />
          <Card>
            <Row
              label={session.displayName ?? 'Add your first name'}
              subtitle={session.user?.email ?? undefined}
              muted={!session.displayName}
            />
            <Row
              label="Security"
              subtitle="Sign-in method, password and devices"
              chevron
              onPress={() => router.push('/security')}
            />
            <Row
              label="Sign out"
              onPress={() => void save(() => session.backend!.auth.signOut())}
              accessibilityHint="Signs you out on this device"
              last
            />
          </Card>
        </>
      ) : null}

      <SectionTitle title="Nudges" caption="Quiet by default. Nothing else will ping you." />
      <Card>
        <ToggleRow
          label="Morning briefing"
          subtitle={`${mb.weekdayTime} · weekdays, ${mb.weekendTime} weekends`}
          value={mb.enabled}
          onValueChange={toggle('morningBriefing')}
        />
        <ToggleRow
          label="Evening check-in"
          subtitle={`${ec.time} · skipped if already closed`}
          value={ec.enabled}
          onValueChange={toggle('eveningCheckIn')}
        />
        <ToggleRow
          label="Event reminders"
          subtitle={
            nudges.eventReminders.enabled ? 'On' : 'Off · your calendar already reminds you'
          }
          value={nudges.eventReminders.enabled}
          onValueChange={toggle('eventReminders')}
        />
        <ToggleRow
          label="Urgent only"
          subtitle="Bill due tomorrow"
          value={nudges.urgentBillAlerts.enabled}
          onValueChange={toggle('urgentBillAlerts')}
        />
        <ToggleRow
          label="Monthly statement import"
          subtitle={`${ordinal(si.dayOfMonth)} of the month · ${si.time}`}
          value={si.enabled}
          onValueChange={toggle('monthlyStatementImport')}
          last
        />
      </Card>
      <Text style={styles.footnote}>
        Quiet hours {qh.start} – {qh.end} · urgent alerts wait until morning
      </Text>

      <SectionTitle title="Connected" />
      <Card>
        {connected ? (
          <Row
            label="Apple Health"
            subtitle={appleHealthSubtitle(apple, session.healthConsent)}
            chevron={apple.access !== 'elsewhere'}
            onPress={
              apple.access === 'elsewhere'
                ? undefined
                : () =>
                    void save(() =>
                      apple.access === 'off' ? apple.connect() : Linking.openSettings(),
                    )
            }
            accessibilityHint={
              apple.access === 'off'
                ? 'Asks to read steps, sleep and weight'
                : apple.access === 'connected'
                  ? 'Opens Settings'
                  : undefined
            }
          />
        ) : (
          <Row label="Apple Health" detail="Steps, sleep, weight" muted />
        )}
        <Row label="Strava" detail="Liftoff workouts" pill="Later" />
        <Row label="Apple & Google Calendar" pill="Later" />
        <Row label="Notion" detail="Church planner" pill="Later" />
        <Row label="Starling · NatWest · Amex" detail="Monthly CSV" pill="Later" />
        <Row label="Trading 212 · S&S ISA" detail="API · daily" pill="Later" />
        <Row label="T212 Cash ISA · HL LISA" detail="Monthly · manual" pill="Later" last />
      </Card>

      <SectionTitle title="Your setup" />
      <Card>
        <Row
          label="Health targets"
          subtitle="Weight, nutrition, water, sleep, steps, supplements, training"
          chevron
          muted={!connected}
          onPress={connected ? () => router.push('/health-targets') : undefined}
        />
        <Row label="Weekly rhythm" chevron muted />
        <Row label="Budgets & goals" chevron muted last />
      </Card>

      <SectionTitle title="Privacy & data" caption="Your data stays yours. No ads, never sold." />
      <Card>
        <ToggleRow
          label="Use my health data"
          subtitle="Explicit consent for nutrition, water, supplements and Apple Health. Withdraw any time."
          value={healthConsent}
          onValueChange={(v) => void setHealthConsent(v)}
        />
        <ToggleRow
          label="Face ID lock"
          subtitle="Ask for Face ID or passcode when opening Life OS. Saved now; the lock itself arrives in a later update."
          value={appLock}
          onValueChange={setAppLock}
        />
        {session.status === 'signedIn' ? (
          <>
            <Row
              label="Export my data (JSON)"
              subtitle="Everything in one file"
              onPress={() => void save(() => session.backend!.auth.exportData('json'))}
            />
            <Row
              label="Export my data (CSV)"
              subtitle="One spreadsheet per table, zipped"
              onPress={() => void save(() => session.backend!.auth.exportData('csv'))}
            />
            <Row
              label="Delete account"
              subtitle="30 days to change your mind, then erased"
              chevron
              onPress={() => router.push('/security/delete')}
              last
            />
          </>
        ) : (
          <>
            <Row label="Export my data" subtitle="CSV and JSON" muted />
            <Row
              label="Delete account"
              subtitle="30 days to change your mind, then erased"
              muted
              last
            />
          </>
        )}
      </Card>

      <SectionTitle title="Help & legal" />
      <Card>
        <Row
          label="Privacy Policy"
          pill="Draft"
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        />
        <Row
          label="Terms of Service"
          pill="Draft"
          onPress={() => void Linking.openURL(TERMS_URL)}
        />
        <Row label="Licences" subtitle={OPEN_FOOD_FACTS_CREDIT} last />
      </Card>

      <SectionTitle title="Coming later" />
      <Card variant="dashed">
        <Row label="Habits & goals · streaks" pill="Later" muted />
        <Row label="Journal, mood & energy history" pill="Later" muted />
        <Row label="Writing & hobbies" pill="Later" muted last />
      </Card>

      <Text style={styles.version}>Life OS {Constants.expoConfig?.version ?? ''}</Text>
    </Screen>
  );
}

/** Me → Connected → Apple Health: what Life OS can do with it on this device. */
function appleHealthSubtitle(apple: ReturnType<typeof useAppleHealth>, consent: boolean): string {
  if (apple.access === 'elsewhere') return 'Steps, sleep, weight · synced from your iPhone';
  if (!consent) return 'Steps, sleep, weight · needs “Use my health data” on';
  if (apple.access === 'off') return 'Steps, sleep, weight · off · tap to connect';
  return apple.lastSyncedAt
    ? `Steps, sleep, weight · synced ${formatTimeUK(apple.lastSyncedAt)}`
    : 'Steps, sleep, weight · on';
}

const styles = StyleSheet.create({
  footnote: {
    ...type.footnote,
    color: colors.textSecondary,
    marginTop: -space.sm,
    marginHorizontal: space.xs,
  },
  version: {
    ...type.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: space.xl,
  },
});
