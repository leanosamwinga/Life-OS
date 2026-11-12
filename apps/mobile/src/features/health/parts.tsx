import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** A large number: "82.4 kg", "6,240". */
export function Big({ children, size = 32 }: { children: ReactNode; size?: number }) {
  return <Text style={[styles.big, { fontSize: size }]}>{children}</Text>;
}

export function Muted({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={styles.muted} testID={testID}>
      {children}
    </Text>
  );
}

export function Body({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text style={styles.body} testID={testID}>
      {children}
    </Text>
  );
}

/** Underlined text link with a ≥44 pt target ("Open Settings ↗", "Log workout in Liftoff ↗"). */
export function TextLink(props: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  center?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="link"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityHint={props.accessibilityHint}
      style={[styles.link, props.center && styles.center]}
      testID={props.testID}
    >
      <Text style={styles.linkText}>{props.label}</Text>
    </Pressable>
  );
}

/** Dark or outlined button with a ≥44 pt target. */
export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: 'dark' | 'outline';
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  flex?: boolean;
  testID?: string;
}) {
  const dark = (props.variant ?? 'dark') === 'dark';
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || props.busy}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: Boolean(props.disabled || props.busy), busy: props.busy }}
      style={[
        styles.button,
        dark ? styles.buttonDark : styles.buttonOutline,
        props.flex && styles.flex,
        (props.disabled || props.busy) && styles.disabled,
      ]}
      testID={props.testID}
    >
      <Text style={[styles.buttonText, dark && styles.buttonTextDark]}>{props.label}</Text>
    </Pressable>
  );
}

/** Progress bar (8 pt for the main value, 6 pt for macros). */
export function Bar(props: {
  label?: string;
  value?: string;
  fraction: number;
  thick?: boolean;
  accessibilityLabel: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, props.fraction)) * 100);
  return (
    <View
      style={styles.bar}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
    >
      {props.label ? (
        <View style={styles.barLabels}>
          <Text style={styles.barLabel}>{props.label}</Text>
          <Text style={styles.barValue}>{props.value}</Text>
        </View>
      ) : null}
      <View style={[styles.track, props.thick && styles.trackThick]}>
        <View style={[styles.fill, props.thick && styles.trackThick, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

/** The kcal ring on Nutrition (1B): value and "of 2,450 kcal" inside. */
export function KcalRing(props: { fraction: number; value: string; caption: string }) {
  const size = 104;
  const stroke = 10;
  const r = 44;
  const c = 2 * Math.PI * r;
  const f = Math.min(1, Math.max(0, props.fraction));
  return (
    <View style={{ width: size, height: size }} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 104 104">
        <Circle cx={52} cy={52} r={r} stroke={colors.track} strokeWidth={stroke} fill="none" />
        {f > 0 ? (
          <Circle
            cx={52}
            cy={52}
            r={r}
            stroke={colors.fill}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${(c * f).toFixed(1)} ${c.toFixed(1)}`}
            transform="rotate(-90 52 52)"
          />
        ) : null}
      </Svg>
      <View style={styles.ringCentre}>
        <Text style={styles.ringValue}>{props.value}</Text>
        <Text style={styles.ringCaption}>{props.caption}</Text>
      </View>
    </View>
  );
}

/** 8a: a dashed empty ring with "—". */
export function DashedRing() {
  return (
    <View style={styles.dashedRing} importantForAccessibility="no-hide-descendants">
      <Svg width={72} height={72} viewBox="0 0 104 104">
        <Circle
          cx={52}
          cy={52}
          r={44}
          stroke={colors.border}
          strokeDasharray="6 6"
          strokeWidth={10}
          fill="none"
        />
      </Svg>
      <View style={styles.ringCentre}>
        <Text style={styles.dash}>—</Text>
      </View>
    </View>
  );
}

/** A section heading inside a screen (1B "Body", "Intake", "Training"). */
export function Section({ title }: { title: string }) {
  return (
    <Text style={styles.section} accessibilityRole="header">
      {title}
    </Text>
  );
}

/** Two cards side by side (Sleep | Steps). */
export function Pair({ children }: { children: ReactNode }) {
  return <View style={styles.pair}>{children}</View>;
}

export const healthStyles = StyleSheet.create({
  half: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  baseline: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  gap: { gap: space.sm },
  right: { alignItems: 'flex-end' },
});

const styles = StyleSheet.create({
  big: { fontWeight: '700', color: colors.text, letterSpacing: -0.4 },
  muted: { ...type.footnote, color: colors.textSecondary, lineHeight: 18 },
  body: { ...type.callout, color: colors.text, lineHeight: 21 },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  center: { alignSelf: 'center' },
  linkText: {
    ...type.callout,
    fontWeight: '600',
    color: colors.text,
    textDecorationLine: 'underline',
  },
  button: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  buttonDark: { backgroundColor: colors.fill },
  buttonOutline: { borderWidth: 1, borderColor: colors.text, backgroundColor: colors.background },
  buttonText: { ...type.callout, fontWeight: '600', color: colors.text },
  buttonTextDark: { color: colors.inverseText },
  disabled: { opacity: 0.5 },
  bar: { gap: 6 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { fontSize: 14, color: colors.text },
  barValue: { fontSize: 14, color: colors.textSecondary },
  track: { height: 6, borderRadius: 6, backgroundColor: colors.track, overflow: 'hidden' },
  trackThick: { height: 8, borderRadius: 8 },
  fill: { height: 6, borderRadius: 6, backgroundColor: colors.fill },
  ringCentre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  ringCaption: { fontSize: 11, color: colors.textSecondary },
  dashedRing: { width: 72, height: 72 },
  dash: { fontSize: 16, fontWeight: '700', color: colors.text },
  section: { ...type.title, fontSize: 20, color: colors.text, marginTop: space.md },
  pair: { flexDirection: 'row', gap: space.md },
});
