// Supabase Edge Function: food-lookup
//
// Given a barcode, return the cached global food or fetch it from Open Food Facts,
// map nutriments per 100 g, cache it in public.foods (user_id NULL) and return it.
//
// Callers must be signed in (verify_jwt = true in supabase/config.toml). The cache is
// written with the service role key, which only exists in the function's environment.
import { createClient } from '@supabase/supabase-js';
import { handleRequest, type FoodLookupDeps } from './handler.ts';
import type { FoodRow } from './mapping.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const deps: FoodLookupDeps = {
  async findCached(barcode) {
    const { data, error } = await admin
      .from('foods')
      .select('*')
      .eq('barcode', barcode)
      .is('user_id', null)
      .maybeSingle();
    if (error) throw error;
    return data as FoodRow | null;
  },
  async saveToCache(row) {
    // Partial unique index foods_global_barcode_key covers (barcode) WHERE user_id IS NULL.
    const existing = await deps.findCached(row.barcode ?? '');
    const query = existing?.id
      ? admin.from('foods').update(row).eq('id', existing.id)
      : admin.from('foods').insert(row);
    const { data, error } = await query.select('*').single();
    if (error?.code === '23505') {
      // Another request cached the same barcode first; use that row.
      const winner = await deps.findCached(row.barcode ?? '');
      if (winner) return winner;
    }
    if (error) throw error;
    return data as FoodRow;
  },
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
};

Deno.serve(async (req) => {
  try {
    return await handleRequest(req, deps);
  } catch (err) {
    console.error('food-lookup failed', err);
    return new Response(JSON.stringify({ error: 'internal', message: 'Lookup failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
