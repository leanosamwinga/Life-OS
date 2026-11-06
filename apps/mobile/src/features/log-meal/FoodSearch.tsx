import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { OPEN_FOOD_FACTS_CREDIT, formatKcal, toFood, type Food } from '@life-os/core';
import { FormMessage, formStyles } from '@/components/forms';
import { Overline } from '@/components/ui';
import type { StoredFood } from '@/lib/backend/foods';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';
import { useLogMeal } from './LogMealContext';

const sourceLabel = (f: { source: string; barcode?: string | null }) =>
  f.source === 'open_food_facts' ? 'Barcode' : 'Your food';

/**
 * Search tab of "Add component" (7c), plus "Or pick a food you've had". Picking a complete
 * food calls `onPick`; picking one with missing nutrition calls `onIncomplete` (if given).
 */
export function FoodSearch(props: {
  onPick: (food: Food) => void;
  onIncomplete?: (record: StoredFood) => void;
  showSearch?: boolean;
  /** Show the Open Food Facts credit under results (off when the screen shows its own). */
  showCredit?: boolean;
}) {
  const session = useSession();
  const lm = useLogMeal();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StoredFood[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showSearch = props.showSearch ?? true;

  useEffect(() => {
    const q = query.trim();
    if (!q || !session.backend) {
      setResults(null);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      session.backend!.searchFoods(q).then(
        (r) => alive && (setResults(r), setError(null)),
        (err: unknown) => alive && setError(err instanceof Error ? err.message : 'Search failed.'),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query, session.backend]);

  const recent = lm.data.recentFoods.map((r) => r.food);
  const shown: { key: string; food: Food | null; record?: StoredFood }[] = results
    ? results.map((r) => ({ key: r.id, food: toFood(r), record: r }))
    : recent.map((f) => ({ key: f.id, food: f }));
  const anyOff = shown.some((s) => (s.food ?? s.record)?.source === 'open_food_facts');

  return (
    <View>
      {showSearch ? (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search foods"
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel="Search foods"
          style={styles.search}
          autoCapitalize="none"
          returnKeyType="search"
        />
      ) : null}
      {error ? <FormMessage>{error}</FormMessage> : null}
      <View style={styles.section}>
        <Overline>{results ? `Results · ${results.length}` : 'Or pick a food you’ve had'}</Overline>
      </View>
      {shown.length === 0 ? (
        <Text style={formStyles.body}>
          {results
            ? 'No foods match. Try another word, scan it, or add it from the label.'
            : 'Foods you log will show up here.'}
        </Text>
      ) : (
        shown.map(({ key, food, record }) => {
          const name = food?.name ?? record?.name ?? 'Unnamed food';
          const src = food ?? record!;
          const sub = food
            ? `${sourceLabel(src)} · ${formatKcal(food.per100g.kcal)} kcal per 100 g`
            : `${sourceLabel(src)} · missing nutrition values`;
          const incomplete = !food;
          const disabled = incomplete && !props.onIncomplete;
          return (
            <Pressable
              key={key}
              disabled={disabled}
              onPress={() => (food ? props.onPick(food) : props.onIncomplete?.(record!))}
              accessibilityRole="button"
              accessibilityLabel={`${incomplete ? 'Complete' : 'Add'} ${name}`}
              accessibilityState={{ disabled }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.title, disabled && styles.muted]}>{name}</Text>
                <Text style={styles.sub}>{sub}</Text>
              </View>
              <Text style={styles.plus}>{incomplete ? '›' : '+'}</Text>
            </Pressable>
          );
        })
      )}
      {anyOff && props.showCredit !== false ? (
        <Text style={styles.credit}>{OPEN_FOOD_FACTS_CREDIT}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    ...type.body,
    color: colors.text,
  },
  section: { marginTop: space.xl, marginBottom: space.xs },
  row: {
    minHeight: MIN_TOUCH + 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: space.md,
  },
  rowText: { flex: 1, paddingVertical: space.sm },
  title: { ...type.headline, color: colors.text },
  muted: { color: colors.textSecondary },
  sub: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  plus: { fontSize: 26, color: colors.text, width: 28, textAlign: 'center' },
  credit: { ...type.footnote, color: colors.textSecondary, marginTop: space.lg },
});
