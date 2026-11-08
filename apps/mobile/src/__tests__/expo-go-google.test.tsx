// D: in Expo Go, Google's iPhone browser flow can't return to the app (its URL scheme only
// exists in a development/store build), so the Google button explains that instead of ending
// on 0b-8g. Apple is unaffected.
import path from 'node:path';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { createMemoryBackend, type MemoryBackend } from '@/test/memoryBackend';

const APP_DIR = path.resolve(__dirname, '../app');
let mockBackend: MemoryBackend;
let mockExpoGo = true;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));
jest.mock('@/lib/notifications', () => ({ requestNotificationPermission: async () => 'granted' }));
jest.mock('@/lib/auth/expoGo', () => ({ googleNeedsDevBuild: () => mockExpoGo }));

async function openCreateAccount() {
  await renderRouter(APP_DIR, { initialUrl: '/sign-up' });
  await screen.findByTestId('screen-0b-1', undefined, { timeout: 10_000 });
}

describe('Google sign-in in Expo Go', () => {
  it('shows the development-build note and never calls Google or 0b-8g', async () => {
    mockExpoGo = true;
    mockBackend = createMemoryBackend({}, { provider: { email: 'g@example.test', sub: 'g1' } });
    await openCreateAccount();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));
    });
    expect(await screen.findByText('Google sign-in needs a development build')).toBeTruthy();
    expect(screen.queryByTestId('screen-0b-8g')).toBeNull();
    expect(mockBackend.auth.auth.calls.filter((c) => c.includes('GOOGLE'))).toEqual([]);
  });

  it('in a development build Google goes ahead as usual', async () => {
    mockExpoGo = false;
    mockBackend = createMemoryBackend({}, { provider: { email: 'g@example.test', sub: 'g1' } });
    await openCreateAccount();
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(await screen.findByTestId('screen-onboarding-consent', undefined, { timeout: 10_000 }));
    expect(screen.queryByText('Google sign-in needs a development build')).toBeNull();
  });
});
