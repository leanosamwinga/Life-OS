import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { AuthScreen, InfoCard, Lead } from '@/components/auth';
import { PrimaryButton, SecondaryButton } from '@/components/forms';
import { SharedAlert } from '@/features/auth/parts';
import { longDateUK } from '@/lib/auth/copy';
import { toAuthError, type AuthError } from '@/lib/auth/errors';
import { postSignIn } from '@/features/auth/hooks';
import { useBackend } from '@/lib/session';

/**
 * S-5h · Your account is being deleted (the only screen a PENDING_DELETION session sees) →
 * Keep my account → S-5i (/kept) · Your account is safe → Today.
 */
export default function BeingDeletedScreen() {
  const backend = useBackend();
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  useEffect(() => {
    backend.auth
      .getDeletion()
      .then((d) => setDue(d?.deletionDueAt ?? null))
      .catch((e) => setError(toAuthError(e)));
  }, [backend]);

  const keep = async () => {
    setBusy(true);
    setError(null);
    postSignIn.set('/kept'); // S-5i, once the session is FULL again
    try {
      await backend.auth.cancelDeletion();
      // The session reloads as FULL and the stack remounts on Today; go to S-5i from there.
      router.replace('/kept');
    } catch (raw) {
      postSignIn.clear();
      setError(toAuthError(raw));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      testID="screen-S-5h"
      title="Your account is being deleted"
      lead={
        due ? (
          <Lead
            before="We'll delete it permanently on "
            bold={longDateUK(due)}
            after=". Until then your data is kept safe, but you can't use Life OS."
          />
        ) : (
          'Until then your data is kept safe, but you can’t use Life OS.'
        )
      }
      footer={
        <>
          <SharedAlert error={error} />
          <PrimaryButton label="Keep my account" busy={busy} onPress={() => void keep()} />
          <SecondaryButton label="Sign out" onPress={() => void backend.auth.signOut()} />
          <Lead before="You'll see this whenever you sign in before then." />
        </>
      }
    >
      <InfoCard>We've emailed you to confirm and signed you out on your other devices.</InfoCard>
    </AuthScreen>
  );
}
