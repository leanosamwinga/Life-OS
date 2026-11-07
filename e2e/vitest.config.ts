// Phone-like end-to-end tests against the real local stack (scripts/local-auth/start.sh or
// `supabase start`). They run the app's own AuthClient and Supabase backend (src/lib) in Node,
// with the few Expo/React Native modules they touch replaced by small stand-ins (./stubs).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const stub = (name: string) => fileURLToPath(new URL(`./stubs/${name}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'react-native-url-polyfill/auto': stub('empty.ts'),
      'react-native': stub('react-native.ts'),
      'expo-secure-store': stub('expo-secure-store.ts'),
      'expo-crypto': stub('expo-crypto.ts'),
      'expo-file-system': stub('empty.ts'),
      'expo-sharing': stub('empty.ts'),
      'expo-apple-authentication': stub('empty.ts'),
      'expo-web-browser': stub('empty.ts'),
    },
  },
  test: {
    include: ['**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
