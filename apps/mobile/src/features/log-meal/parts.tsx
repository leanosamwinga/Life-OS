import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatKcal, type Macros } from '@life-os/core';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** Modal header: left action, centred title, right detail (wireframes 7a–7e). */
export function SheetHeader(props: {
  left: string;
  leftLabel?: string;
  onLeft: () => void;
  title?: string;
  right?: string;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={props.onLeft}
        accessibilityRole="button"
        accessibilityLabel={props.leftLabel ?? props.left}
        hitSlop={8}
        style={styles.headerSide}
      >
        <Text style={styles.headerLeft} numberOfLines={1}>
          {props.left}
        </Text>
      </Pressable>
      {props.title ? (
        <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>
          {props.title}
        </Text>
      ) : null}
      <View style={[styles.headerSide, styles.headerRightWrap]}>
        {props.right ? (
          <Text style={styles.headerRight} numberOfLines={1}>
            {props.right}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const fmt1 = (n: number) => n.toFixed(1);

/** kcal / protein / carbs / fat tiles. */
export function MacroTiles({ macros, grey = true }: { macros: Macros; grey?: boolean }) {
  const tiles: [string, string][] = [
    [formatKcal(macros.kcal), 'kcal'],
    [fmt1(macros.protein), 'protein g'],
    [fmt1(macros.carbs), 'carbs g'],
    [fmt1(macros.fat), 'fat g'],
  ];
  return (
    <View
      style={[styles.tiles, grey && styles.tilesGrey]}
      accessible
      accessibilityLabel={`${formatKcal(macros.kcal)} kcal, protein ${fmt1(macros.protein)} g, carbs ${fmt1(macros.carbs)} g, fat ${fmt1(macros.fat)} g`}
    >
      {tiles.map(([value, label]) => (
        <View key={label} style={styles.tile}>
          <Text style={styles.tileValue}>{value}</Text>
          <Text style={styles.tileLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

/** "Today after this meal": dark = already logged today, light = this meal. */
export function TodayBar(props: { logged: number; meal: number; target: number; label?: string }) {
  const total = props.logged + props.meal;
  const scale = Math.max(props.target, total, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%` as const;
  const detail = props.target
    ? `${formatKcal(total)} / ${formatKcal(props.target)} kcal`
    : `${formatKcal(total)} kcal`;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${props.label ?? 'Today after this meal'}: ${detail}`}
    >
      <View style={styles.barLabels}>
        <Text style={styles.barLabel}>{props.label ?? 'Today after this meal'}</Text>
        <Text style={styles.barDetail}>{detail}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fillDark, { width: pct(props.logged) }]} />
        <View style={[styles.fillLight, { width: pct(props.meal) }]} />
      </View>
    </View>
  );
}

/** Small rounded chip, e.g. "Last time · 60 g". */
export function Chip(props: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: Boolean(props.selected) }}
      style={({ pressed }) => [
        styles.chip,
        props.selected && styles.chipOn,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.chipText, props.selected && styles.chipTextOn]}>{props.label}</Text>
    </Pressable>
  );
}

/** Segmented control (Scan · Search · Manual). */
export function Segmented<T extends string>(props: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {props.options.map((o) => (
        <Pressable
          key={o}
          onPress={() => props.onChange(o)}
          accessibilityRole="tab"
          accessibilityLabel={o}
          accessibilityState={{ selected: props.value === o }}
          style={[styles.segment, props.value === o && styles.segmentOn]}
        >
          <Text style={[styles.segmentText, props.value === o && styles.segmentTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: MIN_TOUCH + 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  headerSide: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center' },
  headerRightWrap: { alignItems: 'flex-end' },
  headerLeft: { ...type.body, color: colors.textSecondary },
  headerTitle: { ...type.headline, color: colors.text, flex: 1.4, textAlign: 'center' },
  headerRight: { ...type.callout, color: colors.textSecondary },
  tiles: { flexDirection: 'row', gap: space.sm },
  tilesGrey: {},
  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  tileValue: { fontSize: 22, fontWeight: '700', color: colors.text },
  tileLabel: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs },
  barLabel: { ...type.callout, color: colors.text },
  barDetail: { ...type.callout, color: colors.textSecondary },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.track,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  fillDark: { height: 8, backgroundColor: colors.fill },
  fillLight: { height: 8, backgroundColor: colors.fillMuted },
  chip: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.fill, borderColor: colors.fill },
  chipText: { ...type.callout, color: colors.text },
  chipTextOn: { color: colors.inverseText },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: space.lg,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentOn: { backgroundColor: colors.background },
  segmentText: { ...type.callout, color: colors.textSecondary },
  segmentTextOn: { color: colors.text, fontWeight: '600' },
});
