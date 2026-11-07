import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { DELETION_GRACE_DAYS } from '@life-os/core';
import { AuthScreen, InfoCard } from '@/components/auth';
import { LinkButton, PrimaryButton, SecondaryButton } from '@/components/forms';
import { SharedAlert } from '@/features/auth/parts';
import { longDateUK } from '@/lib/auth/copy';
import { toAuthError, type AuthError } from '@/lib/auth/errors';
import { useBackend } from '@/lib/session';
import { colors, space, type } from '@/theme';

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ gap: 6 }}>
      {items.map((t) => (
        <View key={t} style={{ flexDirection: 'row', gap: space.sm }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              marginTop: 8,
              backgroundColor: colors.fill,
            }}
          />
          <Text style={{ ...type.callout, color: colors.text, flex: 1, lineHeight: 21 }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/** S-5a · Delete your account — what gets deleted, and when. Export first, from here too. */
export default function DeleteAccountScreen() {
  const backend = useBackend();
  const [error, setError] = useState<AuthError | null>(null);
  const due = longDateUK(new Date(Date.now() + DELETION_GRACE_DAYS * 86400_000).toISOString());

  const exportData = async (format: 'json' | 'csv') => {
    setError(null);
    try {
      await backend.auth.exportData(format);
    } catch (raw) {
      setError(toAuthError(raw));
    }
  };

  return (
    <AuthScreen
      testID="screen-S-5a"
      back={{ onPress: () => router.back() }}
      title="Delete your account"
      lead={`You'll have ${DELETION_GRACE_DAYS} days to change your mind. After that, it's gone for good.`}
      footer={
        <>
          <PrimaryButton label="Continue" onPress={() => router.push('/security/delete/confirm')} />
          <SecondaryButton label="Keep my account" onPress={() => router.back()} />
        </>
      }
    >
      <InfoCard overline="What gets deleted">
        <Bullets
          items={[
            'Health, meals, water and check-ins',
            'Money, budgets and connected accounts',
            'Plans, week ahead and nudges',
            'Your account and sign-in details',
          ]}
        />
      </InfoCard>
      <InfoCard overline="When">
        <Bullets
          items={[
            "Today: you're signed out on every device",
            `${due}: everything is permanently deleted`,
            'Backups are cleared within 35 days after that',
          ]}
        />
      </InfoCard>
      <SharedAlert error={error} />
      <LinkButton
        label="Download a copy of your data first"
        onPress={() => void exportData('json')}
      />
      <LinkButton
        label="Download as spreadsheets (CSV)"
        muted
        onPress={() => void exportData('csv')}
      />
    </AuthScreen>
  );
}
