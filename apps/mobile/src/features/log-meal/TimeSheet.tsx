import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import {
  clampPick,
  isPickable,
  pickedLine,
  pickerDays,
  pickerHint,
  pickerLatest,
  pickerLimitNote,
  formatDateUK,
  wheelTime,
  wheelValues,
  type LocalDate,
  type LocalTime,
} from '@life-os/core';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** A sheet from the bottom with a grabber (7i, 7l). */
export function BottomSheet(props: {
  visible: boolean;
  onClose: () => void;
  testID: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={props.onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={styles.sheet} accessibilityViewIsModal testID={props.testID}>
          <View style={styles.grabber} />
          {props.children}
        </View>
      </View>
    </Modal>
  );
}

const ROW = 40;
const VISIBLE = 5;
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * One scroll wheel (hours or minutes). Scrolls and snaps like the iOS wheel; a tap on a row picks
 * it (handy with a mouse on the web); VoiceOver treats it as one adjustable control (swipe up or
 * down). Values past the limit are greyed out and struck through, and can't be chosen.
 */
export function Wheel(props: {
  label: string;
  values: readonly number[];
  value: number;
  onChange: (v: number) => void;
  isDisabled: (v: number) => boolean;
  testID: string;
}) {
  const ref = useRef<ScrollViewInstance>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = Math.max(0, props.values.indexOf(props.value));

  useEffect(() => {
    ref.current?.scrollTo?.({ y: index * ROW, animated: false });
  }, [index]);
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const choose = (i: number) => {
    const clampedIndex = Math.min(props.values.length - 1, Math.max(0, i));
    const v = props.values[clampedIndex]!;
    props.onChange(v);
    // A disabled value is held to the limit by the parent: snap back to the last allowed row.
    let shown = clampedIndex;
    while (shown > 0 && props.isDisabled(props.values[shown]!)) shown--;
    ref.current?.scrollTo?.({ y: shown * ROW, animated: true });
  };
  const fromOffset = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    Math.round(e.nativeEvent.contentOffset.y / ROW);

  return (
    <View
      style={styles.wheel}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={props.label}
      accessibilityValue={{ text: pad2(props.value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
        const next = props.values[index + step];
        if (next != null && !props.isDisabled(next)) props.onChange(next);
      }}
      testID={props.testID}
    >
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: index * ROW }}
        contentContainerStyle={{ paddingVertical: ROW * Math.floor(VISIBLE / 2) }}
        onMomentumScrollEnd={(e) => choose(fromOffset(e))}
        onScrollEndDrag={(e) => {
          if (Platform.OS === 'web') return;
          const i = fromOffset(e);
          if (settle.current) clearTimeout(settle.current);
          // Without momentum there's no momentum end event; settle on the row under the band.
          settle.current = setTimeout(() => choose(i), 150);
        }}
        onScroll={(e) => {
          if (Platform.OS !== 'web') {
            if (settle.current) clearTimeout(settle.current);
            return;
          }
          // The web has no scroll-end events: settle once scrolling stops.
          const i = fromOffset(e);
          if (settle.current) clearTimeout(settle.current);
          settle.current = setTimeout(() => {
            if (i !== index) choose(i);
          }, 140);
        }}
        scrollEventThrottle={16}
      >
        {props.values.map((v, i) => {
          const off = props.isDisabled(v);
          const on = i === index;
          return (
            <Pressable
              key={v}
              onPress={() => choose(i)}
              style={styles.row}
              importantForAccessibility="no"
              testID={`${props.testID}-${pad2(v)}`}
            >
              <Text style={[styles.value, on && styles.valueOn, off && styles.valueOff]}>
                {pad2(v)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const HOURS = wheelValues(23);
const MINUTES = wheelValues(59);

/**
 * 7i Pick a time: "Time eaten", Today / Yesterday and 24-hour wheels. From yesterday 00:00 up to
 * an hour from now; later times are greyed out, and a choice past the limit is held to it with a
 * note saying why.
 */
export function TimeSheet(props: {
  visible: boolean;
  now: Date;
  start: { date: LocalDate; time: LocalTime };
  onCancel: () => void;
  onDone: (date: LocalDate, time: LocalTime) => void;
}) {
  const [date, setDate] = useState(props.start.date);
  const [time, setTime] = useState(props.start.time);
  const [hitLimit, setHitLimit] = useState(false);

  // Each opening starts from the time it was opened with.
  useEffect(() => {
    if (!props.visible) return;
    const c = clampPick(props.start.date, props.start.time, props.now);
    setDate(props.start.date);
    setTime(c.time);
    setHitLimit(false);
  }, [props.visible, props.start.date, props.start.time, props.now]);

  const pick = (d: LocalDate, t: LocalTime) => {
    const c = clampPick(d, t, props.now);
    setDate(d);
    setTime(c.time);
    setHitLimit(c.clamped);
  };
  const h = Number(time.slice(0, 2));
  const m = Number(time.slice(3, 5));
  const latest = pickerLatest(date, props.now);
  const note = pickerLimitNote(latest);

  return (
    <BottomSheet visible={props.visible} onClose={props.onCancel} testID="sheet-7i">
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
        <Pressable
          onPress={() => props.onDone(date, time)}
          accessibilityRole="button"
          accessibilityLabel={`Done, ${pickedLine(date, time, props.now)}`}
          style={[styles.headSide, styles.headRight]}
          testID="time-done"
        >
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.days} accessibilityRole="tablist">
        {pickerDays(props.now).map((d) => {
          const on = d.date === date;
          return (
            <Pressable
              key={d.label}
              onPress={() => pick(d.date, time)}
              accessibilityRole="tab"
              accessibilityLabel={`${d.label}, ${formatDateUK(d.date)}`}
              accessibilityState={{ selected: on }}
              style={[styles.day, on && styles.dayOn]}
            >
              <Text style={[styles.dayLabel, !on && styles.dayLabelOff]}>{d.label}</Text>
              <Text style={styles.dayDate}>{formatDateUK(d.date)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.wheels}>
        <View style={styles.band} pointerEvents="none" />
        <Wheel
          label="Hour"
          testID="wheel-hour"
          values={HOURS}
          value={h}
          isDisabled={(v) => !isPickable(date, v, null, props.now)}
          onChange={(v) => pick(date, wheelTime(v, m))}
        />
        <Text style={styles.colon} importantForAccessibility="no">
          :
        </Text>
        <Wheel
          label="Minute"
          testID="wheel-minute"
          values={MINUTES}
          value={m}
          isDisabled={(v) => !isPickable(date, h, v, props.now)}
          onChange={(v) => pick(date, wheelTime(h, v))}
        />
      </View>

      <View style={styles.summary}>
        <Text style={styles.chosen} accessibilityLiveRegion="polite" testID="time-chosen">
          {pickedLine(date, time, props.now)}
        </Text>
        <Text style={styles.hint}>{pickerHint(date, props.now)}</Text>
      </View>
      {hitLimit ? (
        <View style={styles.limit} testID="time-limit" accessibilityLiveRegion="polite">
          <Text style={styles.limitText}>
            <Text style={styles.bold}>{note.bold}</Text> {note.rest}
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    gap: space.md,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginBottom: space.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  headSide: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center' },
  headRight: { alignItems: 'flex-end' },
  cancel: { ...type.body, color: colors.textSecondary },
  title: { ...type.headline, color: colors.text, flex: 1.4, textAlign: 'center' },
  done: { ...type.headline, color: colors.text },
  days: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 4,
  },
  day: {
    flex: 1,
    minHeight: MIN_TOUCH + 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  dayOn: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayLabel: { ...type.headline, color: colors.text },
  dayLabelOff: { fontWeight: '400' },
  dayDate: { ...type.footnote, color: colors.textSecondary },
  wheels: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: ROW * VISIBLE,
    marginTop: space.sm,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ROW * Math.floor(VISIBLE / 2),
    height: ROW,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  wheel: { width: 96, height: ROW * VISIBLE },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 20, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  valueOn: { fontSize: 26, fontWeight: '700', color: colors.text },
  valueOff: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  colon: { fontSize: 26, fontWeight: '700', color: colors.text, marginHorizontal: space.xl },
  summary: { alignItems: 'center', gap: 2, marginTop: space.sm },
  chosen: { ...type.headline, color: colors.text },
  hint: { ...type.footnote, color: colors.textSecondary, textAlign: 'center' },
  limit: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.lg },
  limitText: { ...type.callout, color: colors.text, lineHeight: 21 },
  bold: { fontWeight: '700' },
});
