import { useState } from 'react';
import { Text } from 'react-native';
import {
  FormMessage,
  FormScreen,
  Lead,
  PrimaryButton,
  CheckRow,
  formStyles,
} from '@/components/forms';
import { Card } from '@/components/ui';
import { nudgeSubtitles } from '@/features/nudges/labels';
import {
  goToNext,
  OnboardingHeader,
  useOnboardingSteps,
} from '@/features/onboarding/OnboardingHeader';
import { defaultUserSettings, type NudgeKey } from '@/lib/backend/settings';
import { requestNotificationPermission } from '@/lib/notifications';
import { useSession } from '@/lib/session';

const SHOWN: { key: NudgeKey; label: string }[] = [
  { key: 'morningBriefing', label: 'Morning briefing' },
  { key: 'eveningCheckIn', label: 'Evening check-in' },
  { key: 'urgentBillAlerts', label: 'Urgent bill alerts' },
  { key: 'monthlyStatementImport', label: 'Monthly statement import' },
];

/** 0f Quiet nudges. Saves the toggles and asks for notification permission (scheduling is phase 6). */
export default function NudgesStep() {
  const session = useSession();
  const steps = useOnboardingSteps();
  const nudges = session.settings?.nudges ?? defaultUserSettings().nudges;
  const [checked, setChecked] = useState<Record<NudgeKey, boolean>>(() => ({
    morningBriefing: nudges.morningBriefing.enabled,
    eveningCheckIn: nudges.eveningCheckIn.enabled,
    eventReminders: nudges.eventReminders.enabled,
    urgentBillAlerts: nudges.urgentBillAlerts.enabled,
    monthlyStatementImport: nudges.monthlyStatementImport.enabled,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subtitles = nudgeSubtitles(nudges);

  async function save(askPermission: boolean) {
    setError(null);
    setBusy(true);
    try {
      await session.updateSettings({
        nudges: checked,
        ...(askPermission ? { notificationsPromptedAt: new Date().toISOString() } : {}),
      });
      const anyOn = Object.values(checked).some(Boolean);
      if (askPermission && anyOn) await requestNotificationPermission();
      goToNext(steps, 'nudges');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your nudges. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const q = nudges.quietHours;
  return (
    <FormScreen
      testID="screen-onboarding-nudges"
      header={<OnboardingHeader step="nudges" steps={steps} onSkip={() => void save(false)} />}
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton label="Allow notifications" busy={busy} onPress={() => void save(true)} />
        </>
      }
    >
      <Lead
        title="Quiet nudges"
        body="Only these. Nothing else will ping you, and each can be changed in Me."
      />
      <Card>
        {SHOWN.map((n, i) => (
          <CheckRow
            key={n.key}
            label={n.label}
            subtitle={subtitles[n.key as keyof typeof subtitles]}
            checked={checked[n.key]}
            onToggle={(v) => setChecked((c) => ({ ...c, [n.key]: v }))}
            last={i === SHOWN.length - 1}
          />
        ))}
      </Card>
      <Text style={formStyles.body}>
        Quiet hours {q.start}–{q.end}. Next, your device asks to allow notifications.
      </Text>
    </FormScreen>
  );
}
