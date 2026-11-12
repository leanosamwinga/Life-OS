// Data export (CSV + JSON) from Me → Privacy and S-5a (decision 3, UK GDPR access/portability).
// JSON: one document with every table. CSV: a ZIP with one CSV per table (stored, no compression).
import type { Sql } from 'postgres';

/** User-owned tables and the column that holds the owner. Auth internals stay out. */
const TABLES: { name: string; owner: string }[] = [
  { name: 'profiles', owner: 'id' },
  { name: 'user_settings', owner: 'user_id' },
  { name: 'consents', owner: 'user_id' },
  { name: 'foods', owner: 'user_id' },
  { name: 'food_portions_last', owner: 'user_id' },
  { name: 'saved_meals', owner: 'user_id' },
  { name: 'saved_meal_components', owner: 'user_id' },
  { name: 'batch_ingredients', owner: 'user_id' },
  { name: 'meal_logs', owner: 'user_id' },
  { name: 'meal_log_items', owner: 'user_id' },
  { name: 'water_logs', owner: 'user_id' },
  { name: 'supplements', owner: 'user_id' },
  { name: 'supplement_logs', owner: 'user_id' },
  { name: 'training_days', owner: 'user_id' },
  { name: 'health_daily', owner: 'user_id' },
];

export async function collectExport(sql: Sql, userId: string) {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    const exists = await sql`select to_regclass(${'public.' + t.name}) is not null as ok`;
    if (!exists[0]?.ok) continue;
    out[t.name] = (await sql.unsafe(
      `select * from public.${t.name} where ${t.owner} = $1 order by 1`,
      [userId],
    )) as Record<string, unknown>[];
  }
  const [account] = await sql`
    select email, method, status, created_at, confirmed_at, password_changed_at from public.auth_accounts where user_id = ${userId}`;
  out.account = account ? [account as Record<string, unknown>] : [];
  out.known_devices = (await sql`
    select platform, label, coarse_location, first_seen_at, last_seen_at from public.auth_known_devices where user_id = ${userId}`) as unknown as Record<
    string,
    unknown
  >[];
  return out;
}

export async function exportJson(sql: Sql, userId: string) {
  return {
    exported_at: new Date().toISOString(),
    format: 'life-os-export-v1',
    tables: await collectExport(sql, userId),
  };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s =
    v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  return (
    [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') +
    '\r\n'
  );
}

// ---- minimal ZIP writer (stored entries) --------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export async function exportZip(sql: Sql, userId: string): Promise<Uint8Array> {
  const tables = await collectExport(sql, userId);
  const enc = new TextEncoder();
  return zip(
    Object.entries(tables).map(([name, rows]) => ({
      name: `${name}.csv`,
      data: enc.encode(toCsv(rows)),
    })),
  );
}
