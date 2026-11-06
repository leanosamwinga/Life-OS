import type { FoodRecord } from '@life-os/core';
import {
  type FoodRow,
  type OffProductResponse,
  fromFoodRow,
  isValidBarcode,
  mapOffProduct,
  toFoodRow,
} from './mapping.ts';

export const OFF_USER_AGENT = 'LifeOS/0.1 (leanosamwinga@gmail.com)';
export const OFF_CREDIT = 'Food data from Open Food Facts (ODbL)';
/** Cached products older than this are refreshed from Open Food Facts when possible. */
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export interface FoodLookupDeps {
  /** Read the global cache row for a barcode (user_id IS NULL), or null. */
  findCached(barcode: string): Promise<FoodRow | null>;
  /** Upsert a global cache row and return the stored row. */
  saveToCache(row: FoodRow): Promise<FoodRow>;
  fetch: typeof fetch;
  now(): Date;
}

export type FoodLookupResult =
  | { status: 200; body: { food: FoodRecord; from: 'cache' | 'open_food_facts'; credit: string } }
  | { status: 400 | 404 | 405 | 502; body: { error: string; message: string } };

type FetchOutcome =
  | { kind: 'found'; record: FoodRecord }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export async function fetchFromOff(
  barcode: string,
  fetchImpl: typeof fetch,
): Promise<FetchOutcome> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
    });
  } catch (err) {
    return { kind: 'error', message: `Open Food Facts unreachable: ${String(err)}` };
  }
  // OFF answers unknown products with 404 and `status: 0`.
  if (res.status === 404) return { kind: 'not_found' };
  if (!res.ok) return { kind: 'error', message: `Open Food Facts returned ${res.status}` };

  let json: OffProductResponse;
  try {
    json = (await res.json()) as OffProductResponse;
  } catch {
    return { kind: 'error', message: 'Open Food Facts returned invalid JSON' };
  }
  const record = mapOffProduct(barcode, json);
  return record ? { kind: 'found', record } : { kind: 'not_found' };
}

function isStale(row: FoodRow, now: Date): boolean {
  if (!row.off_fetched_at) return true;
  return now.getTime() - Date.parse(row.off_fetched_at) > CACHE_MAX_AGE_MS;
}

function stripFetchedAt(record: FoodRecord & { fetchedAt?: string | null }): FoodRecord {
  const { fetchedAt: _fetchedAt, ...rest } = record;
  return rest;
}

/** Core lookup: cached food if fresh, otherwise fetch from Open Food Facts and cache it. */
export async function lookupFood(
  barcode: unknown,
  deps: FoodLookupDeps,
): Promise<FoodLookupResult> {
  if (!isValidBarcode(barcode)) {
    return {
      status: 400,
      body: { error: 'invalid_barcode', message: 'Barcode must be 6–14 digits.' },
    };
  }

  const cached = await deps.findCached(barcode);
  if (cached && !isStale(cached, deps.now())) {
    return {
      status: 200,
      body: { food: stripFetchedAt(fromFoodRow(cached)), from: 'cache', credit: OFF_CREDIT },
    };
  }

  const outcome = await fetchFromOff(barcode, deps.fetch);
  if (outcome.kind === 'found') {
    const stored = await deps.saveToCache(toFoodRow(outcome.record, deps.now()));
    return {
      status: 200,
      body: {
        food: stripFetchedAt(fromFoodRow(stored)),
        from: 'open_food_facts',
        credit: OFF_CREDIT,
      },
    };
  }

  // A stale cache row is better than nothing if Open Food Facts is down or dropped the product.
  if (cached) {
    return {
      status: 200,
      body: { food: stripFetchedAt(fromFoodRow(cached)), from: 'cache', credit: OFF_CREDIT },
    };
  }

  if (outcome.kind === 'not_found') {
    return {
      status: 404,
      body: {
        error: 'not_found',
        message: 'No product with this barcode on Open Food Facts. You can add it manually.',
      },
    };
  }
  return { status: 502, body: { error: 'upstream_unavailable', message: outcome.message } };
}

/** HTTP wrapper: GET ?barcode=… or POST { "barcode": "…" }. */
export async function handleRequest(req: Request, deps: FoodLookupDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  let barcode: unknown;
  if (req.method === 'GET') {
    barcode = new URL(req.url).searchParams.get('barcode');
  } else if (req.method === 'POST') {
    try {
      barcode = ((await req.json()) as { barcode?: unknown }).barcode;
    } catch {
      barcode = undefined;
    }
  } else {
    return json(405, { error: 'method_not_allowed', message: 'Use GET or POST.' });
  }

  const result = await lookupFood(barcode, deps);
  return json(result.status, result.body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
