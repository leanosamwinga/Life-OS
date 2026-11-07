import { useLocalSearchParams } from 'expo-router';
import { TicketScreen } from '@/features/auth/TicketScreen';
import type { Provider } from '@/lib/backend/types';

/** 0b-8i · Not recognised (Apple/Google sign in) → one-tap create. */
export default function NotRecognisedRoute() {
  const p = useLocalSearchParams<{ ticket: string; email: string; provider: Provider }>();
  return <TicketScreen kind="not-found" ticket={p.ticket} email={p.email} provider={p.provider} />;
}
