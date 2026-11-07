import { useLocalSearchParams } from 'expo-router';
import { TicketScreen } from '@/features/auth/TicketScreen';
import type { Provider } from '@/lib/backend/types';

/** 0b-8h · An account already exists (Apple/Google create) → one-tap sign in. */
export default function AlreadyExistsRoute() {
  const p = useLocalSearchParams<{ ticket: string; email: string; provider: Provider }>();
  return <TicketScreen kind="exists" ticket={p.ticket} email={p.email} provider={p.provider} />;
}
