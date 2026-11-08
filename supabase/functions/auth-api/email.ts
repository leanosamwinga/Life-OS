// Email (spec 7). Every auth email goes: flow → public.auth_email_outbox → drainOutbox →
// EmailSender. Locally the sender is Mailpit; the production provider is chosen later and only
// needs to implement EmailSender. No tracking pixels, no link tracking, and no sign-in links:
// the reset link is the only link we ever send, and it can't sign anyone in.
import { formatTimeUK } from '@life-os/core';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/** Mailpit's send API (https://mailpit.axllent.org/docs/api-v1/) — local development only. */
export class MailpitSender implements EmailSender {
  constructor(
    private readonly baseUrl: string,
    private readonly from = 'no-reply@lifeos.app',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(email: OutgoingEmail): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: this.from, Name: 'Life OS' },
        To: [{ Email: email.to }],
        Subject: email.subject,
        Text: email.text,
        HTML: email.html,
      }),
    });
    if (!res.ok) throw new Error(`mailpit ${res.status}`);
  }
}

/** Keeps sent mail in memory (unit tests). */
export class MemorySender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }
}

export type EmailTemplate =
  | 'confirm_code'
  | 'new_device_code'
  | 'reset_link'
  | 'reset_uses_provider'
  | 'owner_alert'
  | 'password_changed'
  | 'deletion_requested'
  | 'deletion_cancelled'
  | 'deletion_completed';

export const NEVER_ASK = "We'll never ask for your password or a code by email, phone or message.";

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const providerName = (p: unknown) => (p === 'APPLE' ? 'Apple' : 'Google');

/** "6 November 2026" */
function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(new Date(iso));
}

/** "Friday 6 November" */
function weekdayDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  }).format(new Date(iso));
}

interface Para {
  text: string;
  bold?: string;
}

function render(subject: string, paras: (string | Para)[], link?: { label: string; url: string }) {
  const lines = paras.map((p) => (typeof p === 'string' ? p : p.text));
  if (link) lines.splice(1, 0, `${link.label}: ${link.url}`);
  lines.push('', NEVER_ASK);
  const htmlParas = paras.map((p) => {
    if (typeof p === 'string') return `<p>${esc(p)}</p>`;
    const t = esc(p.text);
    return `<p>${p.bold ? t.replace(esc(p.bold), `<strong>${esc(p.bold)}</strong>`) : t}</p>`;
  });
  if (link) {
    htmlParas.splice(
      1,
      0,
      `<p><a href="${esc(link.url)}" style="color:#111;font-weight:600">${esc(link.label)}</a></p>`,
    );
  }
  htmlParas.push(`<p style="color:#555">${esc(NEVER_ASK)}</p>`);
  const html = `<!doctype html><html lang="en-GB"><body style="font-family:-apple-system,system-ui,sans-serif;color:#111;max-width:480px">${htmlParas.join('')}</body></html>`;
  return { subject, text: lines.join('\n'), html };
}

/** Builds one email from spec 7 copy. `params` comes from the outbox row. */
export function renderEmail(template: EmailTemplate, params: Record<string, unknown>) {
  const p = (k: string) => String(params[k] ?? '');
  switch (template) {
    case 'confirm_code':
      return render('Confirm your email for Life OS', [
        { text: `Your Life OS code is ${p('code')}.`, bold: p('code') },
        'It expires in 10 minutes and works once.',
        "If you didn't just create a Life OS account, you can ignore this email.",
      ]);
    case 'new_device_code':
      return render('Your Life OS sign-in code', [
        {
          text: `Someone is signing in to Life OS on a new device: ${p('device')}.`,
          bold: p('device'),
        },
        { text: `Your code is ${p('code')}. It expires in 10 minutes.`, bold: p('code') },
        "Not you? Don't share this code. Someone may know your password, so open Life OS and change it in Me → Security, or use Forgot password on the sign-in screen.",
      ]);
    case 'reset_link':
      return render(
        'Reset your Life OS password',
        [
          'Hi, someone asked to reset the password for this Life OS account.',
          'This link works once and expires in 30 minutes.',
          {
            text: "Didn't ask for this? Ignore this email. Your password won't change.",
            bold: "Didn't ask for this?",
          },
          "We'll never email you your password.",
        ],
        { label: 'Set a new password', url: p('link') },
      );
    case 'reset_uses_provider': {
      const name = providerName(params.provider);
      return render('About signing in to Life OS', [
        {
          text: `Someone asked to reset the password for this email. Your Life OS account uses ${name} to sign in, so there's no password to reset.`,
          bold: name,
        },
        `Open Life OS, then choose Continue with ${name}.`,
        {
          text: "Didn't ask for this? You can ignore this email. Nothing has changed.",
          bold: "Didn't ask for this?",
        },
      ]);
    }
    case 'owner_alert': {
      const how =
        params.method === 'PASSWORD'
          ? 'with your email and password'
          : `with ${providerName(params.method)}`;
      return render('Someone tried to sign up with your email', [
        'Someone tried to create a new Life OS account with this email address. You already have an account, so nothing has changed.',
        `If it was you, open Life OS and sign in ${how}.`,
        "If it wasn't you, you don't need to do anything.",
      ]);
    }
    case 'password_changed': {
      const at = p('changed_at');
      return render('Your Life OS password was changed', [
        `Your Life OS password was changed on ${weekdayDate(at)} at ${formatTimeUK(new Date(at))}.`,
        "We've signed you out on your other devices.",
        {
          text: "Didn't do this? Open Life OS and use Forgot password on the sign-in screen straight away. If you can't get in, reply to this email and we'll help.",
          bold: "Didn't do this?",
        },
      ]);
    }
    case 'deletion_requested':
      return render("We're deleting your Life OS account", [
        `You asked us to delete your Life OS account on ${longDate(p('requested_at'))}. We'll delete it permanently on ${longDate(p('due_at'))}.`,
        'Changed your mind? Open Life OS, sign in, and tap Keep my account before then.',
        {
          text: "Didn't ask for this? Sign in and tap Keep my account, then change your password.",
          bold: "Didn't ask for this?",
        },
      ]);
    case 'deletion_cancelled':
      return render('Your Life OS account is safe', [
        'You cancelled the deletion. Everything is as you left it.',
        "Didn't do this? Change your password in Me → Security.",
      ]);
    case 'deletion_completed':
      return render('Your Life OS account has been deleted', [
        'Your account and data have been deleted. Backups clear within 35 days. Thanks for using Life OS.',
      ]);
  }
}
