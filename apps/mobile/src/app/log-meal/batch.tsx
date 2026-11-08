import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  explainEstimate,
  formatDateUK,
  formatGrams,
  formatKcal,
  portionMacros,
  roundGrams,
  summariseBatch,
  type Food,
  type Macros,
} from '@life-os/core';
import { FormMessage, FormScreen, LinkButton, PrimaryButton, TextField } from '@/components/forms';
import { Overline } from '@/components/ui';
import { draftIngredients, useLogMeal } from '@/features/log-meal/LogMealContext';
import { diffCookAgain } from '@/features/log-meal/batch';
import { BatchBadge, FoodName, SheetHeader } from '@/features/log-meal/parts';
import { parseAmount } from '@/features/targets/parse';
import { batchIssueMessage, type SavedBatch } from '@/lib/backend/foods';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

const fmt1 = (n: number) => n.toFixed(1);
const macroLine = (m: Macros) =>
  `${formatKcal(m.kcal)} kcal · P ${fmt1(m.protein)} · C ${fmt1(m.carbs)} · F ${fmt1(m.fat)}`;
/** The batch's own numbers, with the 1-decimal macros the wireframes show (P 4.3, C 0). */
const per100Line = (m: Macros) =>
  `${formatKcal(m.kcal)} kcal · P ${fmt1(m.protein)} · C ${fmt1(m.carbs)} · F ${fmt1(m.fat)}`;

/** Fewer ingredients than this on a new batch: the "building" layout of 7f. */
const BUILDING_UNTIL = 3;

