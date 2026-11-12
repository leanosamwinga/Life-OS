import { useState } from 'react';
import { Text } from 'react-native';
import { TextField } from '@/components/forms';
import { editStyles, TargetEditScreen } from '@/features/targets/EditScreen';
import { parseTargetWeight } from '@/features/targets/parse';
import { useSession } from '@/lib/session';

/** Health targets → Weight: the target the weight line is drawn against. */
export default function WeightTargetScreen() {
  const session = useSession();
  const current = session.settings?.health.weightKg ?? null;
  const [text, setText] = useState(current == null ? '' : current.toFixed(1));
  const [error, setError] = useState<string | null>(null);
  return (
    <TargetEditScreen
      title="Weight"
      testID="screen-target-weight"
      onSave={async () => {
        const r = parseTargetWeight(text);
        if (!r.ok) {
          setError(r.error);
          return false;
        }
        await session.updateSettings({ health: { weightKg: r.value } });
        return true;
      }}
    >
      <TextField
        label="Target weight"
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        keyboardType="decimal-pad"
        suffix="kg"
        error={error}
      />
      <Text style={editStyles.note}>
        Your weight itself comes from Apple Health. Leave blank for no target.
      </Text>
    </TargetEditScreen>
  );
}
