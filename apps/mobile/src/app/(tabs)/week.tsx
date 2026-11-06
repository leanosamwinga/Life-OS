import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, formatDateUK, toLondonDate, type LocalDate } from '@life-os/core';
import { Card, ComingIn, PlaceholderBlock, Screen } from '@/components/ui';
import { colors, MIN_TOUCH, radius, space, type } from '@/theme';

/** "Fri 6 – Thu 12 November" style range for the header. */
function rangeLabel(start: LocalDate, end: LocalDate): string {
  const [sw, sd] = formatDateUK(start).split(' ');
  const [ew, ed] = formatDateUK(end).split(' ');
  const month = new Date(`${end}T12:00:00Z`).toLocaleString('en-GB', {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${sw} ${sd} – ${ew} ${ed} ${month}`;
}

export default function WeekScreen() {
  const today = toLondonDate(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [selected, setSelected] = useState(today);

  return (
    <Screen title="Week ahead" subtitle={rangeLabel(days[0]!, days[6]!)} testID="screen-week">
      <View style={styles.strip}>
        {days.map((d) => {
          const [weekday, day] = formatDateUK(d).split(' ');
          const active = d === selected;
          return (
            <Pressable
              key={d}
              onPress={() => setSelected(d)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={formatDateUK(d)}
              style={[styles.day, active && styles.dayActive]}
            >
              <Text style={[styles.dayName, active && styles.dayTextActive]}>{weekday}</Text>
              <Text style={[styles.dayNum, active && styles.dayTextActive]}>{day}</Text>
            </Pressable>
          );
        })}
      </View>

      <View
        style={styles.legend}
        accessible
        accessibilityLabel="Legend: calendar, weekly rhythm, gym and bills"
      >
        <LegendItem shape="solid" label="Calendar" />
        <LegendItem shape="dashed" label="Weekly rhythm" />
        <LegendItem shape="dot" label="Gym / bills" />
      </View>

      <Card style={styles.featured}>
        <PlaceholderBlock height={12} width="40%" />
        <PlaceholderBlock height={22} width="65%" />
        <PlaceholderBlock height={12} />
        <PlaceholderBlock height={12} width="80%" />
        <ComingIn phase={4} what="Church planner from Notion" />
      </Card>

      <Text style={styles.dayHeading} accessibilityRole="header">
        {formatDateUK(selected)}
        {selected === today ? ' · Today' : ''}
      </Text>
      <ComingIn phase={4} what="Device calendars and weekly rhythm" />
    </Screen>
  );
}

function LegendItem({ shape, label }: { shape: 'solid' | 'dashed' | 'dot'; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendSwatch,
          shape === 'solid' && { backgroundColor: colors.fill },
          shape === 'dashed' && {
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: colors.fill,
          },
          shape === 'dot' && { borderRadius: 7, backgroundColor: colors.fillMuted },
        ]}
      />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 6, marginBottom: space.md },
  day: {
    flex: 1,
    minHeight: 64,
    minWidth: MIN_TOUCH,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayActive: { backgroundColor: colors.fill },
  dayName: { ...type.footnote, color: colors.textSecondary },
  dayNum: { ...type.title, color: colors.text },
  dayTextActive: { color: colors.inverseText },
  legend: { flexDirection: 'row', gap: space.lg, marginBottom: space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 14, borderRadius: 3 },
  legendText: { ...type.footnote, color: colors.textSecondary },
  featured: { borderWidth: 2, borderColor: colors.fill, paddingVertical: space.md },
  dayHeading: { ...type.headline, color: colors.text, marginTop: space.md },
});
