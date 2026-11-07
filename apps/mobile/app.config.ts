import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Adds config that depends on env vars to app.json. Only public identifiers here — never secrets.
 *
 * EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (e.g. 1234-abc.apps.googleusercontent.com) enables the native
 * Google sign-in sheet on iOS by registering its reversed client id as a URL scheme. Without it,
 * Google sign-in uses the in-app browser.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])];
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (iosClientId) {
    const id = iosClientId.replace(/\.apps\.googleusercontent\.com$/, '');
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: `com.googleusercontent.apps.${id}` },
    ]);
  }
  return { ...config, plugins } as ExpoConfig;
};
