import { Stack } from 'expo-router/stack';
import { LogMealProvider } from '@/features/log-meal/LogMealContext';

/** Log meal flow (wireframes 7a–7e). One draft meal is shared across these screens. */
export default function LogMealLayout() {
  return (
    <LogMealProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </LogMealProvider>
  );
}
