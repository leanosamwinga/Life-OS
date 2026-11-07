import { router } from 'expo-router';

/**
 * Close the whole Log meal modal and return to the tab underneath, from any screen inside it.
 * One action: pop back to Today (anchored under the modal), or replace when opened by a deep link.
 */
export function closeLogMeal() {
  if (router.canDismiss()) router.dismissTo('/');
  else router.replace('/');
}
