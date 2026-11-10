import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, MIN_TOUCH, space, type } from '@/theme';
import { whenSheetNote, type MealSlot, type WhenChoice } from './slots';
import { BottomSheet } from './TimeSheet';

/**
 * 7b-W "Time eaten", opened from Build meal's time chip: the same choices as 7a's WHEN row (Now,
 * the four slots, Other time…), one per row, with a ✓ on the current one. Slots more than an hour
 * ahead are greyed and can't be chosen. Picking a row closes the sheet; nothing in the meal changes.
 */
export function WhenSheet(props: {
  visible: boolean;
  choices: readonly WhenChoice[];
  /** Other time…: whether a picked time is the current choice, and what it is. */
  other: { selected: boolean; picked: string | null };
  onPick: (slot: MealSlot) => void;
  onOther: () => void;
  onCancel: () => void;
  onDismissed?: () => void;
}) {
  return (
    <BottomSheet
      visible={props.visible}
      onClose={props.onCancel}
      onDismissed={props.onDismissed}
      testID="sheet-7b-w"
    >
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
          Time eaten
        </Text>
        <View style={styles.headSide} />
      </View>

      <View>
        {props.choices.map((c) => {
          const now = c.slot.name === 'Now';
          return (
            <Pressable
              key={c.slot.name}
              onPress={() => props.onPick(c.slot)}
              disabled={c.disabled}
              accessibilityRole="button"
              accessibilityLabel={c.a11yLabel}
              accessibilityState={{
                selected: c.selected,
                ...(c.disabled ? { disabled: true } : {}),
              }}
              testID={`when-${c.slot.name.toLowerCase()}`}
              style={({ pressed }) => [styles.row, styles.divider, pressed && styles.pressed]}
            >
              <Text style={[styles.rowText, c.selected && styles.on, c.disabled && styles.off]}>
                {now ? c.label : c.slot.name}
              </Text>
              <View style={styles.right}>
                {now ? null : (
                  <Text style={[styles.rowText, styles.time, c.disabled && styles.off]}>
                    {c.slot.time}
                  </Text>
                )}
                {c.selected ? <Tick /> : null}
              </View>
            </Pressable>
          );
        })}
        <Pressable
          onPress={props.onOther}
          accessibilityRole="button"
          accessibilityLabel={
            props.other.picked ? `Other time: ${props.other.picked}` : 'Other time'
          }
          accessibilityState={{ selected: props.other.selected }}
          testID="when-other"
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Text style={[styles.rowText, props.other.selected && styles.on]}>Other time…</Text>
          <View style={styles.right}>
            {props.other.picked ? (
              <Text style={[styles.rowText, styles.time]}>{props.other.picked}</Text>
            ) : null}
            {props.other.selected ? <Tick /> : null}
            <Text style={styles.chevron}>›</Text>
          </View>
        </Pressable>
      </View>
      <Text style={styles.note} testID="when-note">
        {whenSheetNote(props.choices)}
      </Text>
    </BottomSheet>
  );
}

const Tick = () => (
  <Text style={styles.tick} accessibilityElementsHidden importantForAccessibility="no">
    ✓
  </Text>
);

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  headSide: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center' },
  cancel: { ...type.body, color: colors.textSecondary },
  title: { ...type.headline, color: colors.text, flex: 1.4, textAlign: 'center' },
  row: {
    minHeight: 52,
    paddingHorizontal: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  pressed: { opacity: 0.6 },
  rowText: { ...type.body, color: colors.text },
  on: { fontWeight: '600' },
  off: { color: colors.textTertiary },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  time: { color: colors.textSecondary },
  tick: { fontSize: 18, fontWeight: '700', color: colors.text },
  chevron: { fontSize: 20, color: colors.textSecondary },
  note: { ...type.footnote, color: colors.textSecondary, textAlign: 'center', marginTop: space.xs },
});

/**
 * Open another sheet once this one has gone. iPhone can't present a sheet while another is still
 * sliding away, so there it waits for `onDismissed` (with a fallback in case that never comes);
 * elsewhere it opens at once.
 */
export function useAfterSheet(): { then: (open: () => void) => void; onDismissed: () => void } {
  const next = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const open = next.current;
    next.current = null;
    open?.();
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return {
    then: (open) => {
      if (Platform.OS !== 'ios') {
        open();
        return;
      }
      next.current = open;
      timer.current = setTimeout(run, 600);
    },
    onDismissed: run,
  };
}
