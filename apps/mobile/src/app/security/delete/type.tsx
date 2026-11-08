import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { DELETION_GRACE_DAYS } from '@life-os/core';
import { AuthScreen, FieldError, Lead } from '@/components/auth';
import { PrimaryButton, SecondaryButton } from '@/components/forms';
import { SharedAlert } from '@/features/auth/parts';
import { longDateUK } from '@/lib/auth/copy';
import { toAuthError, type AuthError } from '@/lib/auth/errors';
import { useBackend } from '@/lib/session';
import { reauth } from '@/features/auth/reauth';
import { colors, radius, type } from '@/theme';

/**
 * S-5e · Type DELETE to confirm (empty) · S-5f typed · S-5g deleting. Case-sensitive: "delete"
 * doesn't count. → S-5h.
 */
export default function TypeDeleteScreen() {
  const backend = useBackend();
  const [token] = useState(() => reauth.take());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const due = longDateUK(new Date(Date.now() + DELETION_GRACE_DAYS * 86400_000).toISOString());
  const ok = text === 'DELETE';

  const submit = async () => {
    if (!ok) return;
    if (!token) return router.replace('/security/delete/confirm'); // REAUTH_REQUIRED
    setBusy(true);
    setError(null);
    try {
      await backend.auth.requestDeletion(token);
      // This session is now PENDING_DELETION: the root guard shows S-5h.
    } catch (raw) {
      const e = toAuthError(raw);
      if (e.code === 'REAUTH_REQUIRED') router.replace('/security/delete/confirm');
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      testID={busy ? 'screen-S-5g' : text ? 'screen-S-5f' : 'screen-S-5e'}
      back={{ onPress: () => router.back() }}
      title="Delete your account?"
      lead={
        <Lead
          before="Your account will be deleted on "
          bold={due}
          after=". You can cancel until then by signing in."
        />
      }
      footer={
        <>
          <SharedAlert error={error} />
          <PrimaryButton
            label={busy ? 'Deleting…' : 'Delete my account'}
            busy={busy}
            disabled={!ok}
            onPress={() => void submit()}
          />
          <SecondaryButton label="Keep my account" onPress={() => router.dismissTo('/security')} />
        </>
      }
    >
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Type DELETE to confirm</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          accessibilityLabel="Type DELETE to confirm"
          testID="field-delete"
          style={styles.input}
        />
        <FieldError>
          {text && !ok && text.toUpperCase() === 'DELETE'
            ? 'Type DELETE in capital letters.'
            : null}
        </FieldError>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  label: { ...type.footnote, fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  input: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: '#949494',
    borderRadius: radius.md,
    paddingHorizontal: 16,
    ...type.body,
    color: colors.text,
  },
});
