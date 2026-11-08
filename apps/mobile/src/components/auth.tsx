// Building blocks for the sign-in and Me → Security screens (wireframes v3, rows 1–9).
// Greyscale tokens only, ≥ 44 pt targets, an accessibility label on every control, errors
// announced (accessibilityRole="alert" + live region), and text that wraps under Dynamic Type.
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { FormScreen, LinkButton, PrimaryButton, SecondaryButton } from '@/components/forms';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

export function AuthScreen(props: {
  testID: string;
  back?: { label?: string; onPress: () => void };
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <FormScreen
      testID={props.testID}
      header={
        props.back ? (
          <LinkButton
            plain
            label={`‹ ${props.back.label ?? 'Back'}`}
            accessibilityLabel={props.back.label ?? 'Back'}
            onPress={props.back.onPress}
          />
        ) : undefined
      }
      footer={props.footer}
    >
      <View style={s.top}>
        <Text style={s.title} accessibilityRole="header">
          {props.title}
        </Text>
        {typeof props.lead === 'string' ? <Text style={s.lead}>{props.lead}</Text> : props.lead}
        {props.children}
      </View>
    </FormScreen>
  );
}

/** Body text with one bold span (e.g. the email address). */
export function Lead({ before, bold, after }: { before: string; bold?: string; after?: string }) {
  return (
    <Text style={s.lead}>
      {before}
      {bold ? <Text style={s.bold}>{bold}</Text> : null}
      {after ?? ''}
    </Text>
  );
}

/** Grey card with an optional overline ("GOOD TO KNOW"). */
export function InfoCard({ overline, children }: { overline?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {overline ? <Text style={s.overline}>{overline.toUpperCase()}</Text> : null}
      {typeof children === 'string' ? <Text style={s.cardText}>{children}</Text> : children}
    </View>
  );
}

/** Thick-border alert with a "!" icon (spec 3.4). Announced to screen readers. */
export function AuthAlert({
  title,
  body,
  testID,
  children,
  note,
}: {
  title: string;
  body?: ReactNode;
  testID?: string;
  children?: ReactNode;
  note?: string;
}) {
  return (
    <View
      style={s.alertBox}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      testID={testID ?? 'auth-alert'}
    >
      <View style={s.alert}>
        <View style={s.bang} importantForAccessibility="no">
          <Text style={s.bangText}>!</Text>
        </View>
        <View style={s.alertText}>
          <Text style={s.alertTitle}>{title}</Text>
          {typeof body === 'string' ? <Text style={s.alertBody}>{body}</Text> : body}
        </View>
      </View>
      {children}
      {note ? <Text style={s.alertNote}>{note}</Text> : null}
    </View>
  );
}

/** Small grey note under a field ("Typo? Fix it here and sign in again."). */
export function FieldNote({ children }: { children: string }) {
  return <Text style={s.alertNote}>{children}</Text>;
}