function confirmDelete(name: string): Promise<boolean> {
  const msg = `“${name}” leaves Saved. Meals you’ve already logged stay in your history.`;
  if (Platform.OS === 'web') {
    const c = (globalThis as { confirm?: (m: string) => boolean }).confirm;
    return Promise.resolve(c ? c(msg) : true);
  }
  return new Promise((resolve) =>
    Alert.alert('Delete this batch?', msg, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

const weightLine = (b: SavedBatch['food']['batch']) =>
  b.weighed
    ? `weighed ${formatGrams(b.cookedWeightG)}`
    : `≈ ${formatGrams(b.cookedWeightG)} estimated`;

/**
 * 7f Batch builder (new batch: building → estimated → weighed) and 7g Cook again (last time's
 * ingredients pre-filled; edit what changed). Saving goes through save_batch, which recomputes
 * the per-100 g values; meals already logged keep their snapshot.
 */
export default function BatchScreen() {
  const session = useSession();
  const lm = useLogMeal();
  const { draft } = lm;
  const again = draft.batch;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backend = session.backend;

  const ingredients = draftIngredients(draft);
  const weighedParsed = parseAmount(draft.weighed, { max: 50000, decimals: 1 });
  const weighedG =
    weighedParsed.ok && weighedParsed.value && weighedParsed.value > 0
      ? roundGrams(weighedParsed.value)
      : null;
  const s = summariseBatch(ingredients, weighedG);
  const diff = again ? diffCookAgain(again.ingredients, draft.components) : null;
  const building = !again && draft.components.length < BUILDING_UNTIL;
  const name = draft.name.trim();

  const openHowMuch = (food: Food, grams: number | null, componentKey?: string) => {
    const c = draft.components.find((x) => x.key === componentKey);
    lm.setPending({ food, grams, componentKey, cooksAs: c?.cooksAs });
    router.push('/log-meal/how-much');
  };
  const openAdd = (tab: 'Scan' | 'Search' | 'Manual') =>
    router.push({ pathname: '/log-meal/add', params: { tab } });

  async function save(andLog: boolean) {
    if (!backend) return;
    setError(null);
    if (!name) {
      setError('Give the batch a name.');
      return;
    }
    if (!s.per100g) {
      setError(batchIssueMessage(s.issue ?? 'missing'));
      return;
    }
    setBusy(true);
    try {
      const id = await backend.saveBatch({
        id: again?.food.id ?? null,
        name,
        ingredients,
        weighedG,
      });
      session.notifyDataChanged();
      if (andLog) {
        // The server stored exactly these numbers (it refuses anything else).
        const food: Food = {
          id,
          name,
          source: 'user',
          per100g: s.per100g,
          batch: {
            cookedWeightG: s.cookedWeightG,
            weighed: s.weighed,
            cookedAt: new Date().toISOString(),
            starred: again?.food.batch.starred ?? false,
          },
        };
        lm.setPending({ food, grams: lm.lastGrams(id), from: 'batch' });
        router.replace('/log-meal/batch-log');
      } else {
        lm.setTab('saved');
        router.dismissTo('/log-meal');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that batch.');
      setBusy(false);
    }
  }

  const deleteBatch = async () => {
    if (!again || !backend || !(await confirmDelete(again.food.name))) return;
    setBusy(true);
    setError(null);
    try {
      await backend.deleteBatch(again.food.id);
      session.notifyDataChanged();
      lm.setTab('saved');
      router.dismissTo('/log-meal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t delete that batch.');
      setBusy(false);
    }
  };

  const canSave = Boolean(name && s.per100g);
  const primary = again ? 'Save batch' : 'Save and log some';
  const secondary = again ? 'Save and log some' : 'Save batch only';

  const ingredientsTitle = again
    ? diff!.changed === 0
      ? 'Ingredients · same as last time'
      : `Ingredients · ${diff!.changed} changed`
    : `Ingredients · ${draft.components.length} added`;

  return (
    <FormScreen
      testID={again ? 'screen-cook-again' : 'screen-batch-builder'}
      header={
        <SheetHeader
          left={again ? '‹ Saved' : '‹ Log meal'}
          leftLabel={again ? 'Back to Saved' : 'Back to Log meal'}
          onLeft={() => router.back()}
          right={again ? 'Cook again' : 'New batch'}
        />
      }
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton
            label={primary}
            busy={busy}
            disabled={!canSave}
            onPress={() => void save(!again)}
          />
          <LinkButton
            label={secondary}
            plain
            align="center"
            onPress={() => (busy ? undefined : void save(Boolean(again)))}
          />
        </>
      }
    >
      {again ? (
        <View style={styles.titleBlock}>
          <View style={styles.titleRow} accessibilityRole="header">
            <Text style={styles.title}>{again.food.name}</Text>
            <BatchBadge />
          </View>
          <Text style={styles.callout}>
            Last cooked {formatDateUK(again.food.batch.cookedAt)} · {weightLine(again.food.batch)}
          </Text>
        </View>
      ) : (
        <View style={styles.nameBlock}>
          <Overline>Batch name</Overline>
          <TextInput
            value={draft.name}
            onChangeText={(v) => lm.updateDraft({ name: v })}
            placeholder="e.g. Egg fried rice"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Batch name"
            style={styles.nameInput}
            maxLength={120}
          />
        </View>
      )}

      <View style={styles.card}>
        <Overline>{ingredientsTitle}</Overline>
        {draft.components.length === 0 ? (
          <Text style={styles.sub}>Nothing yet. Add what goes in the pot.</Text>
        ) : null}
        {draft.components.map((c, i) => {
          const m = portionMacros(c.food, c.grams);
          const last = i === draft.components.length - 1;
          if (again) {
            const status = diff!.status.get(c.key) ?? 'same';
            const title =
              status === 'changed' && c.origin && c.origin.grams !== c.grams
                ? `${c.food.name} · ${formatGrams(c.origin.grams)} → ${formatGrams(c.grams)}`
                : `${c.food.name} · ${formatGrams(c.grams)}`;
            const sub =
              status === 'new'
                ? `New · ${macroLine(m)}`
                : status === 'changed' && c.origin && c.origin.grams !== c.grams
                  ? `${formatGrams(c.grams)} (was ${formatGrams(c.origin.grams)}) · ${macroLine(m)}`
                  : macroLine(m);
            return (
              <Pressable
                key={c.key}
                onPress={() => openHowMuch(c.food, c.grams, c.key)}
                accessibilityRole="button"
                accessibilityLabel={`${title}${status === 'same' ? '' : `, ${status}`}. Change amount`}
                style={[
                  styles.againRow,
                  !last && status === 'same' && styles.divider,
                  status !== 'same' && styles.changedRow,
                ]}
              >
                <View style={styles.compMain}>
                  <Text style={styles.compTitle}>{title}</Text>
                  <Text style={styles.sub}>{sub}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          }
          return (
            <View key={c.key} style={[styles.compRow, !last && styles.divider]}>
              <Pressable
                style={styles.compMain}
                onPress={() => openHowMuch(c.food, c.grams, c.key)}
                accessibilityRole="button"
                accessibilityLabel={`${c.food.name}, ${formatGrams(c.grams)}. Change amount`}
              >
                <FoodName
                  name={c.food.name}
                  suffix={` · ${formatGrams(c.grams)}`}
                  style={styles.compTitle}
                />
                <Text style={styles.sub}>{macroLine(m)}</Text>
              </Pressable>
              <Pressable
                onPress={() => lm.removeComponent(c.key)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${c.food.name}`}
                style={styles.remove}
              >
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {again ? (
        <Text style={[styles.callout, styles.note]}>
          {diff!.changed === 0
            ? 'Tap one to change the amount. Add or remove below.'
            : 'Meals you’ve already logged keep last time’s numbers.'}
        </Text>
      ) : null}

      {building ? (
        <View style={styles.addPanel}>
          <Text style={styles.addTitle}>Add ingredient</Text>
          <AddButtons onPress={openAdd} dark="Search" />
          <Text style={styles.callout}>Add amounts as they go in the pot: dry rice, raw meat.</Text>
        </View>
      ) : (
        <View style={styles.addRow}>
          <AddButtons onPress={openAdd} />
        </View>
      )}

      <View
        style={styles.card}
        accessible
        accessibilityLabel={`${building ? 'Batch so far' : 'Whole batch'}: ${macroLine(s.totals)}`}
      >
        <Overline>{building ? 'Batch so far' : 'Whole batch'}</Overline>
        <View style={styles.totals}>
          {(
            [
              [formatKcal(s.totals.kcal), 'kcal'],
              [fmt1(s.totals.protein), 'protein g'],
              [fmt1(s.totals.carbs), 'carbs g'],
              [fmt1(s.totals.fat), 'fat g'],
            ] as const
          ).map(([v, l]) => (
            <View key={l} style={styles.total}>
              <Text style={styles.totalValue}>{v}</Text>
              <Text style={styles.sub}>{l}</Text>
            </View>
          ))}
        </View>
        {diff && diff.changed > 0 ? (
          <Text style={styles.callout}>
            Was {formatKcal(diff.was.totals.kcal)} kcal · P {fmt1(diff.was.totals.protein)} · C{' '}
            {fmt1(diff.was.totals.carbs)} · F {fmt1(diff.was.totals.fat)}
          </Text>
        ) : null}
      </View>

      <View style={styles.card} testID="cooked-weight">
        <Overline>Cooked weight</Overline>
        {building ? (
          <>
            <View
              style={styles.weightRow}
              accessible
              accessibilityLabel={`About ${formatGrams(s.estimatedG)} so far`}
            >
              <Text style={[styles.weight, styles.weightMuted]}>≈ {formatGrams(s.estimatedG)}</Text>
              <Text style={styles.weightNote}>so far</Text>
            </View>
            <Text style={styles.callout}>Updates as you add ingredients.</Text>
          </>
        ) : (
          <>
            {s.weighed ? (
              <>
                <View
                  style={styles.weightRow}
                  accessible
                  accessibilityLabel={`${formatGrams(s.cookedWeightG)}, weighed`}
                >
                  <Text style={styles.weight}>{formatGrams(s.cookedWeightG)}</Text>
                  <Text style={styles.weightNote}>weighed</Text>
                </View>
                <Text style={styles.callout}>
                  Using your weight. Estimate was{' '}
                  <Text style={styles.struck}>≈ {formatGrams(s.estimatedG)}</Text>.
                </Text>
              </>
            ) : (
              <>
                <View
                  style={styles.weightRow}
                  accessible
                  accessibilityLabel={`About ${formatGrams(s.estimatedG)}, estimated`}
                >
                  <Text style={styles.weight}>≈ {formatGrams(s.estimatedG)}</Text>
                  <Text style={styles.weightNote}>estimated</Text>
                </View>
                {diff && diff.changed > 0 ? (
                  <Text style={styles.callout}>
                    Was ≈ {formatGrams(diff.was.estimatedG)}. {diff.summary}
                  </Text>
                ) : null}
                <Text style={styles.callout} testID="how-we-worked-it-out">
                  How we worked it out: {explainEstimate(ingredients)} Tap an ingredient to change
                  this.
                </Text>
              </>
            )}
            <Text style={styles.weighedLabel}>
              I weighed it <Text style={styles.optional}>· optional</Text>
            </Text>
            <TextField
              label="I weighed it, whole pot in grams, optional"
              hideLabel
              value={draft.weighed}
              onChangeText={(v) => lm.updateDraft({ weighed: v })}
              keyboardType="decimal-pad"
              suffix="g"
              placeholder="—"
              error={weighedParsed.ok ? null : weighedParsed.error}
            />
            {s.weighed ? (
              <Text style={styles.callout}>Clear it to go back to the estimate.</Text>
            ) : again?.food.batch.weighed ? (
              <Text style={styles.callout}>
                Last time you weighed {formatGrams(again.food.batch.cookedWeightG)}.
              </Text>
            ) : null}
            <View style={styles.rule} />
            <Text style={styles.callout} testID="per-100g">
              {s.per100g
                ? `Per 100 g cooked: ${per100Line(s.per100g)}`
                : batchIssueMessage(s.issue ?? 'missing')}
            </Text>
          </>
        )}
      </View>

      {again ? (
        <View style={styles.delete}>
          <LinkButton label="Delete batch" muted onPress={() => void deleteBatch()} />
        </View>
      ) : null}
    </FormScreen>
  );
}

function AddButtons(props: {
  onPress: (tab: 'Scan' | 'Search' | 'Manual') => void;
  dark?: 'Search';
}) {
  return (
    <View style={styles.addButtons}>
      {(['Scan', 'Search', 'Manual'] as const).map((tab) => (
        <Pressable
          key={tab}
          onPress={() => props.onPress(tab)}
          accessibilityRole="button"
          accessibilityLabel={`${tab} to add an ingredient`}
          style={[styles.addButton, props.dark === tab && styles.addButtonDark]}
        >
          <Text style={[styles.addButtonText, props.dark === tab && styles.addButtonTextDark]}>
            {tab}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  nameBlock: { marginTop: space.md, marginBottom: space.lg, gap: space.xs },
  nameInput: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: space.sm,
  },
  titleBlock: { marginTop: space.md, marginBottom: space.lg, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: 30, fontWeight: '700', color: colors.text },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
    gap: space.sm,
  },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  againRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    minHeight: MIN_TOUCH,
  },
  changedRow: { backgroundColor: colors.card, borderRadius: radius.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  compMain: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center', gap: 2 },
  compTitle: { ...type.headline, color: colors.text },
  chevron: { fontSize: 24, color: colors.textSecondary },
  sub: { ...type.footnote, color: colors.textSecondary },
  callout: { ...type.callout, color: colors.textSecondary },
  note: { marginBottom: space.md },
  remove: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: 20, color: colors.text },
  addPanel: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
    gap: space.sm,
  },
  addRow: { marginBottom: space.lg },
  addTitle: { ...type.headline, color: colors.text },
  addButtons: { flexDirection: 'row', gap: space.sm },
  addButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDark: { backgroundColor: colors.fill, borderColor: colors.fill },
  addButtonText: { ...type.headline, color: colors.text },
  addButtonTextDark: { color: colors.inverseText },
  totals: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: space.sm },
  total: { alignItems: 'center', flex: 1 },
  totalValue: { fontSize: 24, fontWeight: '700', color: colors.text },
  weightRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  weight: { fontSize: 34, fontWeight: '700', color: colors.text },
  weightMuted: { color: colors.textTertiary },
  weightNote: { ...type.body, color: colors.textSecondary },
  struck: { textDecorationLine: 'line-through' },
  weighedLabel: { ...type.headline, color: colors.text, marginTop: space.sm },
  optional: { fontWeight: '400', color: colors.textSecondary },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  delete: { marginTop: space.md },
});
