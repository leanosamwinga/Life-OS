import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FormMessage, FormScreen, PrimaryButton, TextField, formStyles } from '@/components/forms';
import { SheetHeader } from '@/features/log-meal/parts';
import {
  parseTargets,
  TARGET_FIELDS,
  targetInputs,
  type TargetKey,
} from '@/features/targets/parse';
import { defaultUserSettings } from '@/lib/backend/settings';
import { useSession } from '@/lib/session';
import { space } from '@/theme';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * Me → Meal plan & macro targets (also "Set targets now" in onboarding 0g). Uses the in-page
 * SheetHeader like the other sheets rather than the native iOS header, whose translucent bar hid
 * the intro line; the form scrolls clear of the keyboard.
 */
export default function TargetsScreen() {
  const session = useSession();
  const current = session.settings?.targets ?? defaultUserSettings().targets;
  const [inputs, setInputs] = useState(() => targetInputs(current));
  const [errors, setErrors] = useState<Partial<Record<TargetKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const parsed = parseTargets(inputs);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await session.updateSettings({ targets: parsed.targets });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your targets.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreen
      testID="screen-targets"
      keyboardInsets
      header={<SheetHeader left="Cancel" onLeft={close} title="Daily targets" />}
    >
      <Text style={formStyles.body} testID="targets-intro">
        Your daily targets for calories, protein, carbs, fat, water and steps. Leave any blank to
        set it later.
      </Text>
      <View style={styles.grid}>
        {TARGET_FIELDS.map((f) => (
          <View key={f.key} style={styles.cell}>
            <TextField
              label={`${f.label} (${f.unit})`}
              value={inputs[f.key]}
              onChangeText={(t) => setInputs((i) => ({ ...i, [f.key]: t }))}
              keyboardType={f.decimals ? 'decimal-pad' : 'number-pad'}
              error={errors[f.key]}
            />
          </View>
        ))}
      </View>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <PrimaryButton label="Save targets" busy={busy} onPress={() => void save()} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md },
  cell: { flexBasis: '47%', flexGrow: 1 },
});
