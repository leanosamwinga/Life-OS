import { ActivityIndicator, Linking, Modal, StyleSheet, Text, View } from 'react-native';
import { PRIVACY_POLICY_URL, TERMS_URL } from '@life-os/core';
import { AuthAlert, ProviderButton } from '@/components/auth';
import { SecondaryButton } from '@/components/forms';
import { sharedAlert } from '@/lib/auth/copy';
import type { AuthError } from '@/lib/auth/errors';
import type { Provider } from '@/lib/backend/types';
import { colors, space, type } from '@/theme';

/** RATE_LIMITED / DEVICE_CHECK_FAILED / SERVER_ERROR / network (spec 3.4). */
export function SharedAlert({ error }: { error: AuthError | null }) {
  const copy = error ? sharedAlert(error.code) : null;
  return copy ? <AuthAlert title={copy.title} body={copy.body} /> : null;
}

/** "By continuing you agree to the Terms and have read the Privacy Policy. UK only." */
export function LegalNote() {
  return (
    <Text style={styles.legal}>
      By continuing you agree to the{' '}
      <Text
        style={styles.link}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(TERMS_URL)}
      >
        Terms
      </Text>{' '}
      and have read the{' '}
      <Text
        style={styles.link}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
      >
        Privacy Policy
      </Text>
      . UK only.
    </Text>
  );
}

/** Apple first, then Google — Apple is always offered wherever Google is. */
export function ProviderButtons(props: {
  verb: 'Continue';
  busy: Provider | null;
  onPress: (p: Provider) => void;
}) {
  return (
    <>
      <ProviderButton
        provider="APPLE"
        label="Continue with Apple"
        busy={props.busy === 'APPLE'}
        disabled={props.busy !== null}
        onPress={() => props.onPress('APPLE')}
      />
      <ProviderButton
        provider="GOOGLE"
        label="Continue with Google"
        primary={false}
        disabled={props.busy !== null}
        onPress={() => props.onPress('GOOGLE')}
      />
    </>
  );
}

/** 0b-8f · Signing you in… (while Apple's or Google's sheet is open). */
export function SigningIn({
  provider,
  onCancel,
}: {
  provider: Provider | null;
  onCancel: () => void;
}) {
  return (
    <Modal visible={provider !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay} accessibilityViewIsModal testID="screen-0b-8f">
        <View style={styles.sheet}>
          <ActivityIndicator color={colors.fill} accessibilityLabel="Signing you in" />
          <Text style={styles.title} accessibilityRole="header">
            Signing you in…
          </Text>
          <Text style={styles.body}>
            Finish in the {provider === 'APPLE' ? 'Apple' : 'Google'} window.
          </Text>
          <SecondaryButton label="Cancel" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  legal: { ...type.footnote, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  link: { color: colors.text, textDecorationLine: 'underline' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    padding: space.xl,
    gap: space.md,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.textSecondary },
});
