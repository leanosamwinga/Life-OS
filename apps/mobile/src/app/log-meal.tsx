import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '@/theme';

/** Placeholder for the Log meal flow (wireframes 7a–7e), built in phase 2. */
export default function LogMealScreen() {
  return (
    <View style={styles.wrap} accessible accessibilityLabel="Log meal. Coming in phase 2.">
      <Text style={styles.title}>Roster or new</Text>
      <Text style={styles.body}>The log meal flow arrives in phase 2.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, backgroundColor: colors.background },
  title: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.textSecondary, marginTop: space.sm },
});
