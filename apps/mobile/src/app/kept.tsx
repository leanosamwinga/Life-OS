import { router } from 'expo-router';
import { AuthScreen } from '@/components/auth';
import { PrimaryButton } from '@/components/forms';
import { postSignIn } from '@/features/auth/hooks';

/** S-5i · Your account is safe → Today. */
export default function AccountKeptScreen() {
  return (
    <AuthScreen
      testID="screen-S-5i"
      title="Your account is safe"
      lead="You cancelled the deletion. Everything is as you left it."
      footer={
        <PrimaryButton
          label="Go to Today"
          onPress={() => {
            postSignIn.clear();
            router.replace('/');
          }}
        />
      }
    />
  );
}
