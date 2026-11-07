import { useLocalSearchParams } from 'expo-router';
import { CodeScreen } from '@/features/auth/CodeScreen';

/** 0b-4a–f · Check your inbox (confirm a new email account). */
export default function ConfirmCodeRoute() {
  const p = useLocalSearchParams<{ challengeId: string; email: string; resendAt?: string }>();
  return (
    <CodeScreen
      purpose="confirm"
      challengeId={p.challengeId}
      email={p.email}
      resendAt={p.resendAt}
    />
  );
}
