import { connection } from '../supabase';
import { supabaseBackend } from './supabase';
import type { Backend } from './types';

let cached: Backend | null | undefined;

/** The app's backend, or `null` when Supabase env vars are missing ("Not connected"). */
export function getBackend(): Backend | null {
  if (cached === undefined)
    cached = connection ? supabaseBackend(connection.client, connection.auth) : null;
  return cached;
}
