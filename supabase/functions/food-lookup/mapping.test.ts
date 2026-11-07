import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { toFood } from '@life-os/core';
import {
  fromFoodRow,
  isValidBarcode,
  mapOffProduct,
  toFoodRow,
  type FoodRow,
  type OffProductResponse,
} from './mapping.ts';
import {
  CACHE_MAX_AGE_MS,
  OFF_USER_AGENT,
  handleRequest,
  lookupFood,
  type FoodLookupDeps,
} from './handler.ts';

const fixture = (name: string): OffProductResponse =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as OffProductResponse;

describe('mapOffProduct', () => {
  it('maps a complete product per 100 g', () => {
    expect(mapOffProduct('0000000000017', fixture('off-product-full'))).toEqual({
      userId: null,
      source: 'open_food_facts',
      barcode: '0000000000017',
      name: 'Greek style yoghurt 0% fat',
      brand: 'Sample Dairy',
      kcalPer100g: 57,
      proteinPer100g: 10,
      carbsPer100g: 3.6,
      fatPer100g: 0.2,
      fibrePer100g: 0,
      sugarPer100g: 3.6,
      saltPer100g: 0.1,
      packGrams: 500,
      servingGrams: 150,
    });
  });

  it('uses nulls for missing or bad fields and only converts units it is given', () => {
    const record = mapOffProduct('0000000000024', fixture('off-product-partial'));
    expect(record).toEqual({
      userId: null,
      source: 'open_food_facts',
      barcode: '0000000000024',
      name: 'Sweet chilli sauce',
      brand: null, // empty string
      kcalPer100g: 119.98, // 502 kJ ÷ 4.184
      proteinPer100g: null, // "n/a"
      carbsPer100g: 28,
      fatPer100g: null, // negative → implausible
      fibrePer100g: null, // absent
      sugarPer100g: null, // absent
      saltPer100g: 1.9, // sodium 0.76 × 2.5
      packGrams: null, // 250 ml is not grams — no guess
      servingGrams: null, // absent
    });
  });

  it('a partial product cannot be logged until completed', () => {
    const record = mapOffProduct('0000000000024', fixture('off-product-partial'));
    expect(record && toFood({ ...record, id: 'x' })).toBeNull();
  });

  it('returns null for "product not found"', () => {
    expect(mapOffProduct('0000000000000', fixture('off-not-found'))).toBeNull();
  });

  it('rejects implausible values', () => {
    const record = mapOffProduct('12345678', {
      status: 1,
      product: { nutriments: { 'energy-kcal_100g': 5000, proteins_100g: 150, fat_100g: 'NaN' } },
    });
    expect(record).toMatchObject({
      name: null,
      kcalPer100g: null,
      proteinPer100g: null,
      fatPer100g: null,
    });
  });
});

describe('pack and serving sizes', () => {
  const withQty = (product: Record<string, unknown>): OffProductResponse => ({
    status: 1,
    product: { product_name: 'Sample pouch', nutriments: {}, ...product },
  });
  it('keeps grams, drops other units and implausible sizes', () => {
    const r = (p: Record<string, unknown>) => mapOffProduct('0000000000031', withQty(p));
    expect(r({ product_quantity: 120, serving_quantity: '60' })).toMatchObject({
      packGrams: 120,
      servingGrams: 60,
    });
    expect(r({ product_quantity: '1', product_quantity_unit: 'kg' })?.packGrams).toBeNull();
    expect(r({ product_quantity: 0, serving_quantity: -5 })).toMatchObject({
      packGrams: null,
      servingGrams: null,
    });
    expect(r({ serving_quantity: '30.25', serving_quantity_unit: 'G' })?.servingGrams).toBe(30.3);
  });

  it('round-trips pack and serving through the row', () => {
    const rec = mapOffProduct('0000000000017', fixture('off-product-full'))!;
    const back = fromFoodRow({ ...toFoodRow(rec, new Date(0)), pack_g: '500.0' as never });
    expect([back.packGrams, back.servingGrams]).toEqual([500, 150]);
  });
});

describe('row mapping', () => {
  it('round-trips through the database row shape, parsing numeric strings', () => {
    const record = mapOffProduct('0000000000017', fixture('off-product-full'))!;
    const row = toFoodRow(record, new Date('2026-11-06T12:00:00Z'));
    expect(row.off_fetched_at).toBe('2026-11-06T12:00:00.000Z');
    const fromDb = { ...row, id: 'food-1', kcal_per_100g: '57.00' as unknown as number };
    expect(fromFoodRow(fromDb)).toMatchObject({
      id: 'food-1',
      kcalPer100g: 57,
      proteinPer100g: 10,
    });
  });
});

