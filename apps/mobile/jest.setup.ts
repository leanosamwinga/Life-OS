jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Tests behave like a development build: Google's browser flow is available (not Expo Go).
jest.mock('@/lib/auth/expoGo', () => ({ googleNeedsDevBuild: () => false }));
