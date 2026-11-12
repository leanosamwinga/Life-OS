import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { FormScreen } from '@/components/forms';
import { useAsync } from '@/features/data/useAsync';
import { targetSummaries } from '@/features/targets/summary';
import { DEFAULT_HEALTH_TARGETS, defaultUserSettings } from '@/lib/backend/settings';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

const ROWS: { key: keyof ReturnType<typeof targetSummaries>; label: string; href: Href }[] = [
  { key: 'weight', label: 'Weight', href: '/health-targets/weight' },
  { key: 'nutrition', label: 'Nutrition', href: '/health-targets/nutrition' },
  { key: 'water', label: 'Water', href: '/health-targets/water' },
  { key: 'sleep', label: 'Sleep', href: '/health-targets/sleep' },
  { key: 'steps', label: 'Steps', href: '/health-targets/steps' },
  { key: 'supplements', label: 'Supplements', href: '/health-targets/supplements' },
  { key: 'training', label: 'Training', href: '/health-targets/training' },
];

/** 6B Me → Health targets: one row per target with its current value. */
export default function HealthTargetsScreen() {
  const session = useSession();
  const live = session.status === 'signedIn' && session.healthConsent;
  const supplements = useAsync(
    live && session.backend ? () => session.backend!.listSupplements() : null,
    [live, session.backend, session.dataVersion],
  );
  const s = targetSummaries(
    session.settings?.targets ?? defaultUserSettings().targets,
    session.settings?.health ?? DEFAULT_HEALTH_TARGETS,
    supplements.data ?? [],
  );
  return (
    <FormScreen
      testID="screen-health-targets"
      header={
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/me'))}
          accessibilityRole="button"
          accessibilityLabel="Back to Me"
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Me</Text>
        </Pressable>
      }
    >
      <Text style={styles.title} accessibilityRole="header">
        Health targets
      </Text>
      <View style={styles.list}>
        {ROWS.map((r, i) => (
          <Pressable
            key={r.key}
            onPress={() => router.push(r.href)}
            accessibilityRole="button"
            accessibilityLabel={`${r.label}: ${s[r.key]}`}
            style={[styles.row, i < ROWS.length - 1 && styles.divider]}
            testID={`target-row-${r.key}`}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={styles.rowValue}>{s[r.key]}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>Weight, sleep and steps come from Apple Health.</Text>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  backText: { ...type.body, fontWeight: '600', color: colors.text },
  title: { fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: space.md },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: space.md,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowValue: { ...type.footnote, color: colors.textSecondary },
  chevron: { fontSize: 22, color: colors.textSecondary },
  note: { ...type.footnote, color: colors.textSecondary },
});
