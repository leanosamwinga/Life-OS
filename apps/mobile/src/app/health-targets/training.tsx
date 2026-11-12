import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TextField } from '@/components/forms';
import { editStyles, TargetEditScreen } from '@/features/targets/EditScreen';
import { parsePerWeek, parseSplit } from '@/features/targets/parse';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, type } from '@/theme';

/** Health targets → Training: sessions a week and the split rotation (Day 1 first). */
export default function TrainingTargetScreen() {
  const session = useSession();
  const h = session.settings?.health;
  const [perWeek, setPerWeek] = useState(String(h?.trainingPerWeek ?? 4));
  const [days, setDays] = useState<string[]>(() => (h?.split.length ? [...h.split] : ['']));
  const [error, setError] = useState<string | null>(null);
  return (
    <TargetEditScreen
      title="Training"
      testID="screen-target-training"
      intro="Health suggests the next day of your split; sets and reps stay in Liftoff."
      onSave={async () => {
        const n = parsePerWeek(perWeek);
        const split = parseSplit(days);
        if (!n.ok || !split.ok) {
          setError(!n.ok ? n.error : !split.ok ? split.error : null);
          return false;
        }
        await session.updateSettings({
          health: { trainingPerWeek: n.value, split: split.value },
        });
        return true;
      }}
    >
      <TextField
        label="Sessions a week"
        value={perWeek}
        onChangeText={(t) => {
          setPerWeek(t);
          setError(null);
        }}
        keyboardType="number-pad"
      />
      <Text style={styles.heading} accessibilityRole="header">
        Split rotation
      </Text>
      {days.map((d, i) => (
        <View key={i} style={styles.dayRow}>
          <View style={editStyles.cell}>
            <TextField
              label={`Day ${i + 1}`}
              value={d}
              placeholder="e.g. Legs"
              onChangeText={(t) => setDays((list) => list.map((x, j) => (j === i ? t : x)))}
            />
          </View>
          <Pressable
            onPress={() => setDays((list) => list.filter((_, j) => j !== i))}
            accessibilityRole="button"
            accessibilityLabel={`Remove Day ${i + 1}`}
            style={styles.remove}
          >
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ))}
      {days.length < 14 ? (
        <Pressable
          onPress={() => setDays((list) => [...list, ''])}
          accessibilityRole="button"
          accessibilityLabel="Add a split day"
          style={styles.add}
        >
          <Text style={styles.addText}>+ Add day</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text style={editStyles.note} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </TargetEditScreen>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.headline, color: colors.text, marginTop: 8, marginBottom: 4 },
  dayRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  remove: { minHeight: MIN_TOUCH, justifyContent: 'center', marginBottom: 16 },
  removeText: { ...type.callout, color: colors.text, textDecorationLine: 'underline' },
  add: {
    minHeight: MIN_TOUCH,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  addText: { ...type.callout, fontWeight: '600', color: colors.text },
});
