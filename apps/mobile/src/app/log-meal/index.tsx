import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  formatDateUK,
  formatKcal,
  formatTimeUK,
  componentsFromLog,
  sumMacros,
  toFood,
  toLondonDate,
  type Food,
  type MealLog,
} from '@life-os/core';
import {
  FormMessage,
  FormScreen,
  PrimaryButton,
  SecondaryButton,
  formStyles,
} from '@/components/forms';
import { OutlineButton, Overline } from '@/components/ui';
import { useLogMeal, type LogMealTab } from '@/features/log-meal/LogMealContext';
import { closeLogMeal } from '@/features/log-meal/navigation';
import { sortSaved } from '@/features/log-meal/saved';
import { Chip, FoodName, Segmented, SheetHeader, StarToggle } from '@/features/log-meal/parts';
import { componentCount } from '@/features/log-meal/draft';
import {
  loggedAtFor,
  otherTimeChoice,
  pickerFrom as pickerStartFor,
  timeChip,
  whenChoices,
} from '@/features/log-meal/slots';
import { TimeSheet } from '@/features/log-meal/TimeSheet';
import type { RosterMeal, SavedBatch } from '@/lib/backend/foods';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

const matches = (q: string, name: string) => !q || name.toLowerCase().includes(q.toLowerCase());

const TABS = ['Plan & recent', 'Saved'] as const;
const TAB_OF: Record<(typeof TABS)[number], LogMealTab> = {
  'Plan & recent': 'plan',
  Saved: 'saved',
};

type SavedItem =
  | { kind: 'meal'; id: string; name: string; starred: boolean; meal: RosterMeal }
  | { kind: 'batch'; id: string; name: string; starred: boolean; batch: SavedBatch };