export function FieldError({ children }: { children: string | null | undefined }) {
  if (!children) return null;
  return (
    <Text style={s.fieldError} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

function Field(props: {
  label: string;
  error?: string | null;
  right?: ReactNode;
  input: TextInputProps & { testID?: string };
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{props.label}</Text>
      <View style={[s.inputWrap, props.error ? s.inputError : null]}>
        <TextInput
          {...props.input}
          accessibilityLabel={props.label}
          accessibilityHint={props.error ?? undefined}
          placeholderTextColor={colors.textTertiary}
          style={s.input}
        />
        {props.right}
      </View>
      <FieldError>{props.error}</FieldError>
    </View>
  );
}

export function EmailField(props: {
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  label?: string;
  testID?: string;
  onSubmitEditing?: () => void;
}) {
  return (
    <Field
      label={props.label ?? 'Email'}
      error={props.error}
      input={{
        value: props.value,
        onChangeText: props.onChangeText,
        keyboardType: 'email-address',
        autoCapitalize: 'none',
        autoCorrect: false,
        autoComplete: 'email',
        textContentType: 'username',
        inputMode: 'email',
        returnKeyType: 'next',
        onSubmitEditing: props.onSubmitEditing,
        testID: props.testID ?? 'field-email',
      }}
    />
  );
}

/**
 * Password field (spec 5.2): secure entry, the right autofill hints, Show/Hide that only toggles
 * masking. The parent owns the value and must clear it after any error and on leaving.
 */
export function PasswordField(props: {
  label?: string;
  kind: 'new' | 'current';
  value: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  testID?: string;
  onSubmitEditing?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const label = props.label ?? 'Password';
  const webRules =
    Platform.OS === 'web' && props.kind === 'new'
      ? ({ passwordrules: 'minlength: 15; maxlength: 128;' } as object)
      : {};
  return (
    <Field
      label={label}
      error={props.error}
      input={{
        ...webRules,
        value: props.value,
        onChangeText: props.onChangeText,
        secureTextEntry: !shown,
        autoCapitalize: 'none',
        autoCorrect: false,
        spellCheck: false,
        autoComplete: props.kind === 'new' ? 'new-password' : 'current-password',
        textContentType: props.kind === 'new' ? 'newPassword' : 'password',
        passwordRules: props.kind === 'new' ? 'minlength: 15; maxlength: 128;' : undefined,
        onSubmitEditing: props.onSubmitEditing,
        testID: props.testID ?? 'field-password',
      }}
      right={
        <Pressable
          onPress={() => setShown((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          style={s.show}
          hitSlop={4}
        >
          <Text style={s.showText}>{shown ? 'Hide' : 'Show'}</Text>
        </Pressable>
      }
    />
  );
}

export interface Rule {
  label: string;
  /** true = met, false = failed, null = not checked yet. */
  ok: boolean | null;
}

/** "YOUR PASSWORD" rule list, ticked live (0b-3a/3b). */
export function RuleList({ rules, title = 'Your password' }: { rules: Rule[]; title?: string }) {
  return (
    <View
      style={s.card}
      accessible
      accessibilityLabel={`${title}: ${rules.map((r) => `${r.label}, ${r.ok ? 'done' : r.ok === false ? 'not met' : 'not yet'}`).join('; ')}`}
    >
      <Text style={s.overline}>{title.toUpperCase()}</Text>
      {rules.map((r) => (
        <View key={r.label} style={s.rule}>
          <View style={[s.tick, r.ok ? s.tickOn : null]} importantForAccessibility="no">
            {r.ok ? (
              <Text style={s.tickMark}>✓</Text>
            ) : r.ok === false ? (
              <Text style={s.cross}>×</Text>
            ) : null}
          </View>
          <Text style={[s.ruleText, r.ok === false && s.ruleFailed]}>{r.label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Six-digit code boxes (0b-4). One hidden input drives them, so paste and iOS/Android one-time
 * code autofill fill all six at once; the 6th digit submits.
 */
export function CodeInput(props: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<React.ComponentRef<typeof TextInput>>(null);
  const digits = props.value.padEnd(6, ' ').slice(0, 6).split('');
  return (
    <Pressable
      onPress={() => ref.current?.focus()}
      accessibilityLabel="6-digit code"
      accessibilityRole="none"
      style={s.codeRow}
    >
      {digits.map((d, i) => (
        <View
          key={i}
          style={[
            s.codeBox,
            props.error && s.codeBoxError,
            i === props.value.length && s.codeBoxActive,
          ]}
          importantForAccessibility="no"
        >
          <Text style={s.codeDigit}>{d.trim()}</Text>
        </View>
      ))}
      <TextInput
        ref={ref}
        testID="field-code"
        value={props.value}
        editable={!props.disabled}
        onChangeText={(t) => {
          const v = t.replace(/\D/g, '').slice(0, 6);
          props.onChange(v);
          if (v.length === 6) props.onComplete(v);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        accessibilityLabel="6-digit code"
        autoFocus
        style={s.codeHidden}
      />
    </Pressable>
  );
}

export function ProviderButton(props: {
  provider: 'APPLE' | 'GOOGLE';
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  primary?: boolean;
}) {
  const icon = (
    <View
      style={
        props.provider === 'APPLE'
          ? props.primary !== false
            ? s.appleGlyphInverse
            : s.appleGlyph
          : s.googleGlyph
      }
    />
  );
  return (props.primary ?? props.provider === 'APPLE') ? (
    <PrimaryButton
      label={props.label}
      icon={icon}
      busy={props.busy}
      disabled={props.disabled}
      onPress={props.onPress}
    />
  ) : (
    <SecondaryButton
      label={props.label}
      icon={icon}
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
    />
  );
}

/** Bordered group of rows with a bold heading (S-1 "Signing in", "Coming later"). */
export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.group}>
      {title ? (
        <Text style={s.groupTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={s.groupBox}>{children}</View>
    </View>
  );
}

export function ListRow(props: {
  label: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  pill?: string;
  muted?: boolean;
  first?: boolean;
  action?: ReactNode;
  testID?: string;
}) {
  const body = (
    <>
      <View style={s.rowText}>
        <Text style={[s.rowLabel, props.muted && s.rowMuted]}>{props.label}</Text>
        {props.subtitle ? <Text style={s.rowSub}>{props.subtitle}</Text> : null}
      </View>
      {props.value ? <Text style={s.rowValue}>{props.value}</Text> : null}
      {props.pill ? (
        <View style={s.pill}>
          <Text style={s.pillText}>{props.pill}</Text>
        </View>
      ) : null}
      {props.action}
      {props.onPress ? (
        <Text style={s.chevron} importantForAccessibility="no">
          ›
        </Text>
      ) : null}
    </>
  );
  const style = [s.listRow, !props.first && s.listRowDivider];
  return props.onPress ? (
    <Pressable
      testID={props.testID}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={[props.label, props.subtitle, props.value].filter(Boolean).join(', ')}
      style={({ pressed }) => [...style, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  ) : (
    <View
      style={style}
      testID={props.testID}
      accessible={!props.action}
      accessibilityLabel={[props.label, props.subtitle, props.value, props.pill]
        .filter(Boolean)
        .join(', ')}
    >
      {body}
    </View>
  );
}

/** Seconds left until `untilMs` (ticks every second, 0 when done). */
export function useCountdown(untilMs: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!untilMs || untilMs <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [untilMs]);
  return untilMs ? Math.max(0, Math.ceil((untilMs - now) / 1000)) : 0;
}

export const authStyles = StyleSheet.create({
  note: { ...type.callout, color: colors.textSecondary, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  body: { ...type.body, color: colors.textSecondary, lineHeight: 24 },
});

const s = StyleSheet.create({
  top: { gap: space.lg, paddingTop: space.sm },
  title: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.text,
    lineHeight: 35,
  },
  lead: { ...type.body, color: colors.textSecondary, lineHeight: 24 },
  bold: { fontWeight: '700', color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  overline: { ...type.caption, fontWeight: '600', letterSpacing: 1.2, color: colors.textSecondary },
  cardText: { ...type.callout, color: colors.textSecondary, lineHeight: 22 },
  alertBox: {
    gap: space.md,
    borderWidth: 2.5,
    borderColor: colors.fill,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  alert: { flexDirection: 'row', gap: space.md },
  alertNote: { ...type.footnote, fontSize: 14, color: colors.textSecondary, lineHeight: 19 },
  bang: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bangText: { color: colors.inverseText, fontWeight: '800', fontSize: 15 },
  alertText: { flex: 1, gap: 2 },
  alertTitle: { ...type.headline, color: colors.text },
  alertBody: { ...type.callout, color: colors.textSecondary, lineHeight: 21 },
  alertBold: { fontWeight: '700', color: colors.text },
  field: { gap: space.xs },
  label: { ...type.footnote, fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  inputWrap: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: '#949494',
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space.lg,
  },
  inputError: { borderWidth: 2.5, borderColor: colors.fill },
  input: { flex: 1, ...type.body, color: colors.text, paddingVertical: space.sm },
  show: {
    minHeight: MIN_TOUCH,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  showText: {
    ...type.callout,
    fontWeight: '600',
    color: colors.text,
    textDecorationLine: 'underline',
  },
  fieldError: { ...type.callout, color: colors.text, fontWeight: '600' },
  rule: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  tick: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#949494',
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.fill, borderColor: colors.fill },
  tickMark: { color: colors.inverseText, fontSize: 11, fontWeight: '800' },
  cross: { color: colors.text, fontSize: 13, fontWeight: '800', lineHeight: 14 },
  ruleText: { ...type.callout, color: colors.text, flex: 1 },
  ruleFailed: { fontWeight: '600' },
  codeRow: { flexDirection: 'row', gap: space.sm, justifyContent: 'space-between' },
  codeBox: {
    flex: 1,
    aspectRatio: 0.85,
    maxWidth: 52,
    minHeight: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: '#949494',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxActive: { borderColor: colors.fill, borderWidth: 2 },
  codeBoxError: { borderColor: colors.fill, borderWidth: 3 },
  codeDigit: { fontSize: 24, fontWeight: '700', color: colors.text },
  codeHidden: { position: 'absolute', opacity: 0.011, width: '100%', height: '100%' },
  group: { gap: space.sm },
  groupTitle: { ...type.callout, fontWeight: '700', color: colors.text },
  groupBox: { borderWidth: 1.5, borderColor: '#D9D9D9', borderRadius: 14, overflow: 'hidden' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: 10,
    paddingHorizontal: space.lg,
  },
  listRowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowMuted: { color: colors.textSecondary },
  rowSub: { fontSize: 14, color: colors.textSecondary, lineHeight: 19 },
  rowValue: { ...type.callout, color: colors.textSecondary, flexShrink: 1, textAlign: 'right' },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#949494',
  },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chevron: { fontSize: 22, color: colors.textSecondary },
  appleGlyph: { width: 18, height: 18, borderRadius: 5, backgroundColor: colors.fill },
  appleGlyphInverse: {
    width: 18,
    height: 18,
    borderRadius: 5,
    backgroundColor: colors.inverseText,
  },
  googleGlyph: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.fillMuted },
});
