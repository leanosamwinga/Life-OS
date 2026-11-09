import { router } from 'expo-router';

/** Back to Today: pop when we came from it, else replace (a deep link). */
export function backToToday() {
  if (router.canDismiss()) router.dismissTo('/');
  else router.replace('/');
}
