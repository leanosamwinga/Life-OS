import { useState } from 'react';
import { router } from 'expo-router';
import {
  AuthAlert,
  AuthScreen,
  CodeInput,
  FieldError,
  InfoCard,
  Lead,
  useCountdown,
} from '@/components/auth';
import { LinkButton, PrimaryButton, SecondaryButton } from '@/components/forms';
import { CODE_INCORRECT, countdownText } from '@/lib/auth/copy';
import { AuthError, toAuthError } from '@/lib/auth/errors';
import { useBackend } from '@/lib/session';
import { postSignIn } from './hooks';
import { SharedAlert } from './parts';

/**
 * 0b-4 · Check your inbox (confirm a new account) and 0b-5h · Check it's you (new device).
 *   4a just sent · 4b checking · 4c wrong code · 4d expired · 4e too many tries ·
 *   4f resent ("Use the newest code") · RESEND_LIMIT · 4g lives in onboarding/confirmed.
 */
export function CodeScreen(props: {
  purpose: 'confirm' | 'new-device';
  challengeId: string;
  email: string;
  resendAt?: string;
}) {
  const backend = useBackend();
  const [challengeId, setChallengeId] = useState(props.challengeId);
  const [resendAt, setResendAt] = useState(() =>
    props.resendAt ? Date.parse(props.resendAt) : Date.now() + 30_000,
  );
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [resent, setResent] = useState(false);
  const wait = useCountdown(resendAt);

  const verify = async (value: string) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    // A new email account sees 0b-4g ("You're in") before onboarding.
    postSignIn.set(props.purpose === 'confirm' ? '/onboarding/confirmed' : null);
    try {
      if (props.purpose === 'confirm') await backend.auth.confirmEmail(challengeId, value);
      else await backend.auth.stepUp(challengeId, value);
    } catch (raw) {
      postSignIn.clear();
      const e = toAuthError(raw);
      setError(e.code === 'CHALLENGE_NOT_FOUND' ? new AuthError('CODE_EXPIRED') : e);
      if (e.code !== 'CODE_INCORRECT') setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const c = await backend.auth.resendCode(challengeId);
      setChallengeId(c.challengeId);
      setResendAt(Date.parse(c.resendAvailableAt));
      setCode('');
      setResent(true);
    } catch (raw) {
      const e = toAuthError(raw);
      if (e.code === 'RESEND_TOO_SOON' && e.retryAfterSeconds)
        setResendAt(Date.now() + e.retryAfterSeconds * 1000);
      else setError(e);
    }
  };

  const confirm = props.purpose === 'confirm';
  const back = { onPress: () => router.back() };

  if (error?.code === 'CODE_EXPIRED' || error?.code === 'CODE_ATTEMPTS_EXCEEDED') {
    const expired = error.code === 'CODE_EXPIRED';
    return (
      <AuthScreen
        testID={expired ? 'screen-0b-4d' : 'screen-0b-4e'}
        back={back}
        title={expired ? 'That code has expired' : 'Too many tries'}
        lead={
          expired
            ? "Codes last 10 minutes. We'll send you a fresh one."
            : 'That code no longer works. Ask for a new one. Your account is safe.'
        }
        footer={<PrimaryButton label="Send a new code" onPress={() => void resend()} />}
      />
    );
  }
  if (error?.code === 'RESEND_LIMIT') {
    return (
      <AuthScreen
        testID="screen-0b-4-limit"
        back={back}
        title="Too many codes"
        lead="You've asked for a lot of codes. Use the latest email, or try again in an hour."
        footer={<SecondaryButton label="Back" onPress={() => setError(null)} />}
      />
    );
  }

  const testID = busy
    ? 'screen-0b-4b'
    : error?.code === 'CODE_INCORRECT'
      ? 'screen-0b-4c'
      : resent
        ? 'screen-0b-4f'
        : confirm
          ? 'screen-0b-4a'
          : 'screen-0b-5h';
  return (
    <AuthScreen
      testID={testID}
      back={back}
      title={confirm ? 'Check your inbox' : "Check it's you"}
      lead={
        confirm ? (
          <Lead
            before="We've sent a 6-digit code to "
            bold={props.email}
            after=". It expires in 10 minutes."
          />
        ) : (
          <Lead
            before="We've noticed unusual sign-in attempts on this account, so we've sent a 6-digit code to "
            bold={props.email}
            after="."
          />
        )
      }
      footer={
        <>
          <SharedAlert error={error && error.code !== 'CODE_INCORRECT' ? error : null} />
          <PrimaryButton
            label={busy ? 'Checking…' : 'Confirm'}
            busy={busy}
            disabled={code.length !== 6}
            onPress={() => void verify(code)}
          />
          <SecondaryButton
            label={wait > 0 ? `Resend in ${countdownText(wait)}` : 'Resend code'}
            accessibilityLabel={wait > 0 ? `Resend available in ${wait} seconds` : 'Resend code'}
            disabled={wait > 0}
            onPress={() => void resend()}
          />
          {confirm ? (
            <LinkButton
              label="Wrong email? Change it"
              onPress={() =>
                router.replace({ pathname: '/sign-up/email', params: { email: props.email } })
              }
            />
          ) : null}
        </>
      }
    >
      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={(v) => void verify(v)}
        error={error?.code === 'CODE_INCORRECT'}
        disabled={busy}
      />
      <FieldError>{error?.code === 'CODE_INCORRECT' ? CODE_INCORRECT : null}</FieldError>
      {resent ? (
        <AuthAlert
          title="Use the newest code."
          body="Older codes no longer work."
          testID="alert-resent"
        />
      ) : null}
      {!confirm ? (
        <InfoCard>
          This only happens when you sign in on a new device. Nothing on your account has changed.
        </InfoCard>
      ) : null}
    </AuthScreen>
  );
}
