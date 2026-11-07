// Spec 7: plain emails, no tracking, no sign-in links — the reset email is the only one with a link.
import { describe, expect, it } from 'vitest';
import { NEVER_ASK, renderEmail, type EmailTemplate } from './email.ts';

const params = {
  code: '482916',
  device: 'iPhone · London',
  link: 'https://lifeos.example.test/reset#t=abc',
  provider: 'GOOGLE',
  method: 'PASSWORD',
  changed_at: '2026-11-06T21:14:00Z',
  requested_at: '2026-11-06T10:00:00Z',
  due_at: '2026-12-06T10:00:00Z',
};
const ALL: EmailTemplate[] = [
  'confirm_code',
  'new_device_code',
  'reset_link',
  'reset_uses_provider',
  'owner_alert',
  'password_changed',
  'deletion_requested',
  'deletion_cancelled',
  'deletion_completed',
];

describe('emails (spec 7)', () => {
  it.each(ALL)(
    '%s: no tracking, ends with the never-ask line, link only in the reset email',
    (t) => {
      const e = renderEmail(t, params);
      expect(e.text.trim().endsWith(NEVER_ASK)).toBe(true);
      expect(e.html).not.toMatch(/<img|utm_|pixel|track/i);
      const links =
        (e.html.match(/<a /g) ?? []).length + (e.text.match(/https?:\/\//g) ?? []).length;
      if (t === 'reset_link') {
        expect(e.html).toContain('href="https://lifeos.example.test/reset#t=abc"');
      } else {
        expect(links).toBe(0);
      }
    },
  );

  it('codes are in the body, never the subject', () => {
    for (const t of ['confirm_code', 'new_device_code'] as const) {
      const e = renderEmail(t, params);
      expect(e.subject).not.toContain('482916');
      expect(e.text).toContain('482916');
    }
  });
});
