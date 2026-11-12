import { Platform } from 'react-native';
import type * as Notifications from 'expo-notifications';
import { supplementLabel, type Supplement } from '@/lib/backend/health';

const PREFIX = 'supplement-';

/** Only phones schedule local notifications; the web has no scheduled notifications. */
const supported = () => Platform.OS === 'ios' || Platform.OS === 'android';

/** Every supplement reminder this device has scheduled. */
async function cancelOurs(N: typeof Notifications) {
  const scheduled = await N.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((r) => r.identifier.startsWith(PREFIX))
      .map((r) => N.cancelScheduledNotificationAsync(r.identifier)),
  );
}

/**
 * Make this device's supplement reminders match the list: one daily local notification per
 * supplement with a reminder time (24-hour, London wall clock). Called whenever the list changes.
 */
export async function rescheduleSupplementReminders(list: readonly Supplement[]): Promise<void> {
  if (!supported()) return;
  const N = await import('expo-notifications');
  await cancelOurs(N);
  for (const s of list) {
    if (!s.reminderTime) continue;
    const [hour, minute] = s.reminderTime.split(':').map(Number) as [number, number];
    await N.scheduleNotificationAsync({
      identifier: `${PREFIX}${s.id}`,
      content: { title: supplementLabel(s), body: 'Time for your supplement. Tap to open Health.' },
      trigger: { type: N.SchedulableTriggerInputTypes.DAILY, hour, minute },
    });
  }
}

/** Cancel every supplement reminder (consent withdrawn, signed out). */
export async function cancelSupplementReminders(): Promise<void> {
  if (!supported()) return;
  const N = await import('expo-notifications');
  await cancelOurs(N);
}
