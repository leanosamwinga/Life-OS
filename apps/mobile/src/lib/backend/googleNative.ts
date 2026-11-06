import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { CancelledError, UserFacingError } from './types';

/** Public OAuth client ids (not secrets) for the native Google sign-in sheet. */
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/**
 * The native sheet needs a development or store build (Expo Go doesn't include the module) and
 * the client ids. Otherwise we fall back to the in-app browser OAuth flow.
 */
export function canUseNativeGoogle(): boolean {
  if (Platform.OS === 'web') return false;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false;
  if (!WEB_CLIENT_ID) return false;
  return Platform.OS !== 'ios' || Boolean(IOS_CLIENT_ID);
}

/** Show Google's native account picker and return the ID token for Supabase. */
export async function nativeGoogleIdToken(): Promise<string> {
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } =
    await import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID });
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) throw new CancelledError('Sign-in cancelled');
    if (!response.data.idToken) throw new UserFacingError('Google didn’t return a sign-in token.');
    return response.data.idToken;
  } catch (err) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) throw new CancelledError('Sign-in cancelled');
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new UserFacingError('Google Play services are needed to sign in with Google.');
      }
    }
    throw err;
  }
}
