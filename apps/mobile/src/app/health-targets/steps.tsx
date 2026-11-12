import { useState } from 'react';
import { Text } from 'react-native';
import { TextField } from '@/components/forms';
import { editStyles, TargetEditScreen } from '@/features/targets/EditScreen';
import { parseAmount } from '@/features/targets/parse';
import { useSession } from '@/lib/session';

/** Health targets → Steps: steps a day (the count itself comes from Apple Health). */
export default function StepsTargetScreen() {
  const session = useSession();
  const current = session.settings?.targets.steps ?? null;
  const [text, setText] = useState(current == null ? '' : String(current));
  const [error, setError] = useState<string | null>(null);
  return (
    <TargetEditScreen
      title="Steps"
      testID="screen-target-steps"
      onSave={async () => {
        const r = parseAmount(text, { max: 200000, decimals: 0 });
        if (!r.ok) {
          setError(r.error);
          return false;
        }
        await session.updateSettings({ targets: { steps: r.value } });
        return true;
      }}
    >
      <TextField
        label="Steps a day"
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        keyboardType="number-pad"
        suffix="steps"
        error={error}
      />
      <Text style={editStyles.note}>Your steps come from Apple Health.</Text>
    </TargetEditScreen>
  );
}
