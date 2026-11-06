import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Constants from 'expo-constants';
import { DEFAULT_NUDGE_SETTINGS, OPEN_FOOD_FACTS_CREDIT, type NudgeSettings } from '@life-os/core';
import { Avatar, Card, Row, Screen, SectionTitle, ToggleRow } from '@/components/ui';
import { colors, space, type } from '@/theme';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export default function MeScreen() {
  // Local state until settings sync arrives (phase 6). Defaults are quiet.
  const [nudges, setNudges] = useState<NudgeSettings>(
    () => JSON.parse(JSON.stringify(DEFAULT_NUDGE_SETTINGS)) as NudgeSettings,
  );
  const [healthConsent, setHealthConsent] = useState(false);
  const [appLock, setAppLock] = useState(false);

  const toggle = (key: Exclude<keyof NudgeSettings, 'quietHours'>) => (enabled: boolean) =>
    setNudges((n) => ({ ...n, [key]: { ...n[key], enabled } }));

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
        <Row label="Apple Health" detail="Steps, sleep, weight" pill="Later" />
        <Row label="Strava" detail="Liftoff workouts" pill="Later" />
        <Row label="Apple & Google Calendar" pill="Later" />
        <Row label="Notion" detail="Church planner" pill="Later" />
        <Row label="Starling · NatWest · Amex" detail="Monthly CSV" pill="Later" />
        <Row label="Trading 212 · S&S ISA" detail="API · daily" pill="Later" />
        <Row label="T212 Cash ISA · HL LISA" detail="Monthly · manual" pill="Later" last />
      </Card>

      <SectionTitle title="Your setup" />
      <Card>
        <Row label="Meal plan & macro targets" chevron muted />
        <Row label="Weekly rhythm" chevron muted />
        <Row label="Budgets & goals" chevron muted last />
      </Card>

      <SectionTitle title="Privacy & data" caption="Your data stays yours. No ads, never sold." />
      <Card>
        <ToggleRow
          label="Use my health data"
          subtitle="Explicit consent for nutrition, water, supplements and Apple Health. Withdraw any time."
          value={healthConsent}
          onValueChange={setHealthConsent}
        />
        <ToggleRow
          label="Face ID lock"
          subtitle="Ask for Face ID or passcode when opening Life OS"
          value={appLock}
          onValueChange={setAppLock}
        />
        <Row label="Export my data" subtitle="CSV and JSON" pill="Later" />
        <Row label="Delete account" subtitle="Erases everything within 30 days" pill="Later" last />
      </Card>

      <SectionTitle title="Help & legal" />
      <Card>
        <Row label="Privacy Policy" pill="Draft" />
        <Row label="Terms of Service" pill="Draft" />
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
