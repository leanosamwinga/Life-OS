import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { FormMessage, FormScreen } from '@/components/forms';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

export const backToTargets = () =>
  router.canGoBack() ? router.back() : router.replace('/health-targets');

/**
 * 6B edit screens and 7: "‹ Health targets" on the left, Save (or Done) on the right, a large
 * title, then the fields. `onSave` returns false to stay (e.g. a field error).
 */
export function TargetEditScreen(props: {
  title: string;
  testID: string;
  intro?: string;
  action?: 'Save' | 'Done';
  onSave: () => Promise<boolean>;
  /** "‹ Health targets" also saves (the supplement list saves as you leave). */
  backSaves?: boolean;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = props.action ?? 'Save';

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (await props.onSave()) backToTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormScreen
      testID={props.testID}
      keyboardInsets
      header={
        <View style={styles.header}>
          <Pressable
            onPress={() => (props.backSaves ? void save() : backToTargets())}
            accessibilityRole="button"
            accessibilityLabel="Back to Health targets"
            style={styles.back}
          >
            <Text style={styles.backText}>‹ Health targets</Text>
          </Pressable>
          <Pressable
            onPress={() => void save()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={action}
            accessibilityState={{ disabled: busy, busy }}
            style={[styles.save, busy && styles.busy]}
            testID="target-save"
          >
            <Text style={styles.saveText}>{action}</Text>
          </Pressable>
        </View>
      }
    >
      <Text style={styles.title} accessibilityRole="header">
        {props.title}
      </Text>
      {props.intro ? <Text style={styles.intro}>{props.intro}</Text> : null}
      {props.children}
      {error ? <FormMessage>{error}</FormMessage> : null}
    </FormScreen>
  );
}

export const editStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
    marginBottom: space.md,
  },
  note: { ...type.footnote, color: colors.textSecondary },
  row: { flexDirection: 'row', gap: space.md },
  cell: { flex: 1 },
});

const styles = StyleSheet.create({
  header: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  backText: { ...type.body, fontWeight: '600', color: colors.text },
  save: {
    minHeight: MIN_TOUCH,
    minWidth: 64,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busy: { opacity: 0.5 },
  saveText: { ...type.callout, fontWeight: '600', color: colors.text },
  title: { fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: space.md },
  intro: { ...type.callout, color: colors.textSecondary, marginBottom: space.md },
});
