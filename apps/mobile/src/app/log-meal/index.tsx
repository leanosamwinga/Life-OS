import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  formatDateUK,
  formatKcal,
  formatTimeUK,
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
import { useLogMeal } from '@/features/log-meal/LogMealContext';
import { closeLogMeal } from '@/features/log-meal/navigation';
import { SheetHeader } from '@/features/log-meal/parts';
import { loggedAtFor, slotLabel, slotOptions } from '@/features/log-meal/slots';
import type { RosterMeal } from '@/lib/backend/foods';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

const matches = (q: string, name: string) => !q || name.toLowerCase().includes(q.toLowerCase());

/** 7a Log meal — roster or new. */
export default function LogMealIndex() {
  const session = useSession();
  const lm = useLogMeal();
  const [query, setQuery] = useState('');
  const [pickingSlot, setPickingSlot] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      const components = log.items.flatMap((i) => {
        const food = i.foodId ? foods.get(i.foodId) : undefined;
        return food ? [{ food, grams: i.grams }] : [];
      });
      if (components.length < log.items.length) {
        // Some foods are gone or incomplete: let the user review the meal first.
        lm.startDraft({ name: log.name, components });
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

  const soFar = p.kcal.target
    ? `${formatKcal(p.kcal.consumed)} of ${formatKcal(p.kcal.target)} kcal so far`
    : `${formatKcal(p.kcal.consumed)} kcal so far`;

  return (
    <FormScreen
      testID="screen-log-meal"
      header={<SheetHeader left="Cancel" onLeft={closeLogMeal} title="Log meal" />}
    >
      <View style={styles.topRow}>
        <Text style={styles.soFar}>{soFar}</Text>
        <Pressable
          onPress={() => setPickingSlot((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={`Logging for ${slotLabel(lm.slot)}. Change`}
          accessibilityState={{ expanded: pickingSlot }}
          style={styles.slot}
        >
          <Text style={styles.slotText}>{slotLabel(lm.slot)} ▾</Text>
        </Pressable>
      </View>
      {pickingSlot ? (
        <View style={styles.slotList}>
          {slotOptions(lm.data.roster, formatTimeUK(new Date())).map((s) => (
            <Pressable
              key={s.name}
              onPress={() => {
                lm.setSlot(s);
                setPickingSlot(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={slotLabel(s)}
              accessibilityState={{ selected: s.name === lm.slot.name }}
              style={styles.slotOption}
            >
              <Text style={[styles.slotOptionText, s.name === lm.slot.name && styles.bold]}>
                {slotLabel(s)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search your meals and foods"
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel="Search your meals and foods"
        style={styles.search}
        returnKeyType="search"
      />

      {error || lm.error ? <FormMessage>{error ?? lm.error ?? ''}</FormMessage> : null}

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
                onPress={() => edit(m)}
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
                  onPress={() => void logRoster(m)}
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
                  onPress={() => void logRoster(m)}
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
                  onPress={() => void logAgain(l)}
                />
              </View>
            );
          })}
        </>
      ) : null}

      <View style={styles.build}>
        <SecondaryButton
          strong
          label="+ Build a meal from scratch"
          onPress={() => {
            lm.startDraft({ name: query.trim() });
            router.push('/log-meal/build');
          }}
        />
        <Text style={formStyles.footnote}>
          Add components one by one: suggestions, barcode or manual.
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  soFar: { ...type.callout, color: colors.textSecondary, flex: 1 },
  slot: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  slotText: { ...type.headline, color: colors.text },
  slotList: {
    marginTop: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  slotOption: { minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: space.lg },
  slotOptionText: { ...type.body, color: colors.text },
  bold: { fontWeight: '700' },
  search: {
    marginTop: space.lg,
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
  consent: { marginTop: space.xl, gap: space.md },
  consentTitle: { ...type.title, color: colors.text },
});
