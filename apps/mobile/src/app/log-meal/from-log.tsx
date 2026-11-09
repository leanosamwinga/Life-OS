import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  componentsFromLog,
  toFood,
  toLondonDate,
  toLondonTime,
  type Food,
  type LocalDate,
  type LocalTime,
} from '@life-os/core';
import { FormMessage, FormScreen, formStyles } from '@/components/forms';
import { useLogMeal } from '@/features/log-meal/LogMealContext';
import { SheetHeader } from '@/features/log-meal/parts';
import { useSession } from '@/lib/session';

/**
 * From a logged meal (7j) into Build meal (7b), pre-filled with its name and components (same
 * amounts and units, each food's current values):
 * - `mode=correct` ("Log a corrected copy"): at the meal's own time (7b-T chip); Done replaces it.
 * - `mode=again` ("Log again" when a food has gone): at `date`/`time` if given, else now.
 * Foods that have been deleted are listed so the user can remove them.
 */
export default function FromLogScreen() {
  const params = useLocalSearchParams<{
    id: string;
    mode: 'correct' | 'again';
    date?: LocalDate;
    time?: LocalTime;
  }>();
  const session = useSession();
  const lm = useLogMeal();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const log = lm.data.logs.find((l) => l.id === params.id);
  const backend = session.backend;

  useEffect(() => {
    if (started.current || !log || !backend) return;
    started.current = true;
    (async () => {
      const ids = log.items.flatMap((i) => (i.foodId ? [i.foodId] : []));
      const foods = new Map(
        (await backend.getFoods(ids)).flatMap((r) => {
          const f = toFood(r);
          return f ? [[f.id, f] as [string, Food]] : [];
        }),
      );
      const { components, unavailable } = componentsFromLog(log.items, foods);
      const correct = params.mode === 'correct';
      lm.startDraft({
        name: log.name,
        components,
        unavailable,
        replaces: correct ? log.id : null,
      });
      if (correct) {
        lm.setSlot({
          name: 'Custom',
          date: toLondonDate(log.loggedAt),
          time: toLondonTime(log.loggedAt),
        });
      } else if (params.date && params.time) {
        lm.setSlot({ name: 'Custom', date: params.date, time: params.time });
      } else {
        lm.setSlot({ name: 'Now', time: toLondonTime(new Date()) });
      }
      router.replace('/log-meal/build');
    })().catch((err: unknown) => {
      started.current = false;
      setError(err instanceof Error ? err.message : 'Couldn’t open that meal.');
    });
  }, [log, backend, lm, params.mode, params.date, params.time]);

  const gone = lm.status === 'ready' && !log;
  return (
    <FormScreen
      testID="screen-from-log"
      header={<SheetHeader left="Cancel" onLeft={() => router.back()} />}
    >
      {error ? <FormMessage>{error}</FormMessage> : null}
      <Text style={formStyles.body}>
        {session.status === 'signedIn' && !session.healthConsent
          ? 'Health data is off. Turn on “Use my health data” in Me to log meals.'
          : gone
            ? 'That meal has gone.'
            : 'Loading…'}
      </Text>
    </FormScreen>
  );
}
