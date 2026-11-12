import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { TextField } from '@/components/forms';
import { useAsync } from '@/features/data/useAsync';
import { rescheduleSupplementReminders } from '@/features/health/reminders';
import { Segmented } from '@/features/log-meal/parts';
import { editStyles, TargetEditScreen } from '@/features/targets/EditScreen';
import { parseTime24 } from '@/features/targets/parse';
import type { Supplement, SupplementTime } from '@/lib/backend/health';
import { requestNotificationPermission } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

interface Draft {
  /** null until saved. */
  id: string | null;
  key: string;
  name: string;
  dose: string;
  timeOfDay: SupplementTime;
  reminder: boolean;
  reminderTime: string;
}

const TIMES = ['Morning', 'Evening'] as const;
let draftSeq = 0;

const toDraft = (s: Supplement): Draft => ({
  id: s.id,
  key: s.id,
  name: s.name,
  dose: s.dose ?? '',
  timeOfDay: s.timeOfDay,
  reminder: s.reminderTime != null,
  reminderTime: s.reminderTime ?? (s.timeOfDay === 'evening' ? '21:30' : '08:00'),
});

const blank = (): Draft => ({
  id: null,
  key: `new-${++draftSeq}`,
  name: '',
  dose: '',
  timeOfDay: 'morning',
  reminder: false,
  reminderTime: '08:00',
});

/**
 * 7 Supplement editor (Me → Health targets → Supplements): name, dose, Morning / Evening, a
 * reminder switch and 24-hour time, "Delete {name}" and "+ Add supplement". Done (or back) saves
 * every change, then this phone's reminders are rescheduled.
 */
export default function SupplementEditor() {
  const session = useSession();
  const backend = session.backend;
  const loaded = useAsync(
    backend && session.healthConsent ? () => backend.listSupplements() : null,
    [backend, session.healthConsent],
  );
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (drafts === null && loaded.data) setDrafts(loaded.data.map(toDraft));
  }, [loaded.data, drafts]);

  const list = drafts ?? [];
  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((d) => (d ?? []).map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const setReminder = async (key: string, on: boolean) => {
    update(key, { reminder: on });
    if (on) {
      const p = await requestNotificationPermission();
      setNotice(
        p === 'granted'
          ? null
          : 'Notifications are off for Life OS, so reminders won’t show. Turn them on in Settings.',
      );
    }
  };

  const save = async (): Promise<boolean> => {
    if (!backend) return true;
    const next: Record<string, string> = {};
    for (const d of list) {
      if (!d.name.trim() && !d.id) continue;
      if (!d.name.trim()) next[`${d.key}.name`] = 'Give it a name';
      if (d.name.trim().length > 80) next[`${d.key}.name`] = 'Keep it to 80 characters';
      if (d.dose.trim().length > 40) next[`${d.key}.dose`] = 'Keep it to 40 characters';
      if (d.reminder && !parseTime24(d.reminderTime).ok)
        next[`${d.key}.time`] = 'Use a 24-hour time, like 08:00';
    }
    setErrors(next);
    if (Object.keys(next).length) return false;
    for (const id of deleted) await backend.deleteSupplement(id);
    let order = 0;
    for (const d of list) {
      if (!d.name.trim()) continue;
      const t = parseTime24(d.reminderTime);
      await backend.saveSupplement({
        id: d.id,
        name: d.name,
        dose: d.dose.trim() || null,
        timeOfDay: d.timeOfDay,
        reminderTime: d.reminder && t.ok ? t.value : null,
        sortOrder: order++,
      });
    }
    await rescheduleSupplementReminders(await backend.listSupplements()).catch(() => {});
    session.notifyDataChanged();
    return true;
  };

  return (
    <TargetEditScreen
      title="Supplements"
      testID="screen-supplements"
      intro="Tap a chip on Health to mark one taken."
      action="Done"
      backSaves
      onSave={save}
    >
      {!session.healthConsent ? (
        <Text style={editStyles.note}>
          Health data is off. Turn on “Use my health data” in Me to keep a supplement list.
        </Text>
      ) : null}
      {list.map((d) => {
        const err = (f: string) => errors[`${d.key}.${f}`];
        const title = d.name.trim() || 'supplement';
        return (
          <View key={d.key} style={editStyles.card} testID={`supplement-editor-${d.key}`}>
            <View style={editStyles.row}>
              <View style={styles.name}>
                <TextField
                  label="Name"
                  value={d.name}
                  onChangeText={(t) => update(d.key, { name: t })}
                  autoCapitalize="sentences"
                  error={err('name')}
                />
              </View>
              <View style={styles.dose}>
                <TextField
                  label="Dose"
                  value={d.dose}
                  onChangeText={(t) => update(d.key, { dose: t })}
                  placeholder="5 g"
                  error={err('dose')}
                />
              </View>
            </View>
            <Text style={styles.label}>Time of day</Text>
            <Segmented
              options={TIMES}
              value={d.timeOfDay === 'evening' ? 'Evening' : 'Morning'}
              onChange={(v) =>
                update(d.key, { timeOfDay: v === 'Evening' ? 'evening' : 'morning' })
              }
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Reminder</Text>
              <View style={styles.switchSide}>
                <Text style={editStyles.note}>{d.reminder ? 'On' : 'Off'}</Text>
                <Switch
                  value={d.reminder}
                  onValueChange={(v) => void setReminder(d.key, v)}
                  accessibilityLabel={`Reminder for ${title}`}
                  trackColor={{ true: colors.fill, false: colors.track }}
                />
              </View>
            </View>
            {d.reminder ? (
              <TextField
                label="Reminder time"
                value={d.reminderTime}
                onChangeText={(t) => update(d.key, { reminderTime: t })}
                keyboardType="numbers-and-punctuation"
                placeholder="08:00"
                error={err('time')}
              />
            ) : (
              <Text style={editStyles.note}>No reminder</Text>
            )}
            <View style={styles.deleteRow}>
              <Pressable
                onPress={() => {
                  if (d.id) setDeleted((x) => [...x, d.id!]);
                  setDrafts((all) => (all ?? []).filter((x) => x.key !== d.key));
                }}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${title}`}
                style={styles.delete}
              >
                <Text style={styles.deleteText}>{`Delete ${title}`}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      {notice ? <Text style={editStyles.note}>{notice}</Text> : null}
      <Pressable
        onPress={() => setDrafts((d) => [...(d ?? []), blank()])}
        disabled={!session.healthConsent}
        accessibilityRole="button"
        accessibilityLabel="Add supplement"
        style={[styles.add, !session.healthConsent && styles.disabled]}
      >
        <Text style={styles.addText}>+ Add supplement</Text>
      </Pressable>
    </TargetEditScreen>
  );
}

const styles = StyleSheet.create({
  name: { flex: 3 },
  dose: { flex: 2 },
  label: { ...type.footnote, fontWeight: '600', color: colors.text, marginBottom: space.xs },
  switchRow: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  switchLabel: { ...type.callout, fontWeight: '600', color: colors.text },
  switchSide: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  deleteRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: space.sm,
    paddingTop: 4,
  },
  delete: { minHeight: MIN_TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  deleteText: {
    ...type.callout,
    fontWeight: '600',
    color: colors.text,
    textDecorationLine: 'underline',
  },
  add: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addText: { ...type.callout, fontWeight: '600', color: colors.text },
  disabled: { opacity: 0.5 },
});
