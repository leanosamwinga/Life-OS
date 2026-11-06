import { Platform } from 'react-native';

export type NotificationPermission = 'granted' | 'denied' | 'unavailable';

/**
 * Ask the OS (or the browser, on web) for permission to show notifications.
 * Scheduling the nudges themselves arrives in phase 6; this only asks.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    if (Platform.OS === 'web') {
      const N = (globalThis as { Notification?: { requestPermission(): Promise<string> } })
        .Notification;
      if (!N) return 'unavailable';
      return (await N.requestPermission()) === 'granted' ? 'granted' : 'denied';
    }
    const Notifications = await import('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    return result.granted ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}
