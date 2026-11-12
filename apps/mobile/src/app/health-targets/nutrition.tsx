import { useState } from 'react';
import { Text } from 'react-native';
import { formatKcal } from '@life-os/core';
import { TextField } from '@/components/forms';
import { editStyles, TargetEditScreen } from '@/features/targets/EditScreen';
import {
  macroKcal,
  parseAmount,
  parsePlanName,
  TARGET_FIELDS,
  type TargetKey,
} from '@/features/targets/parse';
import { useSession } from '@/lib/session';

const KEYS = ['kcal', 'protein', 'carbs', 'fat'] as const;
const field = (k: TargetKey) => TARGET_FIELDS.find((f) => f.key === k)!;
const LABEL: Record<(typeof KEYS)[number], string> = {
  kcal: 'Calories',
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fat',
};

/** Health targets → Nutrition: plan name, calories and macros. */
export default function NutritionTargetScreen() {
  const session = useSession();
  const t = session.settings?.targets;
  const [name, setName] = useState(session.settings?.health.planName ?? '');
  const [inputs, setInputs] = useState<Record<(typeof KEYS)[number], string>>(() => ({
    kcal: t?.kcal == null ? '' : String(t.kcal),
    protein: t?.protein == null ? '' : String(t.protein),
    carbs: t?.carbs == null ? '' : String(t.carbs),
    fat: t?.fat == null ? '' : String(t.fat),
  }));
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const parsed = Object.fromEntries(
    KEYS.map((k) => [k, parseAmount(inputs[k], field(k))]),
  ) as Record<(typeof KEYS)[number], ReturnType<typeof parseAmount>>;
  const val = (k: (typeof KEYS)[number]) => {
    const r = parsed[k];
    return r.ok ? r.value : null;
  };
  const sum = macroKcal(val('protein'), val('carbs'), val('fat'));

  return (
    <TargetEditScreen
      title="Nutrition"
      testID="screen-target-nutrition"
      onSave={async () => {
        const plan = parsePlanName(name);
        const next: Record<string, string> = {};
        if (!plan.ok) next.name = plan.error;
        for (const k of KEYS) {
          const r = parsed[k];
          if (!r.ok) next[k] = r.error;
        }
        setErrors(next);
        if (Object.keys(next).length || !plan.ok) return false;
        await session.updateSettings({
          targets: {
            kcal: val('kcal'),
            protein: val('protein'),
            carbs: val('carbs'),
            fat: val('fat'),
          },
          health: { planName: plan.value },
        });
        return true;
      }}
    >
      <TextField label="Plan name" value={name} onChangeText={setName} error={errors.name} />
      {KEYS.map((k) => (
        <TextField
          key={k}
          label={LABEL[k]}
          value={inputs[k]}
          onChangeText={(v) => setInputs((i) => ({ ...i, [k]: v }))}
          keyboardType={field(k).decimals ? 'decimal-pad' : 'number-pad'}
          suffix={k === 'kcal' ? 'kcal' : 'g'}
          error={errors[k]}
        />
      ))}
      {sum > 0 ? (
        <Text
          style={editStyles.note}
          testID="macro-sum"
        >{`Macros add up to ${formatKcal(sum)} kcal.`}</Text>
      ) : null}
    </TargetEditScreen>
  );
}
