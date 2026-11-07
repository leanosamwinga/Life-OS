import { router } from 'expo-router';
import { AuthScreen } from '@/components/auth';
import { PrimaryButton } from '@/components/forms';
import { postSignIn } from '@/features/auth/hooks';

/** 0b-4g · Email confirmed → Continue → 0c. */
export default function EmailConfirmedScreen() {
  return (
    <AuthScreen
      testID="screen-0b-4g"
      title="Email confirmed"
      lead="Your account is ready. Next, a few quick choices about your data. It takes about a minute."
      footer={
        <PrimaryButton
          label="Continue"
          onPress={() => {
            postSignIn.clear();
            router.replace('/onboarding/consent');
          }}
        />
      }
    />
  );
}
