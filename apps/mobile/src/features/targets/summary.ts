import { formatCount, formatKcal, formatKg1, formatMl, formatSleep } from '@life-os/core';
import type { Supplement } from '@/lib/backend/health';
import type { HealthTargets, Targets } from '@/lib/backend/settings';

const NOT_SET = 'Not set';

/** The value shown under each row of Me → Health targets (6B). */
export function targetSummaries(t: Targets, h: HealthTargets, supplements: readonly Supplement[]) {
  const morning = supplements.filter((s) => s.timeOfDay === 'morning').length;
  const evening = supplements.filter((s) => s.timeOfDay === 'evening').length;
  const any = supplements.length - morning - evening;
  const macros = [
    t.protein != null ? `P ${formatCount(t.protein)}` : null,
    t.carbs != null ? `C ${formatCount(t.carbs)}` : null,
    t.fat != null ? `F ${formatCount(t.fat)} g` : null,
  ].filter(Boolean);
  const nutrition = [
    h.planName,
    t.kcal != null ? `${formatKcal(t.kcal)} kcal` : null,
    macros.length ? macros.join(' · ') : null,
  ].filter(Boolean);
  return {
    weight: h.weightKg != null ? `Target ${formatKg1(h.weightKg)}` : NOT_SET,
    nutrition: nutrition.length ? nutrition.join(' · ') : NOT_SET,
    water: t.waterMl != null ? `${formatMl(t.waterMl)} a day` : NOT_SET,
    sleep: h.sleepMin != null ? `${formatSleep(h.sleepMin)} a night` : NOT_SET,
    steps: t.steps != null ? `${formatCount(t.steps)} a day` : NOT_SET,
    supplements: supplements.length
      ? `${supplements.length} · ${[
          morning ? `${morning} morning` : null,
          evening ? `${evening} evening` : null,
          any ? `${any} any time` : null,
        ]
          .filter(Boolean)
          .join(', ')}`
      : 'None yet',
    training: `${h.trainingPerWeek} a week${h.split.length ? ` · ${h.split.length}-day split` : ''}`,
  };
}
