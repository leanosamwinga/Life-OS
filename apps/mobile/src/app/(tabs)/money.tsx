import { StyleSheet, Text, View } from 'react-native';
import { Card, ComingIn, Overline, PlaceholderBlock, Screen } from '@/components/ui';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

const SECTIONS = [
  'Banking · monthly CSV',
  'ISAs & investments',
  'Last month · closed',
  'Next month outlook',
  'Due in the next 10 days',
  'Savings goals',
];

export default function MoneyScreen() {
  return (
    <Screen title="Money" testID="screen-money">
      <Overline>Net worth</Overline>
      <Text style={styles.netWorth} accessibilityLabel="Net worth not available yet">
        —
      </Text>
      <Text style={styles.caption}>Appears after your first statement import</Text>

      <View style={styles.importCard}>
        <View style={styles.importText}>
          <Text style={styles.headline}>Statements</Text>
          <Text style={styles.caption}>Monthly import reminder on the 1st</Text>
        </View>
        <View
          style={styles.importButton}
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityLabel="Import, coming in phase 5"
        >
          <Text style={styles.importButtonText}>Import</Text>
        </View>
      </View>

      {SECTIONS.map((title) => (
        <Card key={title} title={title}>
          <PlaceholderBlock height={14} />
          <PlaceholderBlock height={14} width="70%" />
        </Card>
      ))}
      <ComingIn phase={5} what="Money (amounts stored as integer pence)" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  netWorth: { fontSize: 40, fontWeight: '700', color: colors.text, marginTop: space.xs },
  caption: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  headline: { ...type.headline, color: colors.text },
  importCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginVertical: space.lg,
  },
  importText: { flex: 1 },
  importButton: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.fillMuted,
    backgroundColor: colors.background,
    justifyContent: 'center',
    opacity: 0.6,
  },
  importButtonText: { ...type.headline, color: colors.text },
});
