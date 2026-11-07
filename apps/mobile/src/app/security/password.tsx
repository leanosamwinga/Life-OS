import { useState } from 'react';
import { router } from 'expo-router';
import { checkPassword } from '@life-os/core';
import { AuthScreen, InfoCard, Lead, PasswordField, RuleList } from '@/components/auth';
import { PrimaryButton } from '@/components/forms';
import { useClearOnBlur, usePasswordRules } from '@/features/auth/hooks';
import { SharedAlert } from '@/features/auth/parts';
import {
  PASSWORD_ERRORS,
  PASSWORDS_DONT_MATCH,
  WRONG_PASSWORD_CHANGE,
  waitText,
} from '@/lib/auth/copy';
import type { AuthError } from '@/lib/auth/errors';
import { toAuthError } from '@/lib/auth/errors';
import { useBackend, useSession } from '@/lib/session';

/**
 * S-2 · Change password. 2a empty · 2b filled · 2c saving · 2d wrong current password ·
 * 2e breached · 2f changed (other devices signed out).
 */
export default function ChangePasswordScreen() {
  const backend = useBackend();
  const { user } = useSession();
  const email = user?.email ?? '';
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const { rules } = usePasswordRules(next, email);
  useClearOnBlur(setCurrent, setNext, setConfirm);

  const clear = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  const save = async () => {
    setError(null);
    setMismatch(false);
    if (next !== confirm) {
      setMismatch(true);
      clear();
      return;
    }
    setBusy(true);
    try {
      await backend.auth.changePassword(current, next);
      setDone(true);
    } catch (raw) {
      setError(toAuthError(raw));
    } finally {
      clear();
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthScreen
        testID="screen-S-2f"
        title="Password changed"
        lead="We've signed you out on your other devices and emailed you to confirm."
        footer={<PrimaryButton label="Done" onPress={() => router.back()} />}
      >
        <InfoCard>Didn't change it yourself? Reset it straight away.</InfoCard>
      </AuthScreen>
    );
  }

  const newError = mismatch
    ? PASSWORDS_DONT_MATCH
    : error
      ? (PASSWORD_ERRORS[error.code] ?? null)
      : null;
  const currentError = error?.code === 'WRONG_PASSWORD' ? WRONG_PASSWORD_CHANGE : null;
  const paused = error?.code === 'SIGN_IN_PAUSED';
  const ready = current.length > 0 && checkPassword(next, email).lengthOk && confirm.length > 0;
  return (
    <AuthScreen
      testID={
        currentError
          ? 'screen-S-2d'
          : error?.code === 'PASSWORD_BREACHED'
            ? 'screen-S-2e'
            : busy
              ? 'screen-S-2c'
              : next
                ? 'screen-S-2b'
                : 'screen-S-2a'
      }
      back={{ onPress: () => router.back() }}
      title="Change password"
      footer={
        <>
          <SharedAlert error={newError || currentError || paused ? null : error} />
          <PrimaryButton
            label={busy ? 'Changing…' : 'Change password'}
            busy={busy}
            disabled={!ready}
            onPress={() => void save()}
          />
          <Lead before="Your other devices will be signed out." />
        </>
      }
    >
      <RuleList
        title="Your new password"
        rules={[
          { ...rules[0]!, label: 'At least 15 characters. Three random words works well.' },
          { ...rules[1]!, label: "Not one that's appeared in a known data breach" },
          rules[2]!,
        ]}
      />
      <PasswordField
        kind="current"
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        testID="field-current"
        error={
          currentError ??
          (paused
            ? `Too many tries. Try again in ${waitText(error?.retryAfterSeconds ?? 900)}.`
            : null)
        }
      />
      <PasswordField
        kind="new"
        label="New password"
        value={next}
        onChangeText={setNext}
        error={newError}
      />
      <PasswordField
        kind="new"
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        testID="field-confirm"
        onSubmitEditing={() => void save()}
      />
    </AuthScreen>
  );
}
