import { router } from 'expo-router';

/** Close the whole Log meal modal and return to the tab underneath. */
export function closeLogMeal() {
  if (router.canDismiss()) router.dismissAll();
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
