import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { toLondonDate } from '@life-os/core';
import { Screen } from '@/components/ui';
import { useNow } from '@/features/data/useNow';
import { HealthDayView } from '@/features/health/DayView';
import { HealthPeriodView } from '@/features/health/PeriodView';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

const RANGES = ['Day', 'Week', 'Month'] as const;

/**
 * 2 Health (Phase 3): Day (1B, grouped sections), Week (4A) and Month (5). Weight, sleep and
 * steps come from Apple Health (on web and Android: what the iPhone synced); nutrition, water,
 * supplements and training are logged here.
 */
export default function HealthScreen() {
  const [range, setRange] = useState<(typeof RANGES)[number]>('Day');
  const today = toLondonDate(useNow());

  return (
    <Screen title="Health" testID="screen-health">
      <View style={styles.segmented} accessibilityRole="tablist">
        {RANGES.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRange(r)}
            accessibilityRole="tab"
            accessibilityState={{ selected: range === r }}
            accessibilityLabel={r}
            style={[styles.segment, range === r && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, range === r && styles.segmentTextActive]}>{r}</Text>
          </Pressable>
        ))}
      </View>
      {range === 'Day' ? (
        <HealthDayView today={today} />
      ) : (
        <HealthPeriodView key={range} kind={range === 'Week' ? 'week' : 'month'} today={today} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#ECECEC',
    borderRadius: radius.md,
    padding: 3,
    gap: 4,
    marginBottom: space.md,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentActive: { backgroundColor: colors.background, borderColor: colors.border },
  segmentText: { ...type.callout, fontWeight: '500', color: colors.text },
  segmentTextActive: { fontWeight: '600' },
});
