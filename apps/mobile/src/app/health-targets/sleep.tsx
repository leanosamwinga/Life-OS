import { useState } from 'react';
import { Text, View } from 'react-native';
import { TextField } from '@/components/forms';
import { editStyles, TargetEditScreen } from '@/features/targets/EditScreen';
import { parseSleepTarget } from '@/features/targets/parse';
import { useSession } from '@/lib/session';

/** Health targets → Sleep: a night's target, e.g. 7h 30m (Week and Month compare with it). */
export default function SleepTargetScreen() {
  const session = useSession();
  const current = session.settings?.health.sleepMin ?? null;
  const [hours, setHours] = useState(current == null ? '' : String(Math.floor(current / 60)));
  const [minutes, setMinutes] = useState(
    current == null ? '' : String(current % 60).padStart(2, '0'),
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <TargetEditScreen
      title="Sleep"
      testID="screen-target-sleep"
      onSave={async () => {
        const r = parseSleepTarget(hours, minutes);
        if (!r.ok) {
          setError(r.error);
          return false;
        }
        await session.updateSettings({ health: { sleepMin: r.value } });
        return true;
      }}
    >
      <View style={editStyles.row}>
        <View style={editStyles.cell}>
          <TextField
            label="Hours"
            value={hours}
            onChangeText={(t) => {
              setHours(t);
              setError(null);
            }}
            keyboardType="number-pad"
            suffix="h"
          />
        </View>
        <View style={editStyles.cell}>
          <TextField
            label="Minutes"
            value={minutes}
            onChangeText={(t) => {
              setMinutes(t);
              setError(null);
            }}
            keyboardType="number-pad"
            suffix="m"
          />
        </View>
      </View>
      {error ? (
        <Text style={editStyles.note} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Text style={editStyles.note}>
        A night’s sleep, e.g. 7 h 30 m. Your sleep comes from Apple Health.
      </Text>
    </TargetEditScreen>
  );
}
