import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FormMessage, PrimaryButton, TextField, formStyles } from '@/components/forms';
import {
  parseTargets,
  TARGET_FIELDS,
  targetInputs,
  type TargetKey,
} from '@/features/targets/parse';
import { defaultUserSettings } from '@/lib/backend/settings';
import { useSession } from '@/lib/session';
import { colors, space } from '@/theme';

/** Me → Meal plan & macro targets (also "Set targets now" in onboarding 0g). */
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
      if (router.canGoBack()) router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your targets.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      testID="screen-targets"
    >
      <Text style={formStyles.body}>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { padding: space.xl, gap: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md },
  cell: { flexBasis: '47%', flexGrow: 1 },
});
