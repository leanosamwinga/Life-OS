// In-memory Keychain for the e2e test. `keychain` is exported so a test can inspect or wipe it.
export const keychain = new Map<string, string>();
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';
export type SecureStoreOptions = Record<string, unknown>;
export async function getItemAsync(key: string) {
  return keychain.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string) {
  keychain.set(key, value);
}
export async function deleteItemAsync(key: string) {
  keychain.delete(key);
}
