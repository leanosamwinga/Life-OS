import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** Banner shown when EXPO_PUBLIC_SUPABASE_* are missing. */
export function NotConnectedBanner() {
  return (
    <View
      style={styles.banner}
      accessible
      accessibilityRole="alert"
      accessibilityLabel="Not connected. Showing sample data."
    >
      <Text style={styles.bannerTitle}>Not connected</Text>
      <Text style={styles.bannerBody}>
        Showing sample data. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to
        connect.
      </Text>
    </View>
  );
}

/** Scrollable screen with a large title, optional subtitle and accessory (e.g. avatar). */
export function Screen(props: {
  title: string;
  subtitle?: string;
  accessory?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
}) {
  const { status } = useSession();
  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID={props.testID}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {status === 'disconnected' && <NotConnectedBanner />}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.largeTitle} accessibilityRole="header">
              {props.title}
            </Text>
            {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}
          </View>
          {props.accessory}
        </View>
        {props.children}
      </ScrollView>
      {props.footer}
    </SafeAreaView>
  );
}

export function Avatar({ size = 60, label }: { size?: number; label: string }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.track }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    />
  );
}

export function Overline({ children }: { children: string }) {
  return (
    <Text style={styles.overline} accessibilityRole="header">
      {children.toUpperCase()}
    </Text>
  );
}

export function SectionTitle({ title, caption }: { title: string; caption?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText} accessibilityRole="header">
        {title}
      </Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

/** Outlined card (wireframe style). `variant="filled"` gives the grey "Elsewhere" card. */
export function Card(props: {
  children: ReactNode;
  variant?: 'outlined' | 'filled' | 'dashed';
  style?: StyleProp<ViewStyle>;
  title?: string;
  trailing?: string;
}) {
  const variant = props.variant ?? 'outlined';
  return (
    <View
      style={[
        styles.card,
        variant === 'filled' && styles.cardFilled,
        variant === 'dashed' && styles.cardDashed,
        props.style,
      ]}
    >
      {props.title ? (
        <View style={styles.cardHeader}>
          <Overline>{props.title}</Overline>
          {props.trailing ? <Text style={styles.caption}>{props.trailing}</Text> : null}
        </View>
      ) : null}
      {props.children}
    </View>
  );
}

/** A tappable list row with a ≥44 pt target. */
export function Row(props: {
  label: string;
  detail?: string;
  subtitle?: string;
  chevron?: boolean;
  pill?: string;
  last?: boolean;
  muted?: boolean;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const content = (
    <>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, props.muted && styles.muted]}>{props.label}</Text>
        {props.subtitle ? <Text style={styles.rowSubtitle}>{props.subtitle}</Text> : null}
      </View>
      {props.detail ? <Text style={styles.rowDetail}>{props.detail}</Text> : null}
      {props.pill ? <Pill label={props.pill} /> : null}
      {props.chevron ? (
        <Text style={styles.chevron} importantForAccessibility="no">
          ›
        </Text>
      ) : null}
    </>
  );
  const a11yLabel = [props.label, props.subtitle, props.detail, props.pill]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      accessibilityRole={props.onPress ? 'button' : 'text'}
      accessibilityLabel={a11yLabel}
      accessibilityHint={props.accessibilityHint}
      style={({ pressed }) => [
        styles.row,
        !props.last && styles.rowDivider,
        pressed && styles.pressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

export function ToggleRow(props: {
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  last?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, !props.last && styles.rowDivider]}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabelStrong}>{props.label}</Text>
        {props.subtitle ? <Text style={styles.rowSubtitle}>{props.subtitle}</Text> : null}
      </View>
      <Switch
        value={props.value}
        onValueChange={props.onValueChange}
        disabled={props.disabled}
        accessibilityLabel={props.label}
        accessibilityHint={props.subtitle}
        trackColor={{ false: colors.track, true: colors.fill }}
        thumbColor={colors.background}
        ios_backgroundColor={colors.track}
        // react-native-web only: keep the thumb greyscale (defaults to teal).
        {...({ activeThumbColor: colors.background } as object)}
      />
    </View>
  );
}

export function Pill({ label, dashed = true }: { label: string; dashed?: boolean }) {
  return (
    <View style={[styles.pill, dashed && styles.pillDashed]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

/** Rounded outline button, e.g. "Ate it". */
export function OutlineButton(props: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      hitSlop={4}
      style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
    >
      <Text style={styles.outlineButtonText}>{props.label}</Text>
    </Pressable>
  );
}

/** Grey bar standing in for content that arrives in a later phase. */
export function PlaceholderBlock({
  height = 12,
  width = '100%',
}: {
  height?: number;
  width?: `${number}%` | number;
}) {
  return <View style={[styles.placeholder, { height, width }]} importantForAccessibility="no" />;
}

export function ComingIn({ phase, what }: { phase: number; what: string }) {
  return (
    <Text style={styles.comingIn}>
      {what} · coming in phase {phase}
    </Text>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: space.xl, paddingBottom: 120 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.lg,
    paddingBottom: space.xl,
    gap: space.lg,
  },
  headerText: { flex: 1 },
  largeTitle: { ...type.largeTitle, color: colors.text },
  subtitle: { ...type.callout, color: colors.textSecondary, marginTop: space.xs },
  banner: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.textTertiary,
  },
  bannerTitle: { ...type.headline, color: colors.text },
  bannerBody: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  overline: { ...type.overline, color: colors.textSecondary },
  sectionTitle: { marginTop: space.xl, marginBottom: space.sm },
  sectionTitleText: { ...type.title, color: colors.text },
  caption: { ...type.footnote, color: colors.textSecondary },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    marginBottom: space.lg,
  },
  cardFilled: { backgroundColor: colors.card, borderColor: colors.card },
  cardDashed: { borderStyle: 'dashed', borderColor: colors.textTertiary },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  row: {
    minHeight: MIN_TOUCH + 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowText: { flex: 1 },
  rowLabel: { ...type.body, color: colors.text },
  rowLabelStrong: { ...type.headline, color: colors.text },
  rowSubtitle: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  rowDetail: { ...type.callout, color: colors.textSecondary, textAlign: 'right', flexShrink: 1 },
  chevron: { fontSize: 22, color: colors.textSecondary, marginLeft: -4 },
  muted: { color: colors.textSecondary },
  pressed: { opacity: 0.6 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
  },
  pillDashed: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.textTertiary,
  },
  pillText: { ...type.footnote, color: colors.textSecondary },
  outlineButton: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.fillMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineButtonText: { ...type.callout, color: colors.text },
  placeholder: { backgroundColor: colors.track, borderRadius: 4, marginVertical: space.xs },
  comingIn: { ...type.footnote, color: colors.textTertiary, paddingVertical: space.sm },
});
