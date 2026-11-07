import { Stack } from 'expo-router/stack';

/** Row 9 · Me → Security (S-1 … S-5). Every route needs you signed in. */
export default function SecurityLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
