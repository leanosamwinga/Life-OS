import type { Sql } from 'postgres';
import type { AppAttestKey, AppAttestKeyStore } from './app-attest.ts';

/** App Attest public keys registered per install (public.auth_app_attest_keys). */
export class SqlAppAttestKeys implements AppAttestKeyStore {
  constructor(private readonly sql: Sql) {}
  async get(keyId: string): Promise<AppAttestKey | null> {
    const [row] = await this.sql<{ key_id: string; public_key_spki: string; counter: number }[]>`
      select key_id, public_key_spki, counter from public.auth_app_attest_keys where key_id = ${keyId}`;
    return row
      ? { keyId: row.key_id, publicKeySpki: row.public_key_spki, counter: row.counter }
      : null;
  }
  async updateCounter(keyId: string, counter: number): Promise<void> {
    await this
      .sql`update public.auth_app_attest_keys set counter = ${counter} where key_id = ${keyId} and counter < ${counter}`;
  }
}
