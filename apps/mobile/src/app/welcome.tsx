import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FormScreen, IconTile, PrimaryButton, SecondaryButton } from '@/components/forms';
import { LegalNote } from '@/features/auth/parts';
import { colors, space, type } from '@/theme';

/** 0a · Welcome — Create account or Sign in. */
export default function WelcomeScreen() {
  return (
    <FormScreen
      testID="screen-0a"
      footer={
        <>
          <PrimaryButton label="Create account" onPress={() => router.push('/sign-up')} />
          <SecondaryButton label="Sign in" onPress={() => router.push('/sign-in')} />
          <View style={{ height: space.xs }} />
          <LegalNote />
        </>
      }
    >
      <View style={styles.top}>
        <IconTile />
        <Text style={styles.title} accessibilityRole="header">
          Life OS
        </Text>
        <Text style={styles.body}>
          Health, money and plans in one calm place. Your data stays yours: no ads, never sold.
        </Text>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  top: { marginTop: 48, gap: space.xl },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.4, color: colors.text },
  body: { ...type.body, color: colors.textSecondary, lineHeight: 24 },
});
