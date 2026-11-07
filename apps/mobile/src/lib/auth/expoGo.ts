// Google's iPhone sign-in (0b-8c) returns to the app through a URL scheme made from the iOS
// client id (com.googleusercontent.apps.…), which app.config.ts adds to a development or store
// build. Expo Go is a prebuilt app that can't register it, so the browser has nowhere to come
// back to (Expo: "with SDK 49+, Google sign-in on iOS needs a development build"). In Expo Go the
// Google button says so instead of failing on 0b-8g. Apple works in Expo Go (native sheet,
// APPLE_BUNDLE_ID=host.exp.Exponent locally).
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

export function googleNeedsDevBuild(): boolean {
  return Platform.OS !== 'web' && isRunningInExpoGo();
}