describe('isValidBarcode', () => {
  it('accepts 6–14 digits only', () => {
    expect(isValidBarcode('5000000000000')).toBe(true);
    expect(isValidBarcode('12345')).toBe(false);
    expect(isValidBarcode('abc12345')).toBe(false);
    expect(isValidBarcode(12345678)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lookupFood / handleRequest with fakes
// ---------------------------------------------------------------------------

function fakeDeps(opts: {
  cached?: FoodRow | null;
  offStatus?: number;
  offBody?: unknown;
  offThrows?: boolean;
}) {
  const saved: FoodRow[] = [];
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (opts.offThrows) throw new Error('network down');
    return new Response(JSON.stringify(opts.offBody ?? {}), { status: opts.offStatus ?? 200 });
  });
  const deps: FoodLookupDeps = {
    findCached: async () => opts.cached ?? null,
    saveToCache: async (row) => {
      saved.push(row);
      return { ...row, id: 'new-id' };
    },
    fetch: fetchMock as unknown as typeof fetch,
    now: () => new Date('2026-11-06T12:00:00Z'),
  };
  return { deps, saved, fetchMock };
}

const cachedRow = (fetchedAt: string): FoodRow => ({
  id: 'cached-id',
  user_id: null,
  source: 'open_food_facts',
  barcode: '0000000000017',
  name: 'Cached yoghurt',
  brand: null,
  kcal_per_100g: 57,
  protein_per_100g: 10,
  carbs_per_100g: 3.6,
  fat_per_100g: 0.2,
  fibre_per_100g: null,
  sugar_per_100g: null,
  salt_per_100g: null,
  off_fetched_at: fetchedAt,
});

describe('lookupFood', () => {
  it('returns a fresh cached food without calling Open Food Facts', async () => {
    const { deps, fetchMock } = fakeDeps({ cached: cachedRow('2026-11-01T00:00:00Z') });
    const result = await lookupFood('0000000000017', deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      from: 'cache',
      food: { id: 'cached-id', name: 'Cached yoghurt' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches, caches and returns an uncached product with a descriptive User-Agent', async () => {
    const { deps, saved, fetchMock } = fakeDeps({ offBody: fixture('off-product-full') });
    const result = await lookupFood('0000000000017', deps);
    expect(result).toMatchObject({
      status: 200,
      body: {
        from: 'open_food_facts',
        credit: 'Food data from Open Food Facts (ODbL)',
        food: { id: 'new-id', kcalPer100g: 57 },
      },
    });
    expect(saved).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://world.openfoodfacts.org/api/v2/product/0000000000017.json');
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe(OFF_USER_AGENT);
  });

  it('refreshes stale cache rows', async () => {
    const stale = new Date(Date.parse('2026-11-06T12:00:00Z') - CACHE_MAX_AGE_MS - 1).toISOString();
    const { deps, saved } = fakeDeps({
      cached: cachedRow(stale),
      offBody: fixture('off-product-full'),
    });
    const result = await lookupFood('0000000000017', deps);
    expect(result.body).toMatchObject({ from: 'open_food_facts' });
    expect(saved).toHaveLength(1);
  });

  it('falls back to a stale cache row when Open Food Facts is down', async () => {
    const { deps } = fakeDeps({ cached: cachedRow('2020-01-01T00:00:00Z'), offThrows: true });
    expect(await lookupFood('0000000000017', deps)).toMatchObject({
      status: 200,
      body: { from: 'cache' },
    });
  });

  it('404s gracefully when the product does not exist', async () => {
    const { deps, saved } = fakeDeps({ offStatus: 404, offBody: fixture('off-not-found') });
    expect(await lookupFood('0000000000000', deps)).toMatchObject({
      status: 404,
      body: { error: 'not_found' },
    });
    expect(saved).toHaveLength(0);
  });

  it('treats status 0 with HTTP 200 as not found too', async () => {
    const { deps } = fakeDeps({ offStatus: 200, offBody: fixture('off-not-found') });
    expect((await lookupFood('0000000000000', deps)).status).toBe(404);
  });

  it('502s when Open Food Facts errors and nothing is cached', async () => {
    const { deps } = fakeDeps({ offStatus: 503 });
    expect(await lookupFood('0000000000017', deps)).toMatchObject({
      status: 502,
      body: { error: 'upstream_unavailable' },
    });
  });

  it('400s on an invalid barcode without any I/O', async () => {
    const { deps, fetchMock } = fakeDeps({});
    expect((await lookupFood('not-a-barcode', deps)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handleRequest', () => {
  it('accepts POST { barcode } and GET ?barcode=', async () => {
    const { deps } = fakeDeps({ cached: cachedRow('2026-11-05T00:00:00Z') });
    const post = await handleRequest(
      new Request('http://localhost/food-lookup', {
        method: 'POST',
        body: JSON.stringify({ barcode: '0000000000017' }),
      }),
      deps,
    );
    expect(post.status).toBe(200);
    const get = await handleRequest(
      new Request('http://localhost/food-lookup?barcode=0000000000017'),
      deps,
    );
    expect(((await get.json()) as { from: string }).from).toBe('cache');
  });

  it('answers CORS preflight and rejects other methods', async () => {
    const { deps } = fakeDeps({});
    expect(
      (await handleRequest(new Request('http://localhost', { method: 'OPTIONS' }), deps)).status,
    ).toBe(200);
    expect(
      (await handleRequest(new Request('http://localhost', { method: 'DELETE' }), deps)).status,
    ).toBe(405);
  });

  it('400s on a malformed JSON body', async () => {
    const { deps } = fakeDeps({});
    const res = await handleRequest(
      new Request('http://localhost', { method: 'POST', body: '{nope' }),
      deps,
    );
    expect(res.status).toBe(400);
  });
});
