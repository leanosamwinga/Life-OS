import { Stack } from 'expo-router/stack';

// An edit screen opened directly (a deep link, a test) still has the menu beneath it.
export const unstable_settings = { initialRouteName: 'index' };

/** Me → Health targets (6B) and its edit screens. */
export default function HealthTargetsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
