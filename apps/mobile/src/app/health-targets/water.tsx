import { useState } from 'react';
import { Text } from 'react-native';
import { TextField } from '@/components/forms';
import { editStyles, TargetEditScreen } from '@/features/targets/EditScreen';
import { parseAmount } from '@/features/targets/parse';
import { useSession } from '@/lib/session';

/** Health targets → Water: the daily amount only ("+ 250 ml" stays as it is on Health). */
export default function WaterTargetScreen() {
  const session = useSession();
  const current = session.settings?.targets.waterMl ?? null;
  const [text, setText] = useState(current == null ? '' : String(current));
  const [error, setError] = useState<string | null>(null);
  return (
    <TargetEditScreen
      title="Water"
      testID="screen-target-water"
      onSave={async () => {
        const r = parseAmount(text, { max: 20000, decimals: 0 });
        if (!r.ok) {
          setError(r.error);
          return false;
        }
        await session.updateSettings({ targets: { waterMl: r.value } });
        return true;
      }}
    >
      <TextField
        label="Water a day"
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        keyboardType="number-pad"
        suffix="ml"
        error={error}
      />
      <Text style={editStyles.note}>For example 3,000 ml. Leave blank for no target.</Text>
    </TargetEditScreen>
  );
}
