import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** Full-width dark button (wireframe primary action). */
export function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const disabled = props.disabled || props.busy;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(props.busy) }}
      style={({ pressed }) => [
        styles.primary,
        disabled && styles.disabled,
        pressed && styles.pressed,
        props.style,
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={colors.inverseText} />
      ) : (
        <View style={styles.buttonInner}>
          {props.icon}
          <Text style={styles.primaryText}>{props.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Full-width outlined button. */
export function SecondaryButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      style={({ pressed }) => [
        styles.secondary,
        props.strong && styles.secondaryStrong,
        props.disabled && styles.disabled,
        pressed && styles.pressed,
        props.style,
      ]}
    >
      <View style={styles.buttonInner}>
        {props.icon}
        <Text style={styles.secondaryText}>{props.label}</Text>
      </View>
    </Pressable>
  );
}

/** Underlined text link with a 44 pt target. */
export function LinkButton(props: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  muted?: boolean;
  /** No underline, left-aligned — for "‹ Back" and header actions. */
  plain?: boolean;
  align?: 'center' | 'left';
}) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole={props.plain ? 'button' : 'link'}
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.link,
        (props.align === 'left' || (props.plain && props.align !== 'center')) && styles.linkLeft,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.linkText,
          props.plain && styles.linkTextPlain,
          props.muted && styles.linkMuted,
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

export function TextField(
  props: {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    keyboardType?: KeyboardTypeOptions;
    big?: boolean;
    suffix?: string;
    error?: string | null;
    /** The screen shows its own label; the field keeps `label` for VoiceOver. */
    hideLabel?: boolean;
  } & Pick<
    TextInputProps,
    | 'placeholder'
    | 'autoComplete'
    | 'textContentType'
    | 'secureTextEntry'
    | 'autoCapitalize'
    | 'onSubmitEditing'
    | 'returnKeyType'
    | 'autoFocus'
    | 'testID'
  >,
) {
  const { label, big, suffix, error, hideLabel, ...input } = props;
  return (
    <View style={styles.field}>
      {hideLabel ? null : <Text style={styles.fieldLabel}>{label}</Text>}
      <View
        style={[styles.inputWrap, big && styles.inputWrapBig, error ? styles.inputError : null]}
      >
        <TextInput
          {...input}
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          placeholderTextColor={colors.textTertiary}
          style={[styles.input, big && styles.inputBig]}
        />
        {suffix ? <Text style={[styles.suffix, big && styles.suffixBig]}>{suffix}</Text> : null}
      </View>
      {error ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Message under a form, e.g. a failed sign-in. */
export function FormMessage({
  children,
  tone = 'error',
}: {
  children: string;
  tone?: 'error' | 'info';
}) {
  return (
    <Text
      style={[styles.message, tone === 'info' && styles.messageInfo]}
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
    >
      {children}
    </Text>
  );
}

/** Checkbox row (wireframe 0f). */
export function CheckRow(props: {
  label: string;
  subtitle?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={() => props.onToggle(!props.checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked }}
      accessibilityLabel={props.label}
      accessibilityHint={props.subtitle}
      style={({ pressed }) => [
        styles.checkRow,
        !props.last && styles.divider,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.checkText}>
        <Text style={styles.checkLabel}>{props.label}</Text>
        {props.subtitle ? <Text style={styles.checkSubtitle}>{props.subtitle}</Text> : null}
      </View>
      <View style={[styles.box, props.checked && styles.boxOn]}>
        {props.checked ? <Text style={styles.tick}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

/** Segmented progress bar for onboarding, e.g. 2 of 5. */
export function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <View
      style={styles.progress}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: step }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.progressSeg, i < step && styles.progressSegOn]} />
      ))}
    </View>
  );
}

/** A full-height form screen: header, scrollable body, pinned footer. No tab-style large title. */
export function FormScreen(props: {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  testID?: string;
  /** iPhone: inset the scroll by the keyboard so the last fields and button stay reachable. */
  keyboardInsets?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']} testID={props.testID}>
      {props.header ? <View style={styles.header}>{props.header}</View> : null}
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={props.keyboardInsets}
      >
        {props.children}
      </ScrollView>
      {props.footer ? <View style={styles.footer}>{props.footer}</View> : null}
    </SafeAreaView>
  );
}

/** Title + lead paragraph used at the top of onboarding and sign-in screens. */
export function Lead({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.lead}>
      <Text style={styles.leadTitle} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.leadBody}>{body}</Text> : null}
    </View>
  );
}

/** Grey app-icon placeholder from the wireframes. */
export function IconTile({ size = 72 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        backgroundColor: colors.track,
      }}
      importantForAccessibility="no"
    />
  );
}

export const formStyles = StyleSheet.create({
  footnote: { ...type.footnote, color: colors.textSecondary, textAlign: 'center' },
  body: { ...type.callout, color: colors.textSecondary },
  greyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
    gap: space.xs,
  },
  outlineCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    marginBottom: space.lg,
  },
  cardText: { ...type.callout, color: colors.text, lineHeight: 22 },
  stack: { gap: space.md },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: MIN_TOUCH + 8,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  body: { paddingHorizontal: space.xl, paddingBottom: space.xxl, flexGrow: 1 },
  footer: {
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  primary: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  primaryText: { ...type.headline, color: colors.inverseText },
  secondary: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  secondaryStrong: { borderWidth: 2, borderColor: colors.fill },
  secondaryText: { ...type.headline, color: colors.text, textAlign: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  link: { minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  linkLeft: { alignItems: 'flex-start' },
  linkText: { ...type.callout, color: colors.text, textDecorationLine: 'underline' },
  linkMuted: { color: colors.textSecondary },
  linkTextPlain: { ...type.body, textDecorationLine: 'none' },
  field: { marginBottom: space.lg },
  fieldLabel: {
    ...type.footnote,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: space.xs,
  },
  inputWrap: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
  },
  inputWrapBig: { minHeight: 76, borderWidth: 2, borderColor: colors.fill },
  inputError: { borderColor: colors.text, borderStyle: 'dashed' },
  // minWidth 0: on the web an <input> otherwise refuses to shrink below its default width.
  input: { flex: 1, minWidth: 0, ...type.body, color: colors.text, paddingVertical: space.sm },
  inputBig: { fontSize: 40, fontWeight: '700' },
  suffix: { ...type.body, color: colors.textSecondary },
  suffixBig: { fontSize: 22 },
  errorText: { ...type.footnote, color: colors.text, marginTop: space.xs },
  message: { ...type.callout, color: colors.text, marginVertical: space.sm },
  messageInfo: { color: colors.textSecondary },
  checkRow: {
    minHeight: MIN_TOUCH + 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  checkText: { flex: 1 },
  checkLabel: { ...type.headline, color: colors.text },
  checkSubtitle: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  box: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.fillMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderColor: colors.fill },
  tick: { fontSize: 16, fontWeight: '700', color: colors.text },
  progress: { flexDirection: 'row', gap: 6, flex: 1, maxWidth: 200 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.track },
  progressSegOn: { backgroundColor: colors.fill },
  lead: { marginTop: space.lg, marginBottom: space.xl, gap: space.sm },
  leadTitle: { fontSize: 32, fontWeight: '700', color: colors.text, lineHeight: 38 },
  leadBody: { ...type.body, color: colors.textSecondary, lineHeight: 24 },
});
