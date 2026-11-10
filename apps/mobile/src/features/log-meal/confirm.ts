import { Alert, Platform } from 'react-native';
import { discardQuestion, type KeptDraft } from './draft';

/**
 * Ask before a new start replaces the meal kept on 7a (7a-C): "Discard Chicken stir-fry?" /
 * "Its 2 components won't be logged." / Discard / Keep it. An Alert on iPhone, confirm() on the web
 * (OK discards), as Build meal's "Delete this meal?" does. Resolves true to discard.
 */
export function confirmDiscard(k: KeptDraft): Promise<boolean> {
  const q = discardQuestion(k);
  if (Platform.OS === 'web') {
    const c = (globalThis as { confirm?: (m: string) => boolean }).confirm;
    return Promise.resolve(c ? c(`${q.title}\n${q.message}`) : true);
  }
  return new Promise((resolve) =>
    Alert.alert(
      q.title,
      q.message,
      [
        { text: 'Keep it', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Discard', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
