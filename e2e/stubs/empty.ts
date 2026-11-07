// Stands in for Expo modules the e2e test never reaches (file export, provider sheets).
export class File {}
export const Paths = {};
export async function shareAsync() {}
export async function signInAsync() {
  throw new Error('not available in the e2e test');
}
export const AppleAuthenticationScope = {};
export async function openAuthSessionAsync() {
  return { type: 'cancel' };
}
export function maybeCompleteAuthSession() {}
export default {};
