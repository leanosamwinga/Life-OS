// Wires auth-api together. Used by index.ts (Deno, edge runtime) and by the tests (Node).
import type { Sql } from 'postgres';
import { AppleClient, JoseAppleWebhookVerifier, type AppleWebhookVerifier } from './apple.ts';
import type { AuthConfig } from './config.ts';
import { DeviceChecksOff, RealDeviceChecks, type DeviceCheck } from './device-check.ts';
import type { EmailSender } from './email.ts';
import { JoseIdTokenVerifier, type IdTokenVerifier } from './federated.ts';
import { GoTrue } from './gotrue.ts';
import { createHandler } from './handler.ts';
import { drainOutbox, processAppleRevocations } from './jobs.ts';
import { AuthLogger, type LogSink } from './log.ts';
import { AuthService } from './service.ts';
import { SqlAppAttestKeys } from './app-attest-store.ts';

export interface AppOptions {
  config: AuthConfig;
  sql: Sql;
  emailSender: EmailSender;
  logSink: LogSink;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  idTokens?: IdTokenVerifier;
  appleWebhook?: AppleWebhookVerifier;
  deviceCheck?: DeviceCheck;
  /** Background work after a response. Default: run it and log failures. */
  later?: (task: () => Promise<void>) => void;
  locate?: (ipPrefix: string | null) => Promise<string | null>;
}

export function createApp(o: AppOptions) {
  const now = o.now ?? (() => new Date());
  const log = new AuthLogger(o.logSink, o.config.logKey);
  const gotrue = new GoTrue(o.config.authUrl, o.config.anonKey, o.config.serviceKey, o.fetchImpl);
  const apple = new AppleClient(o.config, o.fetchImpl);
  const drain = async () => {
    await drainOutbox(o.sql, o.emailSender, log);
  };
  const later =
    o.later ??
    ((task: () => Promise<void>) => {
      void task().catch(() => log.event('auth.job.failed', { reason: 'background' }));
    });
  const service = new AuthService({
    config: o.config,
    sql: o.sql,
    gotrue,
    log,
    idTokens: o.idTokens ?? new JoseIdTokenVerifier(o.config, now),
    apple,
    // No GeoIP database yet: the device list shows no town (docs/SPEC-QUESTIONS.md Q-GEOIP).
    locate: o.locate ?? (async () => null),
    later,
    drainOutbox: drain,
    now,
  });
  const deviceCheck =
    o.deviceCheck ??
    (o.config.deviceChecks
      ? new RealDeviceChecks(
          {
            secret: o.config.turnstile.secret,
            siteverifyUrl: o.config.turnstile.siteverifyUrl,
            fetchImpl: o.fetchImpl,
          },
          { appIds: o.config.appAttest.appIds, keys: new SqlAppAttestKeys(o.sql) },
        )
      : new DeviceChecksOff());
  const handler = createHandler({
    config: o.config,
    service,
    deviceCheck,
    log,
    sql: o.sql,
    appleWebhook: o.appleWebhook ?? new JoseAppleWebhookVerifier(o.config),
    newRequestId: () => crypto.randomUUID(),
    runJobs: async () => ({
      emails_sent: await drainOutbox(o.sql, o.emailSender, log),
      apple_revoked: await processAppleRevocations(o.sql, o.config, (t) => apple.revoke(t), log),
    }),
  });
  return { handler, service, log, gotrue, apple };
}
