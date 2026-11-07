// Structured auth logging (spec 10). Enforced in code, not by habit:
//   * only allow-listed field names are written;
//   * every string value is checked and dropped if it looks like a secret (JWT, long random
//     token, 6-digit code, email address);
//   * emails are logged only as an HMAC under a log-only key (emailHmac).
import { hmacHex } from './crypto.ts';

export const LOG_FIELDS = [
  'request_id',
  'account_id',
  'email_hmac',
  'device_id_hash',
  'ip_prefix',
  'platform',
  'app_version',
  'attestation_result',
  'outcome',
  'reason',
  'latency_ms',
  'provider',
  'method',
  'scope',
  'intent',
  'level',
  'count',
  'event_type',
  'template',
  'check',
  'route',
] as const;
export type LogField = (typeof LOG_FIELDS)[number];
export type LogFields = Partial<Record<LogField, string | number | boolean | null>>;

export interface LogSink {
  write(line: string): void;
}

export const consoleSink: LogSink = {
  write(line) {
    console.log(line);
  },
};

const LOOKS_SECRET: RegExp[] = [
  /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/, // JWT
  /[A-Za-z0-9_-]{32,}/, // long random token / refresh token / hash-like strings
  /(^|\D)\d{6}(\D|$)/, // a 6-digit code
  /@/, // an email address
];

// Hex hashes and HMACs we generate ourselves are allowed in these fields only.
const HASH_FIELDS = new Set<LogField>(['email_hmac', 'device_id_hash', 'request_id', 'account_id']);

function clean(field: LogField, value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (HASH_FIELDS.has(field)) return /^[0-9a-f-]{8,128}$/i.test(value) ? value : undefined;
  if (field === 'latency_ms') return undefined;
  return LOOKS_SECRET.some((re) => re.test(value)) ? '[redacted]' : value.slice(0, 64);
}

export class AuthLogger {
  constructor(
    private readonly sink: LogSink,
    private readonly logKey: string,
  ) {}

  emailHmac(email: string): Promise<string> {
    return hmacHex(this.logKey, email.trim().toLowerCase());
  }

  event(name: string, fields: LogFields = {}): void {
    const out: Record<string, unknown> = { event: name, at: new Date().toISOString() };
    for (const key of LOG_FIELDS) {
      if (key in fields) {
        const v = clean(key, fields[key]);
        if (v !== undefined) out[key] = v;
      }
    }
    this.sink.write(JSON.stringify(out));
  }
}
