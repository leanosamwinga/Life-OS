import { useLocalSearchParams } from 'expo-router';
import { CodeScreen } from '@/features/auth/CodeScreen';

/** 0b-5h · Check it's you (correct password, new device, after unusual tries). */
export default function NewDeviceCodeRoute() {
  const p = useLocalSearchParams<{ challengeId: string; email: string }>();
  return <CodeScreen purpose="new-device" challengeId={p.challengeId} email={p.email} />;
}
