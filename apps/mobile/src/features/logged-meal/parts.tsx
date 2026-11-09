import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatKcal, type AmountUnit, type Macros } from '@life-os/core';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** "0" for zero, else one decimal place (as on 7b). */
export const g1 = (n: number) => (n === 0 ? '0' : n.toFixed(1));

/** "233 kcal · P 8.1 · C 39.6 · F 4.1". */
export const macroLine = (m: Macros) =>
  `${formatKcal(m.kcal)} kcal · P ${g1(m.protein)} · C ${g1(m.carbs)} · F ${g1(m.fat)}`;

const UNIT_WORD: Record<AmountUnit, string> = { g: 'grams', ml: 'millilitres' };

/**
 * The g / ml switch beside an amount (7d-U, 7h-U, 7k-U). Two buttons; VoiceOver reads
 * "Sample protein shake in grams" / "… in millilitres" with the selected one marked.
 */
export function UnitToggle(props: {
  value: AmountUnit;
  onChange: (u: AmountUnit) => void;
  /** What's being measured, for VoiceOver: "Sample protein shake". */
  what: string;
  size?: 'small' | 'large';
  disabled?: boolean;
  testID?: string;
  /** Visible labels (7e-U: "per 100 g" / "per 100 ml"); VoiceOver reads `a11y` with them. */
  labels?: Record<AmountUnit, string>;
  a11y?: (u: AmountUnit) => string;
}) {
  const large = props.size === 'large';
  return (
    <View
      style={[styles.toggle, large && styles.toggleLarge]}
      accessibilityRole="radiogroup"
      accessibilityLabel={`Unit for ${props.what}`}
      testID={props.testID}
    >
      {(['g', 'ml'] as const).map((u) => {
        const on = props.value === u;
        return (
          <Pressable
            key={u}
            onPress={() => props.onChange(u)}
            disabled={props.disabled}
            accessibilityRole="radio"
            accessibilityLabel={props.a11y ? props.a11y(u) : `${props.what} in ${UNIT_WORD[u]}`}
            accessibilityState={{ checked: on, ...(props.disabled ? { disabled: true } : {}) }}
            style={[styles.option, large && styles.optionLarge, on && styles.optionOn]}
          >
            <Text style={[styles.optionText, on && styles.optionTextOn]}>
              {props.labels?.[u] ?? u}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small outlined padlock (7k: amounts can't be changed here). */
export function LockIcon() {
  return (
    <View style={styles.lock} importantForAccessibility="no" accessibilityElementsHidden>
      <View style={styles.shackle} />
      <View style={styles.lockBody} />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: colors.fill,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  toggleLarge: { alignSelf: 'stretch' },
  option: {
    minWidth: 52,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  optionLarge: { minWidth: 60, flex: 1 },
  optionOn: { backgroundColor: colors.fill },
  optionText: { ...type.headline, color: colors.text },
  optionTextOn: { color: colors.inverseText },
  lock: { width: 14, height: 16, alignItems: 'center', marginRight: space.md, marginTop: 4 },
  shackle: {
    width: 8,
    height: 7,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: colors.textSecondary,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  lockBody: {
    width: 12,
    height: 8,
    borderWidth: 1.5,
    borderColor: colors.textSecondary,
    borderRadius: 2,
  },
});
