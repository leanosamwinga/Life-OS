jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Tests behave like a development build: Google's browser flow is available (not Expo Go).
jest.mock('@/lib/auth/expoGo', () => ({ googleNeedsDevBuild: () => false }));

// No Apple Health unless a test sets one (src/test/fakeHealth.ts); local notifications are a fake
// list tests can inspect.
jest.mock('@/lib/health/current', () => require('@/test/fakeHealth'));
jest.mock('expo-notifications', () => require('@/test/fakeHealth').notificationsMock);
