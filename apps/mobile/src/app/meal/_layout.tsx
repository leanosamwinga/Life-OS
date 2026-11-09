import { Stack } from 'expo-router/stack';
import { LoggedMealProvider } from '@/features/logged-meal/LoggedMealContext';

/** A logged meal (7j), its edit screen (7k) and delete sheet (7l). */
export default function MealLayout() {
  return (
    <LoggedMealProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="[id]" />
        <Stack.Screen name="edit/[id]" options={{ presentation: 'modal' }} />
      </Stack>
    </LoggedMealProvider>
  );
}
