import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import type { createHealthKitReader as CreateReader } from './healthkit';
import type { HealthReader } from './reader';

let cached: HealthReader | null | undefined;

/**
 * Apple Health on this device: only on an iPhone running a development (or release) build.
 * Web and Android have no HealthKit and show what the iPhone has synced; Expo Go doesn't include
 * the native module, so it gets null too (and the same synced view). jest mocks this module.
 */
export function getHealthReader(): HealthReader | null {
  if (cached !== undefined) return cached;
  cached = null;
  // Expo Go has no HealthKit (Nitro) module. Requiring it there logs a red "Failed to get
  // NitroModules" error even though the throw is caught below, so don't load it at all.
  if (Platform.OS !== 'ios' || isRunningInExpoGo()) return cached;
  try {
    // Loaded lazily so web, Android and Expo Go never touch the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHealthKitReader } = require('./healthkit') as {
      createHealthKitReader: typeof CreateReader;
    };
    cached = createHealthKitReader();
  } catch {
    cached = null;
  }
  return cached;
}
