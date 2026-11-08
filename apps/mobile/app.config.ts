import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Adds config that depends on env vars to app.json. Only public identifiers here — never secrets.
 *
 * EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (e.g. 1234-abc.apps.googleusercontent.com) registers its
 * reversed client id as a URL scheme, which Google's browser flow on iOS (0b-8c,
 * ASWebAuthenticationSession with PKCE + nonce) redirects back to.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iosClientId) return config as ExpoConfig;
  const scheme = `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
  const infoPlist = { ...(config.ios?.infoPlist ?? {}) };
  const types = [...((infoPlist.CFBundleURLTypes as { CFBundleURLSchemes: string[] }[]) ?? [])];
  types.push({ CFBundleURLSchemes: [scheme] });
  infoPlist.CFBundleURLTypes = types;
  return { ...config, ios: { ...config.ios, infoPlist } } as ExpoConfig;
};