/** 7a Log meal — roster or new. */
export default function LogMealIndex() {
  const session = useSession();
  const lm = useLogMeal();
  const [query, setQuery] = useState('');
  // 7i: the moment the picker opened (its limits are an hour from then), or null when closed.
  const [picker, setPicker] = useState<Date | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stars change on tap; the server catches up (and wins on the next load).
  const [stars, setStars] = useState<Record<string, boolean>>({});
  const backend = session.backend;

  if (session.status === 'signedIn' && !session.healthConsent) {
    return <ConsentOff />;
  }

  const p = lm.progress;
  const loggedToday = new Map<string, MealLog>();
  for (const m of p.meals) if (m.savedMealId) loggedToday.set(m.savedMealId, m);

  const roster = [...lm.data.roster]
    .filter((m) => matches(query, m.name))
    .sort((a, b) => {
      if (a.inDailyPlan !== b.inDailyPlan) return a.inDailyPlan ? -1 : 1;
      return (a.usualTime ?? '').localeCompare(b.usualTime ?? '');
    });
  const firstToLog = roster.find((m) => !(m.inDailyPlan && loggedToday.has(m.id)))?.id;

  // Eaten recently, not from the roster: newest log per name.
  const seen = new Set<string>();
  const recent = [...lm.data.logs]
    .filter((l) => !l.savedMealId)
    .sort((a, b) => Date.parse(b.loggedAt) - Date.parse(a.loggedAt))
    .filter((l) => {
      const k = l.name.toLowerCase();
      if (seen.has(k) || !matches(query, l.name)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 5);

  const loggedAt = () => loggedAtFor(lm.slot, lm.today, new Date());
  const pickerFrom = pickerStartFor(lm.slot, picker ?? new Date());
  const openPicker = () => setPicker(new Date());
  const other = otherTimeChoice(lm.slot, lm.today);

  /** 7a-C: anything that starts a new draft or logs something else asks before the kept meal goes. */
  const guarded = (fn: () => void | Promise<void>) => async (): Promise<void> => {
    if (await lm.confirmNewDraft()) await fn();
  };

  async function run(id: string, fn: () => Promise<void>) {
    if (!backend) return;
    setError(null);
    setBusy(id);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t log that meal.');
    } finally {
      setBusy(null);
    }
  }

  const logRoster = (m: RosterMeal) =>
    run(m.id, async () => {
      await backend!.logMeal({
        name: m.name,
        savedMealId: m.id,
        loggedAt: loggedAt(),
        components: m.components,
      });
      session.notifyDataChanged();
      closeLogMeal();
    });

  const logAgain = (log: MealLog) =>
    run(log.id, async () => {
      const ids = log.items.map((i) => i.foodId).filter(Boolean) as string[];
      const foods = new Map(
        (await backend!.getFoods(ids)).flatMap((r) => {
          const f = toFood(r);
          return f ? [[f.id, f] as [string, Food]] : [];
        }),
      );
      const { components, unavailable } = componentsFromLog(log.items, foods);
      if (unavailable.length) {
        // Some foods are gone: show them so the user can remove them, then log.
        lm.startDraft({ name: log.name, components, unavailable });
        router.push('/log-meal/build');
        return;
      }
      await backend!.logMeal({
        name: log.name,
        savedMealId: null,
        loggedAt: loggedAt(),
        components,
      });
      session.notifyDataChanged();
      closeLogMeal();
    });

  const edit = (m: RosterMeal) => {
    lm.startDraft({
      mode: 'edit',
      savedMealId: m.id,
      name: m.name,
      components: m.components,
      inDailyPlan: m.inDailyPlan,
      usualTime: m.usualTime ?? '',
    });
    router.push('/log-meal/build');
  };

  const savedItems = sortSaved<SavedItem>([
    ...lm.data.roster.map((m) => ({
      kind: 'meal' as const,
      id: m.id,
      name: m.name,
      starred: stars[m.id] ?? Boolean(m.starred),
      meal: m,
    })),
    ...lm.data.batches.map((b) => ({
      kind: 'batch' as const,
      id: b.food.id,
      name: b.food.name,
      starred: stars[b.food.id] ?? b.food.batch.starred,
      batch: b,
    })),
  ]).filter((i) => matches(query, i.name));
  const starred = savedItems.filter((i) => i.starred);
  const rest = savedItems.filter((i) => !i.starred);
  const nothingSaved = lm.data.roster.length === 0 && lm.data.batches.length === 0;

  const toggleStar = (item: SavedItem) => {
    if (!backend) return;
    const next = !item.starred;
    setStars((s) => ({ ...s, [item.id]: next }));
    setError(null);
    backend.setStarred({ kind: item.kind, id: item.id }, next).then(
      () => session.notifyDataChanged(),
      (err: unknown) => {
        setStars((s) => ({ ...s, [item.id]: !next }));
        setError(err instanceof Error ? err.message : 'Couldn’t change that star.');
      },
    );
  };

  const cookAgain = (b: SavedBatch) => {
    lm.startCookAgain(b);
    router.push('/log-meal/batch');
  };
  const logBatch = (b: SavedBatch) => {
    lm.setPending({ food: b.food, grams: lm.lastGrams(b.food.id), from: 'batch' });
    router.push('/log-meal/batch-log');
  };
  const newBatch = () => {
    lm.startDraft({ kind: 'batch' });
    router.push('/log-meal/batch');
  };

  const savedRow = (item: SavedItem) => {
    const sub =
      item.kind === 'batch'
        ? `${formatKcal(item.batch.food.per100g.kcal)} kcal per 100 g · cooked ${formatDateUK(item.batch.food.batch.cookedAt)}`
        : (() => {
            const t = sumMacros(item.meal.components);
            const lead =
              item.meal.inDailyPlan && item.meal.usualTime
                ? `In plan · ${item.meal.usualTime}`
                : `${item.meal.components.length} component${item.meal.components.length === 1 ? '' : 's'}`;
            return `${lead} · ${formatKcal(t.kcal)} kcal · P ${Math.round(t.protein)}`;
          })();
    return (
      <View key={`${item.kind}-${item.id}`} style={styles.row}>
        <StarToggle name={item.name} starred={item.starred} onToggle={() => toggleStar(item)} />
        <Pressable
          style={styles.rowMain}
          onPress={() =>
            void guarded(() => (item.kind === 'batch' ? cookAgain(item.batch) : edit(item.meal)))()
          }
          accessibilityRole="button"
          accessibilityLabel={
            item.kind === 'batch' ? `Cook ${item.name} again` : `Edit ${item.name}`
          }
        >
          <FoodName name={item.name} batch={item.kind === 'batch'} style={styles.rowTitle} />
          <Text style={styles.rowSub}>{sub}</Text>
        </Pressable>
        <OutlineButton
          label={busy === item.id ? '…' : 'Log'}
          accessibilityLabel={`Log ${item.name}`}
          onPress={() =>
            void guarded(() =>
              item.kind === 'batch' ? logBatch(item.batch) : logRoster(item.meal),
            )()
          }
        />
      </View>
    );
  };

  const soFar = p.kcal.target
    ? `${formatKcal(p.kcal.consumed)} of ${formatKcal(p.kcal.target)} kcal so far`
    : `${formatKcal(p.kcal.consumed)} kcal so far`;

  return (
    <FormScreen
      testID="screen-log-meal"
      header={<SheetHeader left="Cancel" onLeft={closeLogMeal} title="Log meal" />}
    >
      <Text style={styles.soFar}>{soFar}</Text>
      <Overline>When</Overline>
      <View style={styles.when} testID="when-chips">
        {whenChoices(lm.data.roster, lm.slot, lm.today, new Date()).map((c) => (
          <Chip
            key={c.slot.name}
            label={c.label}
            a11yLabel={c.a11yLabel}
            selected={c.selected}
            disabled={c.disabled}
            onPress={() => lm.setSlot(c.slot)}
          />
        ))}
        <Chip
          label={other.selected ? timeChip(lm.slot, lm.today).label : 'Other time…'}
          a11yLabel={other.selected ? timeChip(lm.slot, lm.today).a11yLabel : 'Other time'}
          selected={other.selected}
          onPress={openPicker}
          testID="other-time"
        />
      </View>
      <TimeSheet
        visible={picker !== null}
        now={picker ?? new Date()}
        start={pickerFrom}
        onCancel={() => setPicker(null)}
        onDone={(date, time) => {
          lm.setSlot({ name: 'Custom', date, time });
          setPicker(null);
        }}
      />

      {lm.kept ? (
        <View style={styles.kept} testID="kept-draft">
          <View style={styles.keptMain}>
            <Overline>Not logged yet</Overline>
            <Text style={styles.keptName}>{lm.kept.name}</Text>
            <Text style={styles.rowSub}>
              {`${componentCount(lm.kept.count)} · ${formatKcal(lm.kept.kcal)} kcal`}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/log-meal/build')}
            accessibilityRole="button"
            accessibilityLabel={`Continue your meal, ${lm.kept.name}`}
            style={styles.continue}
          >
            <Text style={styles.continueText}>Continue</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.tabs}>
        <Segmented
          options={TABS}
          value={lm.tab === 'saved' ? 'Saved' : 'Plan & recent'}
          onChange={(t) => lm.setTab(TAB_OF[t])}
        />
      </View>

      {lm.tab === 'saved' && nothingSaved && lm.status !== 'loading' ? null : (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={
            lm.tab === 'saved' ? 'Search saved meals and batches' : 'Search your meals and foods'
          }
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={
            lm.tab === 'saved' ? 'Search saved meals and batches' : 'Search your meals and foods'
          }
          style={styles.search}
          returnKeyType="search"
        />
      )}

      {error || lm.error ? <FormMessage>{error ?? lm.error ?? ''}</FormMessage> : null}

      {lm.tab === 'saved' ? (
        nothingSaved ? (
          lm.status === 'loading' ? (
            <Text style={formStyles.body}>Loading…</Text>
          ) : (
            <View style={styles.empty} testID="saved-empty">
              <Text style={styles.emptyTitle} accessibilityRole="header">
                Nothing saved yet
              </Text>
              <Text style={styles.emptyBody}>
                Meals you save to your roster and batches you cook show up here. Star one to keep it
                at the top.
              </Text>
            </View>
          )
        ) : (
          <>
            {starred.length ? (
              <>
                <View style={styles.section}>
                  <Overline>Starred</Overline>
                </View>
                {starred.map(savedRow)}
              </>
            ) : null}
            {rest.length ? (
              <>
                <View style={styles.section}>
                  <Overline>A–Z</Overline>
                </View>
                {rest.map(savedRow)}
              </>
            ) : null}
            {savedItems.length === 0 ? (
              <Text style={formStyles.body}>Nothing saved matches.</Text>
            ) : null}
            <Text style={[formStyles.footnote, styles.tapHint]}>
              Tap a meal to edit it. Tap a batch to cook it again.
            </Text>
          </>
        )
      ) : (
        <>
          <View style={styles.section}>
            <Overline>Your roster</Overline>
          </View>
          {lm.status === 'loading' && lm.data.roster.length === 0 ? (
            <Text style={formStyles.body}>Loading…</Text>
          ) : roster.length === 0 ? (
            <Text style={formStyles.body}>
              {query
                ? 'No roster meals match.'
                : 'No saved meals yet. Build one and switch on “Save to my roster”.'}
            </Text>
          ) : (
            roster.map((m) => {
              const log = m.inDailyPlan ? loggedToday.get(m.id) : undefined;
              const total = sumMacros(m.components);
              return (
                <View key={m.id} style={styles.row}>
                  <Pressable
                    style={styles.rowMain}
                    onPress={() => void guarded(() => edit(m))()}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${m.name}`}
                  >
                    <Text style={[styles.rowTitle, log && styles.done]}>{m.name}</Text>
                    <Text style={styles.rowSub}>
                      {log
                        ? `Logged ${formatTimeUK(log.loggedAt)} · ${formatKcal(sumMacros(log.items).kcal)} kcal`
                        : `${m.components.length} component${m.components.length === 1 ? '' : 's'} · ${formatKcal(total.kcal)} kcal · P ${Math.round(total.protein)}`}
                    </Text>
                  </Pressable>
                  {log ? (
                    <Text style={styles.doneLabel}>Done</Text>
                  ) : m.id === firstToLog ? (
                    <Pressable
                      onPress={() => void guarded(() => logRoster(m))()}
                      disabled={busy !== null || m.components.length === 0}
                      accessibilityRole="button"
                      accessibilityLabel={`Log ${m.name}`}
                      style={styles.logDark}
                    >
                      <Text style={styles.logDarkText}>{busy === m.id ? '…' : 'Log'}</Text>
                    </Pressable>
                  ) : (
                    <OutlineButton
                      label={busy === m.id ? '…' : 'Log'}
                      accessibilityLabel={`Log ${m.name}`}
                      onPress={() => void guarded(() => logRoster(m))()}
                    />
                  )}
                </View>
              );
            })
          )}

          {recent.length ? (
            <>
              <View style={styles.section}>
                <Overline>Eaten recently · not in roster</Overline>
              </View>
              {recent.map((l) => {
                const day =
                  toLondonDate(l.loggedAt) === lm.today
                    ? 'Today'
                    : formatDateUK(l.loggedAt).split(' ')[0];
                return (
                  <View key={l.id} style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>{l.name}</Text>
                      <Text style={styles.rowSub}>
                        {day} · {l.items.length} component{l.items.length === 1 ? '' : 's'} ·{' '}
                        {formatKcal(sumMacros(l.items).kcal)} kcal
                      </Text>
                    </View>
                    <OutlineButton
                      label={busy === l.id ? '…' : 'Log again'}
                      accessibilityLabel={`Log again: ${l.name}`}
                      onPress={() => void guarded(() => logAgain(l))()}
                    />
                  </View>
                );
              })}
            </>
          ) : null}
        </>
      )}

      <View style={styles.build}>
        <View style={styles.buildRow}>
          <SecondaryButton
            strong
            label="+ Build a meal from scratch"
            onPress={() =>
              void guarded(() => {
                lm.startDraft({ name: lm.tab === 'plan' ? query.trim() : '' });
                router.push('/log-meal/build');
              })()
            }
            style={styles.buildButton}
          />
          <SecondaryButton
            strong
            label="+ Cooked a batch"
            onPress={() => void guarded(newBatch)()}
            style={styles.buildButton}
          />
        </View>
        {lm.kept ? (
          <Text style={[formStyles.footnote, styles.center]} testID="build-kept-note">
            {`Starts a new meal. You’ll be asked before ${lm.kept.name} is discarded.`}
          </Text>
        ) : null}
        <Text style={[formStyles.footnote, styles.center]}>
          A batch is one pot you cook once, then log by the gram.
        </Text>
      </View>
    </FormScreen>
  );
}

/** Logging needs health-data consent; offer it here rather than failing. */
function ConsentOff() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormScreen
      testID="screen-log-meal-consent-off"
      header={<SheetHeader left="Cancel" onLeft={closeLogMeal} title="Log meal" />}
      footer={
        <>
          {error ? <FormMessage>{error}</FormMessage> : null}
          <PrimaryButton
            label="Yes, use my health data"
            busy={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                await session.setHealthConsent(true);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Couldn’t turn it on.');
              } finally {
                setBusy(false);
              }
            }}
          />
          <SecondaryButton label="Not now" onPress={closeLogMeal} />
        </>
      }
    >
      <View style={styles.consent}>
        <Text style={styles.consentTitle} accessibilityRole="header">
          Health data is off
        </Text>
        <Text style={formStyles.body}>
          To log meals and water, Life OS needs your explicit permission to use your health data.
          Stored in the UK/EU, never sold, never used for ads or AI training. Withdraw any time in
          Me → Privacy.
        </Text>
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  soFar: { ...type.callout, color: colors.textSecondary, marginBottom: space.md },
  when: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  bold: { fontWeight: '700' },
  search: {
    marginTop: space.xs,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    ...type.body,
    color: colors.text,
  },
  section: { marginTop: space.xl, marginBottom: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TOUCH + 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: { flex: 1, paddingVertical: space.sm, minHeight: MIN_TOUCH, justifyContent: 'center' },
  rowTitle: { ...type.headline, color: colors.text },
  rowSub: { ...type.footnote, color: colors.textSecondary, marginTop: 2 },
  done: { color: colors.textSecondary, fontWeight: '400' },
  doneLabel: { ...type.callout, color: colors.textSecondary },
  logDark: {
    minHeight: MIN_TOUCH,
    minWidth: 64,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logDarkText: { ...type.headline, color: colors.inverseText },
  build: { marginTop: space.xl, gap: space.md },
  buildRow: { flexDirection: 'row', gap: space.md },
  buildButton: { flex: 1, minHeight: 64, paddingHorizontal: space.sm },
  center: { textAlign: 'center' },
  tabs: { marginTop: space.lg },
  kept: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  keptMain: { flex: 1, gap: 2 },
  keptName: { ...type.headline, fontWeight: '700', color: colors.text },
  continue: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueText: { ...type.headline, color: colors.inverseText },
  tapHint: { marginTop: space.md },
  empty: {
    marginTop: space.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: space.sm,
  },
  emptyTitle: { ...type.title, color: colors.text, textAlign: 'center' },
  emptyBody: { ...type.callout, color: colors.textSecondary, textAlign: 'center' },
  consent: { marginTop: space.xl, gap: space.md },
  consentTitle: { ...type.title, color: colors.text },
});
