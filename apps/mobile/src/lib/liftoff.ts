import { Linking } from 'react-native';

/**
 * "Log workout in Liftoff ↗": open Liftoff (sets, reps and history live there), or its App Store
 * page when it isn't installed. The URL scheme is Liftoff's own and listed in app.json
 * (LSApplicationQueriesSchemes); see docs/SPEC-QUESTIONS.md.
 */
export const LIFTOFF_URL = 'liftoff://';
export const LIFTOFF_APP_STORE_URL = 'https://apps.apple.com/gb/app/liftoff/id6448081563';

export async function openLiftoff(): Promise<'app' | 'store'> {
  try {
    if (await Linking.canOpenURL(LIFTOFF_URL)) {
      await Linking.openURL(LIFTOFF_URL);
      return 'app';
    }
  } catch {
    // Fall through to the App Store.
  }
  await Linking.openURL(LIFTOFF_APP_STORE_URL);
  return 'store';
}
