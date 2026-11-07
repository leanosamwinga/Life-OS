// App Attest (iPhone) — assertion verification. Filled in after the linking gate.
export interface AppAttestKey {
  keyId: string;
  publicKeySpki: string;
  counter: number;
}

export interface AppAttestKeyStore {
  get(keyId: string): Promise<AppAttestKey | null>;
  updateCounter(keyId: string, counter: number): Promise<void>;
}

export async function verifyAppAttestAssertion(_input: {
  assertionB64: string;
  keyId: string;
  clientData: string;
  appIds: string[];
  keys: AppAttestKeyStore;
}): Promise<boolean> {
  return false;
}
