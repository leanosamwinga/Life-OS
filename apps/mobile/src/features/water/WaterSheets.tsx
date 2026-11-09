import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  formatMl,
  formatTimeUK,
  parseWaterMl,
  waterNewestFirst,
  WATER_QUICK_AMOUNTS_ML,
  type WaterLog,
} from '@life-os/core';
import { FormMessage, PrimaryButton, SecondaryButton } from '@/components/forms';
import { Chip } from '@/features/log-meal/parts';
import { BottomSheet } from '@/features/log-meal/TimeSheet';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** The sheets' top row: Cancel, the title, and nothing on the right (like 7i without Done). */
function SheetTop(props: { title: string; onCancel: () => void }) {
  return (
    <View style={styles.head}>
      <Pressable
        onPress={props.onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        style={styles.headSide}
      >
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {props.title}
      </Text>
      <View style={styles.headSide} />
    </View>
  );
}

/**
 * 2 Health → Water → "Other amount…": quick amounts (150, 330, 500 ml) or any whole number of ml
 * from 1 to 5,000. Add logs it now.
 */
export function WaterAmountSheet(props: {
  visible: boolean;
  onClose: () => void;
  onAdd: (ml: number) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (props.visible) {
      setText('');
      setError(null);
    }
  }, [props.visible]);

  const parsed = parseWaterMl(text);
  const add = async () => {
    const r = parseWaterMl(text);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onAdd(r.ml);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t add water.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={props.visible} onClose={props.onClose} testID="sheet-water-amount">
      <SheetTop title="Add water" onCancel={props.onClose} />
      <View style={styles.chips} testID="water-quick">
        {WATER_QUICK_AMOUNTS_ML.map((ml) => (
          <Chip
            key={ml}
            label={`${ml} ml`}
            selected={parsed.ok && parsed.ml === ml}
            onPress={() => {
              setText(String(ml));
              setError(null);
            }}
          />
        ))}
      </View>
      <View style={styles.field}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setError(null);
          }}
          placeholder="Any amount"
          placeholderTextColor={colors.textTertiary}
          keyboardType="number-pad"
          accessibilityLabel="Amount of water in ml"
          style={styles.input}
          maxLength={8}
          onSubmitEditing={() => void add()}
          testID="water-ml"
        />
        <Text style={styles.unit} importantForAccessibility="no">
          ml
        </Text>
      </View>
      <Text style={styles.hint}>A whole number from 1 to 5,000 ml.</Text>
      {error ? <FormMessage>{error}</FormMessage> : null}
      <PrimaryButton
        label={parsed.ok ? `Add ${formatMl(parsed.ml)}` : 'Add'}
        busy={busy}
        disabled={text.trim() === ''}
        onPress={() => void add()}
      />
    </BottomSheet>
  );
}

/** 2 Health → tap the water total: today's water, newest first, each with a delete. */
export function TodayWaterSheet(props: {
  visible: boolean;
  onClose: () => void;
  logs: readonly WaterLog[];
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<WaterLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (props.visible) {
      setConfirm(null);
      setError(null);
    }
  }, [props.visible]);

  const list = waterNewestFirst(props.logs);
  const total = props.logs.reduce((s, l) => s + l.ml, 0);
  const remove = async (w: WaterLog) => {
    setBusy(true);
    setError(null);
    try {
      await props.onDelete(w.id);
      setConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t delete that water.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={props.visible} onClose={props.onClose} testID="sheet-water-today">
      <SheetTop title="Today’s water" onCancel={props.onClose} />
      {confirm ? (
        <View style={styles.confirm} testID="water-delete-confirm">
          <Text style={styles.confirmTitle} accessibilityRole="header">
            {`Delete ${formatMl(confirm.ml)} at ${formatTimeUK(confirm.loggedAt)}?`}
          </Text>
          <Text style={styles.hint}>
            {`It comes off today’s water: ${formatMl(total)} → ${formatMl(total - confirm.ml)}.`}
          </Text>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton label="Delete" busy={busy} onPress={() => void remove(confirm)} />
          <SecondaryButton label="Keep it" onPress={() => setConfirm(null)} />
        </View>
      ) : list.length === 0 ? (
        <Text style={styles.hint}>No water logged today yet.</Text>
      ) : (
        <View style={styles.list} testID="water-list">
          <Text style={styles.total}>{`${formatMl(total)} today`}</Text>
          {list.map((w, i) => (
            <View key={w.id} style={[styles.row, i > 0 && styles.divided]}>
              <Text style={styles.rowTime}>{formatTimeUK(w.loggedAt)}</Text>
              <Text style={styles.rowMl}>{formatMl(w.ml)}</Text>
              <Pressable
                onPress={() => setConfirm(w)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${formatMl(w.ml)} at ${formatTimeUK(w.loggedAt)}`}
                style={styles.delete}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  headSide: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center' },
  cancel: { ...type.body, color: colors.textSecondary },
  title: { ...type.headline, color: colors.text, flex: 1.4, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: MIN_TOUCH + 8,
  },
  input: { flex: 1, fontSize: 22, color: colors.text, paddingVertical: space.sm },
  unit: { ...type.body, color: colors.textSecondary },
  hint: { ...type.footnote, color: colors.textSecondary },
  list: { gap: 0 },
  total: { ...type.headline, color: colors.text, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH + 8, gap: space.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowTime: { ...type.callout, color: colors.textSecondary, width: 56 },
  rowMl: { ...type.headline, color: colors.text, flex: 1 },
  delete: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center' },
  deleteText: { ...type.callout, color: colors.text, textDecorationLine: 'underline' },
  confirm: { gap: space.md },
  confirmTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
});
